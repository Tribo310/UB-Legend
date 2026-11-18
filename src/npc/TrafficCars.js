// NPC машинууд (замын хөдөлгөөн).
//
// Машин бүр эгнээ → уулзварын холбогч → эгнээ ... гэсэн замаар (Path) хөдөлнө. Хурдыг
// IDM (Intelligent Driver Model) тооцоолно: урд талын саад (машин, тоглогч, явган хүн) хүртэлх
// зай, хурдны зөрүүнээс хамаарч жигд хурдасна / тоормосолно. Үүнээс аяндаа:
//   • улаан гэрэлд дараалал үүсч, ногоон асахад нэг нэгээрээ хөдөлнө;
//   • ээлжийн уулзвар, тойрог дээр зам тавина → ачаалал ихтэй үед ТҮГЖРЭЛ үүснэ.
// Замын дүрэм: баруун гар талын хөдөлгөөн, гэрлэн дохио (шар — зогсож чадвал зогсоно),
// зүүн эргэхдээ эсрэг урсгалд зам тавина, уулзвараас гарах эгнээ дүүрэн бол уулзварт орохгүй,
// тойрог дээрх машинд зам тавина, гарцаар гарч буй явган хүнийг хүлээнэ.
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
  hiddenSpawn: 220, // Үүнээс ойр бол камерын харж буй талд гэнэт гаргахгүй
  capacity: 40, // Төрөл бүрийн InstancedMesh-ийн дээд тоо
  stuckRemove: 75, // Хэт удаан гацсан, харагдахгүй машиныг (түгжрэл тайлах) арилгана (с)
});
const TYPES = [
  { id: 'hybrid', weight: 0.5, colors: [0xe6e9ec, 0xc9ced3, 0x8e959c, 0x2a2e33, 0x1f3a5f, 0x7a1f1f, 0xd8d2c4] },
  { id: 'taxi', weight: 0.14, colors: [0xf2c230] },
  { id: 'suv', weight: 0.2, colors: [0x1f2328, 0xe9e9e6, 0x6b7076, 0x2b3f2e, 0x5a4632] },
  { id: 'minibus', weight: 0.16, colors: [0xf1f1ee, 0x2f6fb5, 0xe2b43c, 0x9aa3ab] },
  // Цагдаагийн эргүүл: хэрэг үйлдвэл ойрын эргүүл шууд хөөцөлдөж эхэлнэ (police/PoliceManager.js)
  { id: 'police', weight: 0.03, max: 2, colors: [0xf2f4f6] },
];
const TOTAL_WEIGHT = TYPES.reduce((sum, type) => sum + type.weight, 0);
// IDM: хамгийн их хурдатгал, тав тухтай тоормос (м/с²), зогсоход үлдээх зай (м), цагийн завсар (с)
const IDM = Object.freeze({ accel: 2.2, brake: 3.2, minGap: 2.2, headway: 1.1, maxBrake: 9 });
const STOP_MARGIN = 0.6; // Зогсох шугамаас хэдэн метрийн өмнө зогсох вэ
const LANE_TYPE_WEIGHT = Object.freeze({ avenue: 3, street: 1.4, dirt: 0.35 });
// Даалгаврын машин хүлээж байхдаа эгнээний төвөөс хашлага руу (зогсоол) хэр шилжих вэ (м)
const PARKED_LATERAL = 2.6;
// Анивчдаг гэрэлтэй цагдаа араас ирэхэд баруун тийш хэр зайлах вэ (м)
const PULL_OVER = Object.freeze({ avenue: 1.4, street: 1.9, dirt: 1.0 });

const UP = new THREE.Vector3(0, 1, 0);
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const unitScale = new THREE.Vector3(1, 1, 1);
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

function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/**
 * Хоёр чиглэлтэй тэгш өнцөгт (дээрээс харахад) давхцаж байна уу — тусгаарлах тэнхлэгийн тест.
 * @param {{x:number, z:number, hx:number, hz:number, halfLength:number, halfWidth:number}} a
 */
