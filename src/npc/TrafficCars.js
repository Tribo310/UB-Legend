// NPC машинууд (замын хөдөлгөөн).
//
// Машин бүр эгнээ → уулзварын холбогч → эгнээ ... гэсэн замаар (Path) хөдөлнө. Хурдыг
// IDM (Intelligent Driver Model) тооцоолно: урд талын машин, тоглогч, явган хүн хүртэлх зай,
// хурдны зөрүүнээс хамаарч жигд хурдасна / тоормосолно. Үүнээс аяндаа:
//   • улаан гэрэлд дараалал үүсч, ногоон асахад нэг нэгээрээ хөдөлнө;
//   • ээлжийн уулзвар, тойрог дээр зам тавина → ачаалал ихтэй үед ТҮГЖРЭЛ үүснэ.
// Замын дүрэм: баруун гар талын хөдөлгөөн, гэрлэн дохио (шар — зогсож чадвал зогсоно),
// зүүн эргэхдээ эсрэг урсгалд зам тавина, уулзвараас гарах эгнээ дүүрэн бол уулзварт орохгүй.
//
// Физик: машин бүр kinematic бие (тоглогч, тоглогчийн машин мөргөлдөнө). Биеийг дахин
// ашиглана (pool). Тоглогчоос хол (≈345 м) гарсан машин алга болж, шинэ нь хол газарт гарч ирнэ.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { clamp } from '../core/utils.js';
import { createCarVisual } from './carVisuals.js';

const SETTINGS = Object.freeze({
  target: 42, // Тоглогчийн эргэн тойронд байх машины тоо
  spawnMin: 130,
  spawnMax: 300,
  despawn: 345,
  capacity: 40, // Төрөл бүрийн InstancedMesh-ийн дээд тоо
});
const TYPES = [
  { id: 'hybrid', weight: 0.5, colors: [0xe6e9ec, 0xc9ced3, 0x8e959c, 0x2a2e33, 0x1f3a5f, 0x7a1f1f, 0xd8d2c4] },
  { id: 'taxi', weight: 0.14, colors: [0xf2c230] },
  { id: 'suv', weight: 0.2, colors: [0x1f2328, 0xe9e9e6, 0x6b7076, 0x2b3f2e, 0x5a4632] },
  { id: 'minibus', weight: 0.16, colors: [0xf1f1ee, 0x2f6fb5, 0xe2b43c, 0x9aa3ab] },
];
// IDM: хамгийн их хурдатгал, тав тухтай тоормос (м/с²), зогсоход үлдээх зай (м), цагийн завсар (с)
const IDM = Object.freeze({ accel: 2.2, brake: 3.2, minGap: 2.2, headway: 1.1 });
const LANE_TYPE_WEIGHT = Object.freeze({ avenue: 3, street: 1.4, dirt: 0.35 });

const UP = new THREE.Vector3(0, 1, 0);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const tint = new THREE.Color();
const point = { x: 0, z: 0 };
const direction = { x: 0, z: 0 };