export function boxesOverlap(a, b, margin = 0) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const axes = [a.hx, a.hz, -a.hz, a.hx, b.hx, b.hz, -b.hz, b.hx];
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i];
    const az = axes[i + 1];
    const ra = a.halfLength * Math.abs(a.hx * ax + a.hz * az) + a.halfWidth * Math.abs(-a.hz * ax + a.hx * az);
    const rb = b.halfLength * Math.abs(b.hx * ax + b.hz * az) + b.halfWidth * Math.abs(-b.hz * ax + b.hx * az);
    if (Math.abs(dx * ax + dz * az) > ra + rb + margin) return false;
  }
  return true;
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
    this.reservedNodes = new Set(); // Ээлжийн уулзварууд — хэн нэгэн "захиалсан"
    /** Үйл явдал: (car, kind, vehicle?, impact?) — 'honk' (тоглогч зам хаасан), 'bumped' (физик машин мөргөсөн) */
    this.onEvent = null;
  }

  // ---------- Гаргах / устгах ----------

  /** Тоглогчоос тодорхой зайн доторх эгнээнүүд (өргөн чөлөөнд олон машин). */
  refreshCandidates(focus, minDistance) {
    this.candidates.length = 0;
    let total = 0;
    for (const lane of this.network.lanes) {
      if (lane.length < 30) continue;
      const d = Math.hypot(lane.midpoint.x - focus.x, lane.midpoint.z - focus.z);
      if (d < minDistance - 60 || d > SETTINGS.spawnMax + 40) continue;
      total += LANE_TYPE_WEIGHT[lane.type];
      this.candidates.push({ lane, cumulative: total });
    }
  }

  /** Санамсаргүй эгнээн дээр нэг машин гаргахыг оролдоно. */
  trySpawn(focus, cameraForward, minDistance) {
    if (this.candidates.length === 0) return null;
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
      if (distance < minDistance || distance > SETTINGS.spawnMax) continue;
      // Камерын өмнө ойрхон гэнэт "гарч ирэхгүй"
      if (cameraForward && distance < SETTINGS.hiddenSpawn && (dx * cameraForward.x + dz * cameraForward.z) / distance > 0.2) continue;
      return this.spawn(lane, s);
    }
    return null;
  }

  /** Тоглоом эхлэх, эсвэл тоглогч хол үсрэх (respawn) үед ойр орчныг шууд дүүргэнэ. */
  populate(focus) {
    this.refreshCandidates(focus, 25);
    for (let guard = 0; this.cars.length < this.target && guard < this.target * 6; guard++) this.trySpawn(focus, null, 25);
    this.candidateTimer = 0;
  }

  pickType() {
    let roll = Math.random() * TOTAL_WEIGHT;
    for (const type of TYPES) {
      roll -= type.weight;
      if (roll <= 0) return type;
    }
    return TYPES[0];
  }

  spawn(lane, s, forcedType = null) {
    const type = forcedType ?? this.pickType();
    const visual = this.visuals.get(type.id);
    let sameType = 0;
    for (const other of this.cars) if (other.type === type.id) sameType++;
    if (sameType >= (type.max ?? visual.capacity)) return null;
    const queued = lane.cars.some((other) => other.s > s && other.s - s < 30);
    const car = {
      id: this.nextId++,
      type: type.id,
      color: type.colors[Math.floor(Math.random() * type.colors.length)],
      halfLength: visual.halfLength,
      halfWidth: visual.halfWidth,
      height: visual.def.size.height,
      segment: lane,
      s,
      speed: queued ? 0 : lane.speed * 0.7,
      speedFactor: 0.85 + Math.random() * 0.25, // Жолооч бүр өөр (зарим нь хурдан явдаг)
      next: null,
      reservation: null,
      waitTimer: 0,
      blockedTimer: 0,
      stuckTimer: 0,
      eventCooldown: 0,
      lateral: 0, // Замаас баруун тийш шилжилт (цагдаад зам тавих)
      pullOverTimer: 0,
      sirenCheck: Math.random() * 0.25,
      position: new THREE.Vector3(),
      heading: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      prevPosition: new THREE.Vector3(),
      prevYaw: 0,
      renderPosition: new THREE.Vector3(),
      renderYaw: 0,
      body: null,
      entry: null,
    };
    // Орон зайн хэшид бүртгэгдэх мэдээлэл (бусад машин, явган хүн үүнийг "хардаг")
    car.entry = { kind: 'car', ref: car, x: 0, z: 0, hx: 0, hz: 1, vx: 0, vz: 0, halfLength: car.halfLength, halfWidth: car.halfWidth };
    lane.cars.push(car);
    car.next = this.chooseNext(lane, car);
    this.updatePose(car);
    this.syncEntry(car);
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
    const segment = car.segment;
    if (segment.kind === 'lane') {
      const laneIndex = segment.cars.indexOf(car);
      if (laneIndex >= 0) segment.cars.splice(laneIndex, 1);
    } else {
      segment.node.inside.delete(car);
    }
    this.releaseReservation(car);
    this.releaseBody(car);
  }

  acquireBody(car) {
    const pool = this.bodyPool.get(car.type);
    let body = pool.pop();
    if (!body) {
      const world = this.physics.world;
      body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(car.halfWidth, 0.75, car.halfLength)
          .setTranslation(0, 0.8, 0)
          .setCollisionGroups(collisionGroups(GROUP.VEHICLE)),
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

  reserve(node, car) {
    node.reservedBy = car;
    node.reservedTime = 0;
    car.reservation = node;
    this.reservedNodes.add(node);
  }

  releaseReservation(car) {
    const node = car.reservation;
    if (node && node.reservedBy === car) {
      node.reservedBy = null;
      this.reservedNodes.delete(node);
    }
    car.reservation = null;
  }

  /** Дараагийн уулзварт аль зүг явахаа сонгоно (шулуун илүү, шороон зам руу ховор). */
  chooseNext(lane, car = null) {
    const planned = car?.plan?.get(lane);
    if (planned) return planned;
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

  /** @param {{vehicles: object[]}} context NpcManager-ийн бэлдсэн мэдээлэл (тоглогчийн машинууд) */
  fixedUpdate(dt, context) {
    // Ээлжийн уулзварыг хэт удаан "эзэлсэн" машин (гацсан) бусдыг хаахгүй
    for (const node of this.reservedNodes) {
      node.reservedTime += dt;
      if (node.reservedTime > 12) {
        node.reservedBy = null;
        this.reservedNodes.delete(node);
      }
    }
    // Арнаас нь — алхам дотор машин устаж болно
    for (let i = this.cars.length - 1; i >= 0; i--) this.stepCar(this.cars[i], dt, context);
  }

  stepCar(car, dt, context) {
    car.prevPosition.copy(car.position);
    car.prevYaw = car.yaw;
    car.eventCooldown = Math.max(0, car.eventCooldown - dt);
    const segment = car.segment;
    if (car.hold) {
      // Даалгаврын машин явган замын хашлагын дэргэд зогсож хүлээнэ (эгнээг хаахгүй)
      car.speed = 0;
      car.lateral = moveTowards(car.lateral, PARKED_LATERAL, 3 * dt);
      this.updatePose(car);
      this.syncEntry(car);
      return;
    }

    // 1) Хүссэн хурд: эгнээний хязгаар × жолоочийн зан; эргэлтийн өмнө удаашрана
    let v0 = Math.min(segment.speed * car.speedFactor, car.maxSpeed ?? Infinity);
    if (segment.kind === 'lane' && car.next) v0 = Math.min(v0, car.next.speed + (segment.length - car.s) * 0.45);

    // Анивчдаг гэрэлтэй цагдаа араас ирвэл баруун тийш зайлж, бараг зогсоно
    car.sirenCheck -= dt;
    if (car.sirenCheck <= 0) {
      car.sirenCheck = 0.25;
      if (this.sirenBehind(car)) car.pullOverTimer = 2.5;
    }
    car.pullOverTimer -= dt;
    const pulling = car.pullOverTimer > 0 && segment.kind === 'lane';
    if (pulling) v0 = Math.min(v0, 1.5);
    car.lateral = moveTowards(car.lateral, pulling ? PULL_OVER[segment.type] : 0, 1.5 * dt);

    // 2) Урд талын саад (машин, тоглогч, явган хүн) ба зогсох шугам
    const ahead = this.findAhead(car);
    let gap = ahead.gap;
    let leaderSpeed = ahead.speed;
    if (segment.kind === 'lane') {
      const stop = this.stopDistance(car, segment);
      if (stop !== null) {
        // Шугамыг IDM-д "зогсож буй машин" мэт өгнө; minGap-ийг нөхөж шугамын яг өмнө зогсооно
        const stopGap = stop - STOP_MARGIN + IDM.minGap;
        if (stopGap < gap) {
          gap = stopGap;
          leaderSpeed = 0;
        }
      }
    }

    // Скрипттэй машин зорьсон цэг дээрээ зогсоно
    if (car.goalLane === segment) {
      const goalGap = car.goalS - car.s + IDM.minGap;
      if (goalGap < gap) {
        gap = goalGap;
        leaderSpeed = 0;
      }
      if (car.goalS - car.s < 2.5 && car.speed < 0.3) car.arrived = true;
    }

    // 3) IDM → хурд (мөргөсний дараа жолооч хэсэг зогсож загнана)
    if (car.waitTimer > 0) {
      car.waitTimer -= dt;
      car.speed = Math.max(0, car.speed - IDM.maxBrake * dt);
    } else {
      const acceleration = clamp(idmAcceleration(car.speed, v0, gap, car.speed - leaderSpeed), -IDM.maxBrake, IDM.accel);
      car.speed = Math.max(0, car.speed + acceleration * dt);
    }
    if (ahead.gap < 0.3) car.speed = 0; // Шууд урд нь саад — яаралтай зогсолт

    // Эсрэгээс нүүр тулж ирсэн физик машин (цагдаа, даалгаврын машин) — баруун тийш зай тавина
    const blocker = ahead.entry;
    if (blocker?.kind === 'playerCar' && ahead.gap < 12 && blocker.hx * car.heading.x + blocker.hz * car.heading.z < -0.3) {
      car.pullOverTimer = Math.max(car.pullOverTimer, 2);
    }

    // Тоглогч зам хаавал дуут дохио өгнө
    const blockedByPlayer =
      blocker !== null && ahead.gap < 7 && (blocker.kind === 'player' || (blocker.kind === 'playerCar' && blocker.driven));
    if (car.speed < 0.3 && blockedByPlayer) {
      car.blockedTimer += dt;
      if (car.blockedTimer > 2.5 && car.eventCooldown === 0) {
        car.eventCooldown = 8;
        this.onEvent?.(car, 'honk');
      }
    } else {
      car.blockedTimer = 0;
    }
    if (car.speed < 0.5) car.stuckTimer += dt;
    else if (car.speed > 2) car.stuckTimer = 0;

    // 4) Урагшилж, шаардлагатай бол дараагийн хэсэг рүү шилжинэ
    car.s += car.speed * dt;
    for (let guard = 0; car.s >= car.segment.length && guard < 4; guard++) {
      const overflow = car.s - car.segment.length;
      if (!this.advance(car)) {
        this.remove(car);
        return;
      }
      car.s = overflow;
    }
    this.updatePose(car);
    this.syncEntry(car);

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
      car.segment.node.inside.add(car);
      return true;
    }
    // Уулзвараас гарч шинэ эгнээнд орно
    segment.node.inside.delete(car);
    this.releaseReservation(car);
    const lane = segment.to;
    car.segment = lane;
    lane.cars.push(car);
    car.next = this.chooseNext(lane, car);
    return true;
  }

  updatePose(car) {
    car.segment.path.sample(car.s, point, direction);
    const length = Math.hypot(direction.x, direction.z) || 1;
    car.heading.set(direction.x / length, 0, direction.z / length);
    // Баруун тал = (−h.z, h.x)
    car.position.set(point.x - car.heading.z * car.lateral, 0, point.z + car.heading.x * car.lateral);
    car.yaw = Math.atan2(car.heading.x, car.heading.z);
  }

  /** Ард нь (30 м дотор) анивчдаг гэрэлтэй цагдаагийн машин байна уу. */
  sirenBehind(car) {
    const p = car.position;
    const h = car.heading;
    let found = false;
    this.hash.query(p.x, p.z, 30, (e) => {
      if (found || !e.siren) return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const forward = dx * h.x + dz * h.z;
      if (forward > -3 || forward < -30 || Math.abs(-dx * h.z + dz * h.x) > 6) return;
      found = true;
    });
    return found;
  }

  syncEntry(car) {
    const e = car.entry;
    e.x = car.position.x;
    e.z = car.position.z;
    e.hx = car.heading.x;
    e.hz = car.heading.z;
    e.vx = car.heading.x * car.speed;
    e.vz = car.heading.z * car.speed;
  }

  /**
   * Урд талд хамгийн ойр саад хүртэлх зай ба түүний хурд (бидний чиглэлд проекцлосон).
   * Хажуу тийш хол байгааг (эсрэг урсгал, зэргэлдээ эгнээ) тооцохгүй, харин бидний зам руу
   * орж ирж буйг (гарцаар гарч буй хүн, огтлолцох машин) урьдчилан харна.
   */
  findAhead(car) {
    const look = clamp(8 + car.speed * 2.6, 12, 50);
    const p = car.position;
    const h = car.heading;
    const rx = -h.z;
    const rz = h.x;
    const horizon = clamp(look / Math.max(car.speed, 2), 0.5, 1.5); // Хэдэн секундын өмнөх байрлалыг таамаглах
    let best = Infinity;
    let bestSpeed = 0;
    let bestEntry = null;
    this.hash.query(p.x + h.x * look * 0.5, p.z + h.z * look * 0.5, look * 0.5 + 6, (e) => {
      if (e.ref === car) return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const forward = dx * h.x + dz * h.z;
      if (forward <= 0) return;
      // Саадын хагас хэмжээ бидний урагш ба хажуу тэнхлэгт
      const alongExtent = e.halfLength * Math.abs(e.hx * h.x + e.hz * h.z) + e.halfWidth * Math.abs(-e.hz * h.x + e.hx * h.z);
      const sideExtent = e.halfLength * Math.abs(e.hx * rx + e.hz * rz) + e.halfWidth * Math.abs(-e.hz * rx + e.hx * rz);
      if (forward - alongExtent > look) return;
      const lateral = dx * rx + dz * rz;
      const limit = car.halfWidth + sideExtent + 0.35;
      if (Math.abs(lateral) > limit) {
        const lateralSoon = lateral + (e.vx * rx + e.vz * rz) * horizon;
        if (Math.sign(lateralSoon) === Math.sign(lateral) && Math.abs(lateralSoon) > limit) return;
      }
      // Огтлолцох замтай хоёр машин бие биенээ харвал id бага нь түрүүлж явна (хоёулаа гацахгүй)
      if (e.kind === 'car' && e.hx * h.x + e.hz * h.z < 0.7 && car.id < e.ref.id && this.sees(e.ref, car)) return;
      const gap = forward - car.halfLength - alongExtent;
      if (gap < best) {
        best = gap;
        bestSpeed = Math.max(0, e.vx * h.x + e.vz * h.z);
        bestEntry = e;
      }
    });
    return { gap: best, speed: bestSpeed, entry: bestEntry };
  }

  /** observer машин target машиныг урдаа харж байна уу. */
  sees(observer, target) {
    const dx = target.position.x - observer.position.x;
    const dz = target.position.z - observer.position.z;
    const h = observer.heading;
    const forward = dx * h.x + dz * h.z;
    if (forward <= 0 || forward > 50) return false;
    return Math.abs(-dx * h.z + dz * h.x) < observer.halfWidth + target.halfLength + 0.35;
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
    if (next && !this.exitHasSpace(next.to, car)) {
      if (car.reservation === node) this.releaseReservation(car);
      return front;
    }

    switch (node.control) {
      case 'signal': {
        const state = this.signals.state(node.id, lane.axis);
        const leftTurn = next?.turn === 'left';
        if (state === 'green') return leftTurn && this.oncomingTraffic(lane, node) ? front : null;
        // Зүүн эргэхээр шугам дээр хүлээсэн машин: эсрэг урсгал зогсмогц (шар / бүгд улаан) эргэж гарна
        const clearing = state === 'yellow' || this.signals.isClearing(node.id, lane.axis);
        if (leftTurn && clearing && front < 3 && !this.oncomingTraffic(lane, node)) return null;
        // Шар: тав тухтай зогсож чадах бол зогсоно, үгүй бол гарна
        if (state === 'yellow') return front > (car.speed * car.speed) / 7 ? front : null;
        return front;
      }
      case 'yield': {
        // Ээлжийн уулзвар: нэг удаад нэг машин (захиалга). Чөлөөтэй бол ойртохдоо захиална.
        if (car.reservation === node) return null;
        if (!node.reservedBy && front < 9) {
          this.reserve(node, car);
          return null;
        }
        return front;
      }
      case 'roundabout':
        // Тойрог дээр зүүн талаас ирж буй машинд зам тавина
        return front < 26 && this.ringBusy(next) ? front : null;
      default:
        return null;
    }
  }

  /** Гарах эгнээний эхэнд зогссон машин байвал (түгжрэл) уулзварт орохгүй — гарцыг ч хаахгүй. */
  exitHasSpace(lane, car) {
    const needed = car.halfLength * 2 + IDM.minGap + 5;
    for (const other of lane.cars) {
      if (other.s - other.halfLength < needed && other.speed < 3) return false;
    }
    return true;
  }

  /** Зүүн эргэхийн өмнө: эсрэг талаас уулзвар руу ойртож буй, эсвэл уулзвар дотор яваа машин. */
  oncomingTraffic(lane, node) {
    for (const other of node.lanesIn) {
      if (other.heading.x !== -lane.heading.x || other.heading.z !== -lane.heading.z) continue;
      for (const car of other.cars) if (other.length - car.s < 40 && car.speed > 1) return true;
    }
    for (const car of node.inside) {
      const from = car.segment.from;
      if (from.heading.x === -lane.heading.x && from.heading.z === -lane.heading.z && car.segment.turn !== 'left') return true;
    }
    return false;
  }

  /** Тойрог руу орохын өмнө: цагираг дээр ирж яваа машин байна уу (тэдэнд зам тавина). */
  ringBusy(connector) {
    if (!connector?.ring) return false;
    const { phiIn, cx, cz } = connector.ring;
    for (const car of connector.node.inside) {
      const phi = Math.atan2(car.position.z - cz, car.position.x - cx);
      const d = wrapAngle(phi - phiIn);
      if (d > -0.3 && d < 1.4) return true;
    }
    return false;
  }

  /** Тоглогчийн машин мөргөвөл NPC жолооч зогсож, загнана. */
  checkPlayerBump(car, context) {
    if (car.eventCooldown > 0) return;
    for (const vehicle of context.vehicles) {
      if (Math.abs(vehicle.x - car.position.x) > 7 || Math.abs(vehicle.z - car.position.z) > 7) continue;
      if (!boxesOverlap(car.entry, vehicle, 0.2)) continue;
      const rvx = vehicle.vx - car.entry.vx;
      const rvz = vehicle.vz - car.entry.vz;
      if (rvx * rvx + rvz * rvz < 2.5 * 2.5) continue;
      car.waitTimer = 2.4;
      car.eventCooldown = 6;
      this.onEvent?.(car, 'bumped', vehicle, Math.sqrt(rvx * rvx + rvz * rvz));
      return;
    }
  }

  // ---------- Кадр бүр ----------

  /**
   * Гаргах/устгах ба дүрслэл.
   * @param {THREE.Vector3} focus Тоглогч (эсвэл түүний машин)
   * @param {THREE.Vector3} cameraForward
   */
  update(dt, alpha, focus, cameraForward) {
    this.candidateTimer -= dt;
    if (this.candidateTimer <= 0) {
      this.candidateTimer = 1;
      this.refreshCandidates(focus, SETTINGS.spawnMin);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.scripted) continue; // Даалгаврын машин — даалгавар өөрөө удирдана
      const dx = car.position.x - focus.x;
      const dz = car.position.z - focus.z;
      const distance = Math.hypot(dx, dz);
      if (distance > SETTINGS.despawn) {
        this.remove(car);
        continue;
      }
      // Удаан гацсан (түгжрэл / мухардал) бөгөөд тоглогч харахгүй байгаа машиныг арилгана
      if (car.stuckTimer > SETTINGS.stuckRemove && distance > 60) {
        const inView = (dx * cameraForward.x + dz * cameraForward.z) / distance > 0.3;
        if (!inView || distance > 160) this.remove(car);
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.cars.length < this.target) {
      this.spawnTimer = 0.12;
      this.trySpawn(focus, cameraForward, SETTINGS.spawnMin);
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
      quaternion.setFromAxisAngle(UP, car.renderYaw);
      matrix.compose(car.renderPosition, quaternion, unitScale);
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

  // ---------- Даалгаврын (скрипттэй) машин ----------

  /** Цэгт хамгийн ойр эгнээ (чиглэл өгвөл тэр зүг рүү явдаг) ба түүн дээрх байрлал. */
  nearestLane(point, heading = null) {
    let best = null;
    for (const lane of this.network.lanes) {
      if (heading && lane.heading.x * heading.x + lane.heading.z * heading.z < 0.7) continue;
      const [a, b] = lane.path.points;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const t = clamp(((point.x - a.x) * ex + (point.z - a.z) * ez) / (lane.length * lane.length), 0, 1);
      const d = Math.hypot(a.x + ex * t - point.x, a.z + ez * t - point.z);
      if (!best || d < best.distance) best = { lane, s: t * lane.length, distance: d };
    }
    return best;
  }

  /** Эгнээнээс эгнээ рүү хамгийн богино зам (Dijkstra) — эгнээ бүрт аль холбогчоор гарах вэ. */
  planLanes(startLane, goalLane) {
    const cost = new Map([[startLane, 0]]);
    const via = new Map();
    const open = [startLane];
    const done = new Set();
    while (open.length > 0) {
      let index = 0;
      for (let i = 1; i < open.length; i++) if (cost.get(open[i]) < cost.get(open[index])) index = i;
      const lane = open.splice(index, 1)[0];
      if (lane === goalLane) break;
      if (done.has(lane)) continue;
      done.add(lane);
      for (const connector of lane.connectors) {
        const next = cost.get(lane) + lane.length + connector.length * (connector.turn === 'uturn' ? 6 : 1);
        if (next < (cost.get(connector.to) ?? Infinity)) {
          cost.set(connector.to, next);
          via.set(connector.to, connector);
          open.push(connector.to);
        }
      }
    }
    if (goalLane !== startLane && !via.has(goalLane)) return null;
    const plan = new Map();
    for (let lane = goalLane; lane !== startLane; lane = via.get(lane).from) plan.set(via.get(lane).from, via.get(lane));
    return plan;
  }

  /**
   * Даалгаврын машин: хашлагын дэргэд зогсож хүлээнэ (hold), `drive()` дуудахад замын дүрмээр
   * (эгнээ, гэрлэн дохио) зорилт руу явж, тэнд зогсоно. Хол явсан ч устахгүй.
   * @param {{type: string, color: number, position: {x:number, z:number}, yaw: number}} spec
   */
  spawnScripted(spec) {
    const heading = { x: Math.sin(spec.yaw), z: Math.cos(spec.yaw) };
    const start = this.nearestLane(spec.position, heading);
    if (!start) return null;
    const type = TYPES.find((t) => t.id === spec.type) ?? TYPES[0];
    const car = this.spawn(start.lane, start.s, type);
    if (!car) return null;
    car.color = spec.color ?? car.color;
    car.speedFactor = 1;
    car.scripted = true;
    car.hold = true;
    car.lateral = PARKED_LATERAL;
    // Хүлээж байхдаа эгнээнд "байхгүй" — ард нь ирсэн машинууд хажуугаар нь өнгөрнө
    const index = start.lane.cars.indexOf(car);
    if (index >= 0) start.lane.cars.splice(index, 1);
    this.updatePose(car);
    this.syncEntry(car);
    car.prevPosition.copy(car.position);
    car.renderPosition.copy(car.position);
    return car;
  }

  /** Скрипттэй машиныг зорилт руу хөдөлгөнө. @returns {boolean} маршрут олдсон эсэх */
  driveScripted(car, to, maxSpeed = 11) {
    const goal = this.nearestLane(to);
    const plan = goal && this.planLanes(car.segment, goal.lane);
    if (!plan) return false;
    car.plan = plan;
    car.goalLane = goal.lane;
    car.goalS = Math.min(goal.s, goal.lane.length - 3);
    car.next = this.chooseNext(car.segment, car);
    car.maxSpeed = maxSpeed;
    if (car.hold) {
      car.hold = false;
      if (car.segment.kind === 'lane' && !car.segment.cars.includes(car)) car.segment.cars.push(car);
    }
    return true;
  }

  /** Даалгавар дууссан: скрипттэй машин энгийн замын машин болно. */
  releaseScripted(car) {
    car.scripted = false;
    car.plan = null;
    car.goalLane = null;
    car.hold = false;
    if (car.segment.kind === 'lane' && !car.segment.cars.includes(car)) car.segment.cars.push(car);
  }

  // ---------- Машин булаах (F) ----------

  /** Тоглогчийн ойролцоо, удаан явж / зогсож буй NPC машин (хаалганы дэргэд зогсвол). */
  findCarjackTarget(position) {
    let best = null;
    let bestDistance = Infinity;
    for (const car of this.cars) {
      if (car.speed > 4 || car.scripted) continue;
      const dx = position.x - car.position.x;
      const dz = position.z - car.position.z;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
      const localZ = dx * car.heading.x + dz * car.heading.z;
      const localX = -dx * car.heading.z + dz * car.heading.x;
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
    const info = {
      type: car.type,
      color: car.color,
      halfWidth: car.halfWidth,
      position: car.position.clone(),
      heading: car.heading.clone(),
      yaw: car.yaw,
    };
    this.remove(car);
    return info;
  }
}