/** IDM хурдатгал. gap — урд талын саад хүртэлх зай, dv — бидний хурд − саадын хурд. */
function idmAcceleration(v, v0, gap, dv) {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (!Number.isFinite(gap)) return IDM.accel * free;
  const desired = IDM.minGap + Math.max(0, v * IDM.headway + (v * dv) / (2 * Math.sqrt(IDM.accel * IDM.brake)));
  return IDM.accel * (free - (desired / Math.max(gap, 0.1)) ** 2);
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class TrafficCars {
  /**
   * @param {{scene: THREE.Scene, physics: import('../core/Physics.js').Physics, network: import('./TrafficNetwork.js').TrafficNetwork,
   *          signals: import('./TrafficSignals.js').TrafficSignals, hash: import('./SpatialHash.js').SpatialHash}} options
   */
  constructor({ scene, physics, network, signals, hash }) {
    this.physics = physics;
    this.network = network;
    this.signals = signals;
    this.hash = hash;
    this.cars = [];
    this.nextId = 1;
    this.spawnTimer = 0;
    this.candidateTimer = 0;
    this.candidates = [];
    this.target = SETTINGS.target;
    this.visuals = new Map(TYPES.map((type) => [type.id, createCarVisual(scene, type.id, SETTINGS.capacity)]));
    this.bodyPool = new Map(TYPES.map((type) => [type.id, []]));
    this.ringCars = new Set(); // Тойрог дээр яг одоо явж буй машинууд
    /** Үйл явдал: (car, kind, data) — 'honk', 'bumped' (Game/NpcManager сонсоно) */
    this.onEvent = null;
  }

  // ---------- Гаргах / устгах ----------

  /** Тоглогчоос тодорхой зайн доторх эгнээнүүдийг (жинтэйгээр) сонгох жагсаалт. */
  refreshCandidates(focus) {
    this.candidates.length = 0;
    let total = 0;
    for (const lane of this.network.lanes) {
      if (lane.length < 30) continue;
      const d = Math.hypot(lane.midpoint.x - focus.x, lane.midpoint.z - focus.z);
      if (d < SETTINGS.spawnMin - 40 || d > SETTINGS.spawnMax) continue;
      total += LANE_TYPE_WEIGHT[lane.type];
      this.candidates.push({ lane, cumulative: total });
    }
  }

  trySpawn(focus, cameraForward) {
    if (this.candidates.length === 0) return;
    const total = this.candidates[this.candidates.length - 1].cumulative;
    for (let attempt = 0; attempt < 6; attempt++) {
      const roll = Math.random() * total;
      const lane = this.candidates.find((c) => c.cumulative >= roll).lane;
      const s = 10 + Math.random() * (lane.length - 20);
      if (lane.cars.some((car) => Math.abs(car.s - s) < 16)) continue;
      lane.path.sample(s, point, direction);
      const dx = point.x - focus.x;
      const dz = point.z - focus.z;
      const distance = Math.hypot(dx, dz);
      if (distance < SETTINGS.spawnMin || distance > SETTINGS.spawnMax) continue;
      // Камерын өмнө ойрхон гэнэт "гарч ирэхгүй"
      if (cameraForward && distance < 220 && (dx * cameraForward.x + dz * cameraForward.z) / distance > 0.35) continue;
      this.spawn(lane, s);
      return;
    }
  }

  pickType() {
    let roll = Math.random();
    for (const type of TYPES) {
      roll -= type.weight;
      if (roll <= 0) return type;
    }
    return TYPES[0];
  }

  spawn(lane, s) {
    const type = this.pickType();
    const visual = this.visuals.get(type.id);
    if (this.cars.filter((car) => car.type === type.id).length >= visual.capacity) return null;
    const car = {
      id: this.nextId++,
      type: type.id,
      color: type.colors[Math.floor(Math.random() * type.colors.length)],
      halfLength: visual.halfLength,
      halfWidth: visual.halfWidth,
      segment: lane,
      s,
      speed: lane.speed * 0.6,
      speedFactor: 0.85 + Math.random() * 0.25,
      next: null,
      reservation: null,
      waitTimer: 0,
      blockedTimer: 0,
      blockedBy: null,
      eventCooldown: 0,
      fade: 0,
      position: new THREE.Vector3(),
      heading: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      prevPosition: new THREE.Vector3(),
      prevYaw: 0,
      renderPosition: new THREE.Vector3(),
      renderYaw: 0,
      body: null,
    };
    lane.cars.push(car);
    car.next = this.chooseNext(lane);
    this.updatePose(car);
    car.prevPosition.copy(car.position);
    car.prevYaw = car.yaw;
    car.renderPosition.copy(car.position);
    car.renderYaw = car.yaw;
    car.body = this.acquireBody(car);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    const index = this.cars.indexOf(car);
    if (index >= 0) this.cars.splice(index, 1);
    if (car.segment.kind === 'lane') {
      const laneIndex = car.segment.cars.indexOf(car);
      if (laneIndex >= 0) car.segment.cars.splice(laneIndex, 1);
    }
    this.releaseReservation(car);
    this.ringCars.delete(car);
    this.releaseBody(car);
  }

  acquireBody(car) {
    const pool = this.bodyPool.get(car.type);
    let body = pool.pop();
    if (!body) {
      const world = this.physics.world;
      body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(car.halfWidth, 0.75, car.halfLength).setTranslation(0, 0.8, 0).setCollisionGroups(collisionGroups(GROUP.VEHICLE)),
        body,
      );
    }
    body.setEnabled(true);
    quaternion.setFromAxisAngle(UP, car.yaw);
    body.setTranslation({ x: car.position.x, y: 0, z: car.position.z }, true);
    body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
    return body;
  }

  releaseBody(car) {
    if (!car.body) return;
    car.body.setEnabled(false);
    this.bodyPool.get(car.type).push(car.body);
    car.body = null;
  }

  releaseReservation(car) {
    if (car.reservation && car.reservation.reservedBy === car) car.reservation.reservedBy = null;
    car.reservation = null;
  }

  /** Дараагийн уулзварт аль зүг явахаа сонгоно (шулуун илүү, шороон зам руу ховор). */
  chooseNext(lane) {
    const options = lane.connectors;
    if (options.length === 0) return null;
    let total = 0;
    const weights = options.map((c) => {
      let w = c.turn === 'straight' ? 3 : c.turn === 'right' ? 1.2 : c.turn === 'uturn' ? 0.2 : 1;
      if (c.to.type === 'dirt') w *= 0.3;
      if (c.to.type === 'avenue') w *= 1.4;
      total += w;
      return w;
    });
    let roll = Math.random() * total;
    for (let i = 0; i < options.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return options[i];
    }
    return options[options.length - 1];
  }

  // ---------- Физик алхам ----------

  /** @param {{player: object, playerVehicles: object[]}} context */
  fixedUpdate(dt, context) {
    for (const car of [...this.cars]) this.stepCar(car, dt, context);
  }

  stepCar(car, dt, context) {
    car.prevPosition.copy(car.position);
    car.prevYaw = car.yaw;
    car.eventCooldown = Math.max(0, car.eventCooldown - dt);
    const segment = car.segment;

    // 1) Хүссэн хурд: эгнээний хязгаар × жолоочийн зан; эргэлтийн өмнө удаашрана
    let v0 = segment.speed * car.speedFactor;
    if (segment.kind === 'lane' && car.next) v0 = Math.min(v0, car.next.speed + (segment.length - car.s) * 0.45);

    // 2) Урд талын саад (машин, тоглогч, явган хүн) ба зогсох шугам
    const ahead = this.findAhead(car);
    let gap = ahead.gap;
    let leaderSpeed = ahead.speed;
    if (segment.kind === 'lane') {
      const stop = this.stopDistance(car, segment);
      if (stop !== null && stop < gap) {
        gap = stop;
        leaderSpeed = 0;
      }
    }
    if (car.waitTimer > 0) {
      car.waitTimer -= dt;
      gap = Math.min(gap, 0);
      leaderSpeed = 0;
    }

    // 3) IDM → хурд
    const acceleration = clamp(idmAcceleration(car.speed, v0, gap, car.speed - leaderSpeed), -9, IDM.accel);
    car.speed = Math.max(0, car.speed + acceleration * dt);
    if (gap < 0.25) car.speed = 0;

    // Гацсан эсэх: тоглогч зам хаавал дуут дохио өгнө
    if (car.speed < 0.3 && ahead.kind && (ahead.kind === 'player' || ahead.kind === 'playerCar') && ahead.gap < 8) {
      car.blockedTimer += dt;
      if (car.blockedTimer > 3 && car.eventCooldown === 0) {
        car.eventCooldown = 9;
        this.onEvent?.(car, 'honk');
      }
    } else {
      car.blockedTimer = 0;
    }

    // 4) Урагшилж, шаардлагатай бол дараагийн хэсэг рүү шилжинэ
    car.s += car.speed * dt;
    let guard = 0;
    while (car.s >= car.segment.length && guard++ < 4) {
      const overflow = car.s - car.segment.length;
      if (!this.advance(car)) {
        this.remove(car);
        return;
      }
      car.s = overflow;
    }
    car.fade = Math.min(1, car.fade + dt * 2.5);
    this.updatePose(car);

    // 5) Kinematic бие (тоглогч, тоглогчийн машин мөргөлдөнө)
    quaternion.setFromAxisAngle(UP, car.yaw);
    car.body.setNextKinematicTranslation({ x: car.position.x, y: 0, z: car.position.z });
    car.body.setNextKinematicRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

    this.checkPlayerBump(car, context);
  }

  /** Дараагийн хэсэг рүү: эгнээ → уулзварын холбогч → эгнээ. false бол цааш зам алга. */
  advance(car) {
    const segment = car.segment;
    if (segment.kind === 'lane') {
      const laneIndex = segment.cars.indexOf(car);
      if (laneIndex >= 0) segment.cars.splice(laneIndex, 1);
      if (!car.next) return false;
      car.segment = car.next;
      car.next = null;
      if (car.segment.ring) this.ringCars.add(car);
      return true;
    }
    // Холбогчоос гарч шинэ эгнээнд орно
    this.releaseReservation(car);
    this.ringCars.delete(car);
    const lane = segment.to;
    car.segment = lane;
    lane.cars.push(car);
    car.next = this.chooseNext(lane);
    return true;
  }

  updatePose(car) {
    car.segment.path.sample(car.s, point, direction);
    car.position.set(point.x, 0, point.z);
    const length = Math.hypot(direction.x, direction.z) || 1;
    car.heading.set(direction.x / length, 0, direction.z / length);
    car.yaw = Math.atan2(car.heading.x, car.heading.z);
  }

  /**
   * Урд талд хамгийн ойр саад хүртэлх зай ба түүний хурд (бидний чиглэлд проекцлосон).
   * Эгнээний өргөнөөс хажуу тийш хол байгааг (эсрэг урсгал г.м.) тооцохгүй.
   */
  findAhead(car) {
    const look = clamp(8 + car.speed * 2.6, 10, 48);
    const p = car.position;
    const h = car.heading;
    let best = Infinity;
    let bestSpeed = 0;
    let bestKind = null;
    this.hash.query(p.x + h.x * look * 0.5, p.z + h.z * look * 0.5, look * 0.5 + 6, (entry) => {
      if (entry.ref === car) return;
      const dx = entry.x - p.x;
      const dz = entry.z - p.z;
      const forward = dx * h.x + dz * h.z;
      if (forward <= 0 || forward > look + entry.halfLength) return;
      const lateral = Math.abs(dx * h.z - dz * h.x);
      if (lateral > 1.3 + entry.halfWidth) return;
      const gap = forward - car.halfLength - entry.halfLength;
      if (gap < best) {
        best = gap;
        bestSpeed = Math.max(0, entry.speed * (entry.hx * h.x + entry.hz * h.z));
        bestKind = entry.kind;
      }
    });
    return { gap: best, speed: bestSpeed, kind: bestKind };
  }

  /**
   * Зогсох шугам хүртэлх зай (машины урд талаас), эсвэл зогсох шаардлагагүй бол null.
   * @param {object} lane Машины одоогийн эгнээ
   */
  stopDistance(car, lane) {
    const node = lane.to;
    const front = lane.stopS - car.s - car.halfLength;
    if (front < -1.5) return null; // Шугамыг давчихсан — уулзвараар гарна
    const next = car.next;
    // Уулзвараас гарах эгнээ дүүрэн бол уулзварт орохгүй (уулзварыг хаахгүй)
    if (next && !this.exitHasSpace(next.to)) return front;

    switch (node.control) {
      case 'signal': {
        const state = this.signals.state(node.id, lane.axis);
        if (state === 'red') return front;
        if (state === 'yellow') return front > (car.speed * car.speed) / (2 * 3.5) ? front : null;
        if (next && next.turn === 'left' && this.oncomingTraffic(lane, node)) return front;
        return null;
      }
      case 'yield': {
        // Ээлжийн уулзвар: нэг удаад нэг машин (захиалга). Чөлөөтэй бол ойртохдоо захиална.
        if (car.reservation === node) return null;
        const holder = node.reservedBy;
        if (holder && (!this.cars.includes(holder) || node.reservedTime > 14)) node.reservedBy = null;
        if (!node.reservedBy && front < 10) {
          node.reservedBy = car;
          node.reservedTime = 0;
          car.reservation = node;
          return null;
        }
        if (node.reservedBy) node.reservedTime += 1 / 60;
        return front;
      }
      case 'roundabout':
        return front < 26 && this.ringBusy(next) ? front : null;
      default:
        return null;
    }
  }

  exitHasSpace(lane) {
    for (const other of lane.cars) if (other.s < 9) return false;
    return true;
  }

  /** Зүүн эргэхийн өмнө: эсрэг талаас уулзвар руу ойртож буй машин байна уу. */
  oncomingTraffic(lane, node) {
    for (const other of node.lanesIn) {
      if (other.heading.x !== -lane.heading.x || other.heading.z !== -lane.heading.z) continue;
      for (const car of other.cars) {
        if (other.length - car.s < 35 && car.speed > 1) return true;
      }
    }
    return false;
  }

  /** Тойрог руу орохын өмнө: цагираг дээр ирж яваа машин байна уу (тэдэнд зам тавина). */
  ringBusy(connector) {
    if (!connector || !connector.ring) return false;
    const { phiIn, cx, cz } = connector.ring;
    for (const car of this.ringCars) {
      const phi = Math.atan2(car.position.z - cz, car.position.x - cx);
      const d = wrapAngle(phi - phiIn);
      if (d > -0.3 && d < 1.4) return true;
    }
    return false;
  }

  /** Тоглогчийн машин мөргөвөл NPC жолооч зогсож, загнана. */
  checkPlayerBump(car, context) {
    if (car.eventCooldown > 0) return;
    for (const vehicle of context.playerVehicles) {
      const dx = vehicle.x - car.position.x;
      const dz = vehicle.z - car.position.z;
      const reach = (car.halfLength + vehicle.halfLength) * 0.62;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (Math.abs(vehicle.speed - car.speed) < 2.5) continue;
      car.waitTimer = 2.2;
      car.eventCooldown = 5;
      this.onEvent?.(car, 'bumped');
      return;
    }
  }

  // ---------- Кадр бүр ----------

  /**
   * Гаргах/устгах ба дүрслэл.
   * @param {THREE.Vector3} focus Тоглогч (эсвэл түүний машин)
   * @param {THREE.Vector3|null} cameraForward
   */
  update(dt, alpha, focus, cameraForward) {
    this.candidateTimer -= dt;
    if (this.candidateTimer <= 0) {
      this.candidateTimer = 1;
      this.refreshCandidates(focus);
    }
    for (const car of [...this.cars]) {
      if (Math.hypot(car.position.x - focus.x, car.position.z - focus.z) > SETTINGS.despawn) this.remove(car);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.cars.length < this.target) {
      this.spawnTimer = 0.12;
      this.trySpawn(focus, cameraForward);
    }
    this.render(alpha);
  }

  render(alpha) {
    const counts = new Map();
    for (const car of this.cars) {
      car.renderPosition.lerpVectors(car.prevPosition, car.position, alpha);
      car.renderYaw = car.prevYaw + wrapAngle(car.yaw - car.prevYaw) * alpha;
      const visual = this.visuals.get(car.type);
      const i = counts.get(car.type) ?? 0;
      counts.set(car.type, i + 1);
      position.copy(car.renderPosition);
      quaternion.setFromAxisAngle(UP, car.renderYaw);
      scale.setScalar(0.4 + 0.6 * car.fade);
      matrix.compose(position, quaternion, scale);
      visual.paint.setMatrixAt(i, matrix);
      visual.details.setMatrixAt(i, matrix);
      visual.paint.setColorAt(i, tint.setHex(car.color));
    }
    for (const visual of this.visuals.values()) {
      const count = counts.get(visual.typeId) ?? 0;
      visual.paint.count = count;
      visual.details.count = count;
      visual.paint.instanceMatrix.needsUpdate = true;
      visual.details.instanceMatrix.needsUpdate = true;
      if (visual.paint.instanceColor) visual.paint.instanceColor.needsUpdate = true;
    }
  }

  // ---------- Хулгайлах (F) ----------

  /** Тоглогчийн ойролцоо, удаан явж/зогсож буй NPC машин (хулгайлах боломжтой). */
  findCarjackTarget(position) {
    let best = null;
    let bestDistance = Infinity;
    for (const car of this.cars) {
      if (car.speed > 4) continue;
      const dx = position.x - car.position.x;
      const dz = position.z - car.position.z;
      const localZ = dx * car.heading.x + dz * car.heading.z;
      const localX = dx * car.heading.z - dz * car.heading.x;
      if (Math.abs(localX) > car.halfWidth + 1.4 || Math.abs(localZ) > car.halfLength + 0.8) continue;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = car;
      }
    }
    return best;
  }

  /** NPC машиныг замын хөдөлгөөнөөс гаргаж, мэдээллийг нь буцаана (физик машин болгоход). */
  extract(car) {
    const info = { type: car.type, color: car.color, position: car.position.clone(), yaw: car.yaw, heading: car.heading.clone() };
    this.remove(car);
    return info;
  }
}
