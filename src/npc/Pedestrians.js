// Явган хүмүүс.
//
// • Явган замын сүлжээгээр (TrafficNetwork.walkEdges) алхана: блокийн эргэн тойронд, уулзвар дээр
//   гарцаар зам хөндлөн гарна. Гэрлэн дохиотой гарцад машины урсгал улаан бөгөөд гарч дуусах
//   хангалттай хугацаа үлдсэн үед л гарна; гэрэлгүй гарцад ойртож буй машин байхгүй үед.
// • Тоглогч зам хаавал хүлээнэ (удвал эргэж буцна), мөргөвөл загнана.
// • Хурдтай машин ойртвол хажуу тийш үсэрч зугтана. Мөргүүлбэл унаад (цусгүй) босож зугтана.
//
// Хүн бүр замын цэг рүү "хөөцөлдөж" хөдөлнө — булан эргэх, унасны дараа зам руугаа буцах нь
// огцом үсрэлтгүй, жигд харагдана.
// Дүрслэл: бүх хүн 6 InstancedMesh (хөл, гар, их бие, дээл, толгой, үс/малгай) → 6 draw call.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { clamp, damp, dampAngle } from '../core/utils.js';

const SETTINGS = Object.freeze({
  base: 34, // Дундаж нягтралтай газар хэдэн хүн (зах, төвд илүү, гэр хороололд цөөн)
  capacity: 72,
  spawnMin: 60,
  spawnMax: 150,
  despawn: 175,
  hiddenSpawn: 115, // Үүнээс ойр бол камерын харж буй талд гэнэт гаргахгүй
});
const RADIUS = 0.3;
const HALF_HEIGHT = 0.55;
const SPEED = Object.freeze({ walkMin: 1.1, walkMax: 1.55, cross: 1.8, run: 4.4, dodge: 5 });
const SKIN = [0xe9c6a1, 0xdcb08a, 0xcc9e74, 0xbb8a62, 0xa77650];
const HAIR = [0x17120f, 0x241b16, 0x34261d, 0x101010, 0x5d5953];
const HATS = [0x2a2a30, 0x6b2b24, 0x3a4252, 0x8a6a3a];
const TOPS = [0x2b3a55, 0x5a2e2e, 0x3d4a3a, 0x7a6a55, 0x1f1f24, 0x8a8f96, 0xb5452f, 0x2f5f7a, 0xc9b28a, 0x4f3b5c];
const PANTS = [0x22252b, 0x2f3540, 0x3b3328, 0x1a1a1e, 0x4b5160];
const DEEL = [0x1f4e8c, 0x7a1f3d, 0x2f6b4f, 0x8c5a1f, 0x5b2a7a, 0xa33a2a, 0x2c6d8a]; // Монгол дээл
const BOOTS = 0x2a1d14;

// Биеийн хэсгүүд (хөлийн ул y = 0, нүүр +Z руу). Хөл, гар нь дээд үзүүрээрээ (үе) эргэнэ.
const LEG = { x: 0.1, y: 0.86 };
const ARM = { x: 0.265, y: 1.42 };
const TORSO_LOCAL = new THREE.Matrix4().makeTranslation(0, 0.84, 0);
const DEEL_LOCAL = new THREE.Matrix4().makeTranslation(0, 0.4, 0);
const HEAD_LOCAL = new THREE.Matrix4().makeTranslation(0, 1.6, 0);
const HAIR_LOCAL = new THREE.Matrix4().makeTranslation(0, 1.735, -0.012);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const target = { x: 0, y: 0, z: 0 };
const root = new THREE.Matrix4();
const local = new THREE.Matrix4();
const part = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const scale = new THREE.Vector3();
const color = new THREE.Color();

export class Pedestrians {
  /**
   * @param {{scene: THREE.Scene, physics: import('../core/Physics.js').Physics, network: import('./TrafficNetwork.js').TrafficNetwork,
   *          signals: import('./TrafficSignals.js').TrafficSignals, hash: import('./SpatialHash.js').SpatialHash}} options
   */
  constructor({ scene, physics, network, signals, hash }) {
    this.physics = physics;
    this.network = network;
    this.signals = signals;
    this.hash = hash;
    this.peds = [];
    this.nextId = 1;
    this.density = 1; // Цаг, улирлаас хамаарах нягтралын үржүүлэгч (Үе шат 7)
    this.target = SETTINGS.base;
    this.candidates = [];
    this.candidateTimer = 0;
    this.spawnTimer = 0;
    this.walkEdges = network.walkEdges.filter((edge) => edge.kind === 'walk');
    this.bodyPool = [];
    /** (ped, key) — хүн ярина: 'bump', 'wait', 'flee', 'hit' */
    this.onSpeak = null;
    /** (ped, vehicleEntry) — тоглогчийн машин хүн мөргөсөн */
    this.onKnocked = null;
    this.createVisuals(scene);
  }

  createVisuals(scene) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const cap = SETTINGS.capacity;
    const make = (geometry, count, name) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = name;
      mesh.setColorAt(0, color.setHex(0xffffff)); // instanceColor-ийг эхнээс нь үүсгэнэ
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };
    this.meshes = {
      legs: make(new THREE.BoxGeometry(0.15, 0.84, 0.17).translate(0, -0.42, 0), cap * 2, 'PedLegs'),
      arms: make(new THREE.BoxGeometry(0.11, 0.6, 0.13).translate(0, -0.3, 0), cap * 2, 'PedArms'),
      torso: make(new THREE.BoxGeometry(0.4, 0.62, 0.23).translate(0, 0.31, 0), cap, 'PedTorso'),
      deel: make(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 8).translate(0, 0.5, 0), cap, 'PedDeel'),
      head: make(new THREE.BoxGeometry(0.22, 0.25, 0.23), cap, 'PedHead'),
      hair: make(new THREE.BoxGeometry(0.245, 0.1, 0.255), cap, 'PedHair'),
    };
  }

  // ---------- Гаргах / устгах ----------

  /** Ойр орчны явган замууд; газрын нягтралаас (зах, төв, гэр хороолол) хүний тоо хамаарна. */
  refreshCandidates(focus, minDistance) {
    this.candidates.length = 0;
    let total = 0;
    let lengthSum = 0;
    for (const edge of this.walkEdges) {
      const d = Math.hypot((edge.a.x + edge.b.x) / 2 - focus.x, (edge.a.z + edge.b.z) / 2 - focus.z);
      if (d < minDistance - edge.length / 2 - 10 || d > SETTINGS.spawnMax + edge.length / 2) continue;
      total += edge.weight * edge.length;
      lengthSum += edge.length;
      this.candidates.push({ edge, cumulative: total });
    }
    const density = lengthSum > 0 ? total / lengthSum : 1;
    this.target = Math.min(SETTINGS.capacity, Math.round(SETTINGS.base * density * this.density));
  }

  trySpawn(focus, cameraForward, minDistance) {
    if (this.candidates.length === 0 || this.peds.length >= SETTINGS.capacity) return null;
    const total = this.candidates[this.candidates.length - 1].cumulative;
    for (let attempt = 0; attempt < 6; attempt++) {
      const roll = Math.random() * total;
      const edge = this.candidates.find((c) => c.cumulative >= roll).edge;
      const s = Math.random() * edge.length;
      const x = edge.a.x + ((edge.b.x - edge.a.x) * s) / edge.length;
      const z = edge.a.z + ((edge.b.z - edge.a.z) * s) / edge.length;
      const dx = x - focus.x;
      const dz = z - focus.z;
      const distance = Math.hypot(dx, dz);
      if (distance < minDistance || distance > SETTINGS.spawnMax) continue;
      if (cameraForward && distance < SETTINGS.hiddenSpawn && (dx * cameraForward.x + dz * cameraForward.z) / distance > 0.25) continue;
      const forward = Math.random() < 0.5;
      return this.spawnAt(edge, forward, forward ? s : edge.length - s);
    }
    return null;
  }

  /** Тоглоом эхлэх / тоглогч хол үсрэх үед ойр орчныг шууд дүүргэнэ. */
  populate(focus) {
    this.refreshCandidates(focus, 8);
    for (let guard = 0; this.peds.length < this.target && guard < this.target * 6; guard++) this.trySpawn(focus, null, 8);
    this.candidateTimer = 0;
  }

  spawnAt(edge, forward, s) {
    const deel = Math.random() < 0.3;
    const top = deel ? pick(DEEL) : pick(TOPS);
    const ped = {
      id: this.nextId++,
      edge,
      forward,
      s,
      lateralFactor: 0.15 + Math.random() * 0.85, // Явган замын аль хэсгээр алхах (баруун гар талаар)
      walkSpeed: SPEED.walkMin + Math.random() * (SPEED.walkMax - SPEED.walkMin),
      speed: 0,
      moveSpeed: 0,
      state: 'walk',
      resumeState: 'walk',
      timer: 0,
      waitTime: 0,
      waitBack: Math.random() * 0.8, // Гарцын өмнө хүлээхдээ булангаас хэр хойно зогсох
      checkTimer: 0,
      speakCooldown: 0,
      saidWait: false,
      faceYaw: 0,
      dirX: 0,
      dirZ: 1,
      position: new THREE.Vector3(),
      prevPosition: new THREE.Vector3(),
      renderPosition: new THREE.Vector3(),
      yaw: 0,
      renderYaw: 0,
      pitch: 0, // Унах үед урагш хазайх өнцөг (0 — босоо, π/2 — хэвтээ)
      phase: Math.random() * Math.PI * 2,
      amp: 0,
      knock: new THREE.Vector3(),
      fleeFrom: new THREE.Vector3(),
      scale: 0.92 + Math.random() * 0.16,
      deel,
      colors: {
        skin: pick(SKIN),
        hair: Math.random() < 0.4 ? pick(HATS) : pick(HAIR),
        top,
        legs: deel ? BOOTS : pick(PANTS),
        deel: top,
      },
      body: null,
      bodyEnabled: false,
      entry: null,
    };
    ped.entry = { kind: 'ped', ref: ped, x: 0, z: 0, hx: 0, hz: 1, vx: 0, vz: 0, halfLength: RADIUS, halfWidth: RADIUS };
    this.pathPoint(ped, target);
    ped.position.set(target.x, target.y, target.z);
    ped.prevPosition.copy(ped.position);
    ped.renderPosition.copy(ped.position);
    ped.yaw = ped.renderYaw = Math.atan2(ped.dirX, ped.dirZ);
    this.syncEntry(ped, 1);
    ped.body = this.acquireBody(ped);
    ped.bodyEnabled = true;
    this.peds.push(ped);
    return ped;
  }

  remove(ped) {
    const index = this.peds.indexOf(ped);
    if (index >= 0) this.peds.splice(index, 1);
    if (ped.body) {
      ped.body.setEnabled(false);
      this.bodyPool.push(ped.body);
      ped.body = null;
    }
  }

  acquireBody(ped) {
    let body = this.bodyPool.pop();
    if (!body) {
      const world = this.physics.world;
      body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      // Зөвхөн тоглогчтой мөргөлдөнө (машин хүнийг логикоор "мөргөнө" — физик түлхэлтгүй)
      world.createCollider(
        RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(collisionGroups(GROUP.NPC, GROUP.PLAYER)),
        body,
      );
    }
    body.setEnabled(true);
    body.setTranslation(this.bodyCenter(ped), true);
    return body;
  }

  bodyCenter(ped) {
    return { x: ped.position.x, y: ped.position.y + HALF_HEIGHT + RADIUS, z: ped.position.z };
  }

  setBodyEnabled(ped, enabled) {
    if (!ped.body || ped.bodyEnabled === enabled) return;
    ped.bodyEnabled = enabled;
    if (enabled) ped.body.setTranslation(this.bodyCenter(ped), true);
    ped.body.setEnabled(enabled);
  }

  /**
   * Машин булаагдсан жолооч: хаалганы дэргэд гарч ирээд аюулаас зугтана (ойрын явган зам руу).
   * @param {{x:number, z:number}} at
   * @param {{x:number, z:number}} threat
   */
  spawnFleeing(at, threat) {
    let best = null;
    let bestDistance = 40;
    let bestS = 0;
    for (const edge of this.walkEdges) {
      const ex = edge.b.x - edge.a.x;
      const ez = edge.b.z - edge.a.z;
      const t = clamp(((at.x - edge.a.x) * ex + (at.z - edge.a.z) * ez) / (edge.length * edge.length), 0, 1);
      const d = Math.hypot(edge.a.x + ex * t - at.x, edge.a.z + ez * t - at.z);
      if (d < bestDistance) {
        bestDistance = d;
        best = edge;
        bestS = t * edge.length;
      }
    }
    if (!best) return null;
    if (this.peds.length >= SETTINGS.capacity) this.remove(this.peds[0]);
    const ped = this.spawnAt(best, true, bestS);
    ped.position.set(at.x, best.y, at.z);
    ped.prevPosition.copy(ped.position);
    ped.renderPosition.copy(ped.position);
    ped.body.setTranslation(this.bodyCenter(ped), true);
    this.startFlee(ped, threat);
    return ped;
  }

  // ---------- Зам ----------

  /** Явж буй замын (edge) s цэг, хажуугийн шилжилттэйгээр (баруун гар тал). */
  pathPoint(ped, out, sOverride) {
    const edge = ped.edge;
    const from = ped.forward ? edge.a : edge.b;
    const to = ped.forward ? edge.b : edge.a;
    const dx = (to.x - from.x) / edge.length;
    const dz = (to.z - from.z) / edge.length;
    const s = sOverride ?? ped.s;
    const lateral = ped.lateralFactor * edge.lateral;
    out.x = from.x + dx * s - dz * lateral;
    out.z = from.z + dz * s + dx * lateral;
    if (edge.kind === 'cross') {
      // Гарц: эхэнд нь явган зам (хашлагын өндөр), дунд нь зам (0), төгсгөлд нөгөө явган зам
      const [yFrom, yTo, insetFrom, insetTo] = ped.forward
        ? [edge.yA, edge.yB, edge.insetA, edge.insetB]
        : [edge.yB, edge.yA, edge.insetB, edge.insetA];
      out.y = s < insetFrom ? yFrom : s > edge.length - insetTo ? yTo : 0;
    } else {
      out.y = edge.y;
    }
    ped.dirX = dx;
    ped.dirZ = dz;
    return out;
  }

  reverse(ped) {
    ped.forward = !ped.forward;
    ped.s = Math.max(0, ped.edge.length - ped.s);
  }

  /** Замын төгсгөлд: дараагийн замыг сонгоно. false бол хүн зогсоно (гарц хүлээх, амсхийх). */
  arrive(ped) {
    const node = ped.forward ? ped.edge.b : ped.edge.a;
    const fleeing = ped.state === 'flee';
    const next = this.pickNextEdge(ped.edge, node, fleeing);
    ped.edge = next;
    ped.forward = next.a === node;
    ped.s = 0;
    if (next.kind === 'cross' && !fleeing) {
      if (this.canCross(next)) {
        ped.state = 'cross';
        return true;
      }
      ped.state = 'wait';
      ped.waitTime = 0;
      ped.checkTimer = 0.3;
      return false;
    }
    if (ped.state === 'cross') ped.state = 'walk';
    if (!fleeing && Math.random() < 0.06) {
      // Хааяа буланд зогсож амсхийнэ (утсаараа ярих, хүн хүлээх)
      ped.state = 'idle';
      ped.timer = 2 + Math.random() * 6;
      return false;
    }
    return true;
  }

  pickNextEdge(current, node, avoidCross) {
    let total = 0;
    for (const edge of node.edges) {
      if (edge === current || (avoidCross && edge.kind === 'cross')) continue;
      total += edge.kind === 'cross' ? 0.9 : edge.weight;
    }
    if (total === 0) return current; // Өөр зам алга — эргэж буцна
    let roll = Math.random() * total;
    for (const edge of node.edges) {
      if (edge === current || (avoidCross && edge.kind === 'cross')) continue;
      roll -= edge.kind === 'cross' ? 0.9 : edge.weight;
      if (roll <= 0) return edge;
    }
    return current;
  }

  /** Гарцаар гарч болох уу (гэрлэн дохио эсвэл ойртож буй машин). */
  canCross(edge) {
    const node = this.network.nodes.get(edge.nodeId);
    if (!node) return true;
    if (node.control === 'signal') {
      if (this.signals.state(node.id, edge.roadAxis) !== 'red') return false;
      return this.signals.timeUntilGreen(node.id, edge.roadAxis) > (edge.length / SPEED.cross) * 0.8 + 1;
    }
    const mx = (edge.a.x + edge.b.x) / 2;
    const mz = (edge.a.z + edge.b.z) / 2;
    let clear = true;
    this.hash.query(mx, mz, 28, (e) => {
      if (!clear || (e.kind !== 'car' && e.kind !== 'playerCar')) return;
      const dx = mx - e.x;
      const dz = mz - e.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 7) {
        clear = false;
        return;
      }
      const speed = Math.hypot(e.vx, e.vz);
      if (speed > 0.5 && distance < 28 && (dx * e.vx + dz * e.vz) / (distance * speed) > 0.5) clear = false;
    });
    return clear;
  }

  /** Замын урагшилт (төгсгөлд хүрвэл дараагийн зам). */
  advance(ped, dt) {
    ped.s += ped.speed * dt;
    for (let guard = 0; ped.s >= ped.edge.length && guard < 3; guard++) {
      const overflow = ped.s - ped.edge.length;
      if (!this.arrive(ped)) {
        ped.s = 0;
        ped.speed = 0;
        return;
      }
      ped.s = overflow;
    }
  }

  /** Замын цэг рүү хамгийн ихдээ maxSpeed хурдаар ойртоно (булан, унасны дараах буцалт жигд). */
  chase(ped, dt, maxSpeed, sOverride) {
    this.pathPoint(ped, target, sOverride);
    const dx = target.x - ped.position.x;
    const dz = target.z - ped.position.z;
    const distance = Math.hypot(dx, dz);
    const step = maxSpeed * dt;
    if (distance <= step) {
      ped.position.x = target.x;
      ped.position.z = target.z;
    } else {
      ped.position.x += (dx / distance) * step;
      ped.position.z += (dz / distance) * step;
    }
    ped.position.y = target.y;
    if (distance > 0.02) ped.yaw = Math.atan2(dx, dz);
  }

  // ---------- Физик алхам ----------

  /** @param {{onFoot:boolean, playerEntry:object, vehicles:object[]}} context */
  fixedUpdate(dt, context) {
    for (let i = this.peds.length - 1; i >= 0; i--) this.stepPed(this.peds[i], dt, context);
  }

  stepPed(ped, dt, ctx) {
    ped.prevPosition.copy(ped.position);
    ped.timer -= dt;
    ped.speakCooldown -= dt;
    const knocked = ped.state === 'fall' || ped.state === 'down' || ped.state === 'getup';
    if (!knocked) {
      this.checkVehicles(ped, ctx);
      this.checkPlayerBump(ped, ctx);
    }

    switch (ped.state) {
      case 'walk':
      case 'cross':
      case 'flee':
        this.stepMoving(ped, dt, ctx);
        break;
      case 'wait':
        this.stepWait(ped, dt);
        break;
      case 'yield':
        this.stepYield(ped, dt, ctx);
        break;
      case 'idle':
      case 'annoyed':
        ped.speed = 0;
        this.chase(ped, dt, 1.5);
        if (ped.state === 'annoyed') ped.yaw = ped.faceYaw;
        if (ped.timer <= 0) ped.state = ped.state === 'annoyed' ? ped.resumeState : 'walk';
        break;
      case 'dodge':
        ped.position.x += ped.knock.x * dt;
        ped.position.z += ped.knock.z * dt;
        ped.yaw = Math.atan2(ped.knock.x, ped.knock.z);
        if (ped.timer <= 0) this.startFlee(ped, ped.fleeFrom);
        break;
      default:
        this.stepKnocked(ped, dt);
    }

    ped.moveSpeed = Math.hypot(ped.position.x - ped.prevPosition.x, ped.position.z - ped.prevPosition.z) / dt;
    this.syncEntry(ped, dt);
    if (ped.bodyEnabled) ped.body.setNextKinematicTranslation(this.bodyCenter(ped));
  }

  syncEntry(ped, dt) {
    const e = ped.entry;
    e.x = ped.position.x;
    e.z = ped.position.z;
    e.hx = Math.sin(ped.yaw);
    e.hz = Math.cos(ped.yaw);
    e.vx = (ped.position.x - ped.prevPosition.x) / dt;
    e.vz = (ped.position.z - ped.prevPosition.z) / dt;
  }

  stepMoving(ped, dt, ctx) {
    if (ped.state !== 'flee' && this.blockedAhead(ped, ctx)) {
      ped.resumeState = ped.state;
      ped.state = 'yield';
      ped.timer = ped.resumeState === 'cross' ? 4 : 2.5;
      ped.saidWait = false;
      ped.speed = 0;
      return;
    }
    if (ped.state === 'flee' && ped.timer <= 0) ped.state = ped.edge.kind === 'cross' ? 'cross' : 'walk';
    const desired = ped.state === 'flee' ? SPEED.run : ped.state === 'cross' ? SPEED.cross : ped.walkSpeed;
    ped.speed = damp(ped.speed, desired, 5, dt);
    this.advance(ped, dt);
    this.chase(ped, dt, ped.speed * 1.5 + 0.6);
  }

  stepWait(ped, dt) {
    ped.speed = 0;
    ped.waitTime += dt;
    this.chase(ped, dt, 1.5, -ped.waitBack);
    ped.yaw = Math.atan2(ped.dirX, ped.dirZ); // Гарц руу харж зогсоно
    ped.checkTimer -= dt;
    if (ped.checkTimer > 0) return;
    ped.checkTimer = 0.3;
    if (this.canCross(ped.edge)) {
      ped.state = 'cross';
    } else if (ped.waitTime > 50) {
      // Удаан хүлээгээд өөр зүг алхана
      const node = ped.forward ? ped.edge.a : ped.edge.b;
      const next = this.pickNextEdge(ped.edge, node, true);
      ped.edge = next;
      ped.forward = next.a === node;
      ped.s = 0;
      ped.state = 'walk';
    }
  }

  stepYield(ped, dt, ctx) {
    ped.speed = 0;
    this.chase(ped, dt, 1.5);
    if (!this.blockedAhead(ped, ctx)) {
      ped.state = ped.resumeState;
      return;
    }
    if (!ped.saidWait && ped.timer < 1.6) {
      ped.saidWait = true;
      this.speak(ped, 'wait');
    }
    if (ped.timer <= 0) {
      // Тоглогч замаас гарахгүй байна — эргэж буцна
      this.reverse(ped);
      ped.state = ped.resumeState;
    }
  }

  stepKnocked(ped, dt) {
    ped.position.x += ped.knock.x * dt;
    ped.position.z += ped.knock.z * dt;
    if (ped.state === 'fall') {
      const t = clamp(1 - ped.timer / 0.4, 0, 1);
      ped.pitch = t * t * (Math.PI / 2);
      ped.knock.multiplyScalar(Math.exp(-1.5 * dt));
      if (ped.timer <= 0) {
        ped.state = 'down';
        ped.timer = 2 + Math.random() * 1.2;
      }
    } else if (ped.state === 'down') {
      ped.pitch = Math.PI / 2;
      ped.knock.multiplyScalar(Math.max(0, 1 - 7 * dt)); // Газар гулсаад зогсоно
      if (ped.timer <= 0) {
        ped.state = 'getup';
        ped.timer = 0.9;
      }
    } else {
      ped.knock.set(0, 0, 0);
      const t = clamp(ped.timer / 0.9, 0, 1);
      ped.pitch = t * t * (Math.PI / 2);
      if (ped.timer <= 0) {
        ped.pitch = 0;
        this.setBodyEnabled(ped, true);
        this.speak(ped, 'hit');
        this.startFlee(ped, ped.fleeFrom);
      }
    }
  }

  // ---------- Тоглогчтой харилцах ----------

  /** Тоглогчийн машин: мөргөвөл унагаана, хурдтай ойртвол хажуу тийш үсэрнэ. */
  checkVehicles(ped, ctx) {
    for (const v of ctx.vehicles) {
      const dx = ped.position.x - v.x;
      const dz = ped.position.z - v.z;
      if (dx * dx + dz * dz > 400) continue;
      const speed = Math.hypot(v.vx, v.vz);
      const lf = dx * v.hx + dz * v.hz;
      const lr = -dx * v.hz + dz * v.hx;
      if (Math.abs(lf) < v.halfLength + RADIUS && Math.abs(lr) < v.halfWidth + RADIUS) {
        if (speed > 2.5) {
          this.knockDown(ped, v, speed);
        } else if (v.driven) {
          // Аажуухан түлхвэл хажуу тийш зайлж, загнана
          const sign = lr >= 0 ? 1 : -1;
          const push = v.halfWidth + RADIUS + 0.05 - Math.abs(lr);
          ped.position.x += -v.hz * sign * push;
          ped.position.z += v.hx * sign * push;
          if (ped.speakCooldown <= 0) {
            ped.speakCooldown = 5;
            this.speak(ped, 'bump');
          }
        }
        return;
      }
      if (!v.driven || speed < 6 || ped.state === 'dodge' || ped.state === 'flee') continue;
      const mx = v.vx / speed;
      const mz = v.vz / speed;
      const ahead = dx * mx + dz * mz;
      const side = -dx * mz + dz * mx;
      if (ahead > 0 && ahead < 3 + speed * 0.9 && Math.abs(side) < v.halfWidth + 1.3) {
        this.dodge(ped, mx, mz, side);
        return;
      }
    }
  }

  dodge(ped, mx, mz, side) {
    const sign = Math.abs(side) > 0.2 ? Math.sign(side) : Math.random() < 0.5 ? -1 : 1;
    // Машины явах чиглэлд перпендикуляр, замаас нь холдох тал руу үсэрнэ
    ped.knock.set(-mz * sign * SPEED.dodge, 0, mx * sign * SPEED.dodge);
    ped.fleeFrom.set(ped.position.x - mx * 8, 0, ped.position.z - mz * 8);
    ped.state = 'dodge';
    ped.timer = 0.45;
    this.speak(ped, 'flee');
  }

  knockDown(ped, v, speed) {
    const push = Math.min(speed * 0.6, 8);
    ped.knock.set((v.vx / speed) * push, 0, (v.vz / speed) * push);
    ped.yaw = ped.renderYaw = Math.atan2(v.vx, v.vz); // Түлхэгдсэн чиглэлдээ урагш унана
    ped.fleeFrom.set(v.x, 0, v.z);
    ped.state = 'fall';
    ped.timer = 0.4;
    ped.speed = 0;
    this.setBodyEnabled(ped, false);
    this.onKnocked?.(ped, v);
  }

  startFlee(ped, from) {
    ped.state = 'flee';
    ped.timer = 4 + Math.random() * 2;
    ped.fleeFrom.copy(from);
    this.pathPoint(ped, target);
    // Аюулаас холдох чиглэлд замаа дагана
    if (ped.dirX * (ped.position.x - from.x) + ped.dirZ * (ped.position.z - from.z) < 0) this.reverse(ped);
  }

  /** Урд нь (≈0.9 м) тоглогч эсвэл тоглогчийн машин байна уу. */
  blockedAhead(ped, ctx) {
    const lookX = ped.position.x + ped.dirX * 0.9;
    const lookZ = ped.position.z + ped.dirZ * 0.9;
    if (ctx.onFoot) {
      const p = ctx.playerEntry;
      if (Math.hypot(p.x - lookX, p.z - lookZ) < 0.75) return true;
    }
    for (const v of ctx.vehicles) {
      const dx = lookX - v.x;
      const dz = lookZ - v.z;
      if (Math.abs(dx * v.hx + dz * v.hz) < v.halfLength + 0.45 && Math.abs(-dx * v.hz + dz * v.hx) < v.halfWidth + 0.45) return true;
    }
    return false;
  }

  /** Тоглогч мөргөвөл (түлхвэл) эргэж харж загнана. */
  checkPlayerBump(ped, ctx) {
    if (!ctx.onFoot || ped.speakCooldown > 0 || ped.state === 'dodge' || ped.state === 'flee') return;
    const p = ctx.playerEntry;
    const dx = ped.position.x - p.x;
    const dz = ped.position.z - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.8 || distance < 1e-3) return;
    if ((p.vx * dx + p.vz * dz) / distance < 1) return; // Тоглогч хүн рүү чиглэн хөдөлж байна
    if (ped.state !== 'yield') ped.resumeState = ped.state === 'idle' ? 'walk' : ped.state;
    ped.state = 'annoyed';
    ped.timer = 1.4;
    ped.faceYaw = Math.atan2(-dx, -dz);
    ped.speakCooldown = 5;
    this.speak(ped, 'bump');
  }

  speak(ped, key) {
    this.onSpeak?.(ped, key);
  }

  // ---------- Кадр бүр ----------

  update(dt, alpha, focus, cameraForward) {
    this.candidateTimer -= dt;
    if (this.candidateTimer <= 0) {
      this.candidateTimer = 1;
      this.refreshCandidates(focus, SETTINGS.spawnMin);
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      if (Math.hypot(ped.position.x - focus.x, ped.position.z - focus.z) > SETTINGS.despawn) this.remove(ped);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.peds.length < this.target) {
      this.spawnTimer = 0.15;
      this.trySpawn(focus, cameraForward, SETTINGS.spawnMin);
    }
    this.render(dt, alpha);
  }

  render(dt, alpha) {
    const m = this.meshes;
    let n = 0;
    let deels = 0;
    for (const ped of this.peds) {
      const r = ped.renderPosition;
      r.x = ped.prevPosition.x + (ped.position.x - ped.prevPosition.x) * alpha;
      r.z = ped.prevPosition.z + (ped.position.z - ped.prevPosition.z) * alpha;
      r.y = damp(r.y, ped.position.y, 18, dt); // Хашлага дээр гарах/буух жигд
      ped.renderYaw = dampAngle(ped.renderYaw, ped.yaw, 10, dt);

      // Алхааны анимаци: хөл, гар эсрэг савлана; гүйхэд илүү хүчтэй
      const moving = ped.pitch === 0 ? ped.moveSpeed : 0;
      ped.phase += ((moving * 4.6) / (1 + moving * 0.12)) * dt;
      ped.amp = damp(ped.amp, clamp(moving * 0.32, 0, 0.95), 8, dt);
      const swing = Math.sin(ped.phase) * ped.amp;
      const bob = Math.abs(Math.cos(ped.phase)) * 0.035 * ped.amp;

      position.set(r.x, r.y + bob + Math.sin(ped.pitch) * 0.13, r.z);
      quaternion.setFromEuler(euler.set(ped.pitch, ped.renderYaw, 0));
      scale.setScalar(ped.scale);
      root.compose(position, quaternion, scale);

      const c = ped.colors;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        const index = n * 2 + k;
        local.makeRotationX(swing * side).setPosition(LEG.x * side, LEG.y, 0);
        m.legs.setMatrixAt(index, part.multiplyMatrices(root, local));
        m.legs.setColorAt(index, color.setHex(c.legs));
        local.makeRotationX(-swing * side * 0.8).setPosition(ARM.x * side, ARM.y, 0);
        m.arms.setMatrixAt(index, part.multiplyMatrices(root, local));
        m.arms.setColorAt(index, color.setHex(c.top));
      }
      m.torso.setMatrixAt(n, part.multiplyMatrices(root, TORSO_LOCAL));
      m.torso.setColorAt(n, color.setHex(c.top));
      m.head.setMatrixAt(n, part.multiplyMatrices(root, HEAD_LOCAL));
      m.head.setColorAt(n, color.setHex(c.skin));
      m.hair.setMatrixAt(n, part.multiplyMatrices(root, HAIR_LOCAL));
      m.hair.setColorAt(n, color.setHex(c.hair));
      if (ped.deel) {
        m.deel.setMatrixAt(deels, part.multiplyMatrices(root, DEEL_LOCAL));
        m.deel.setColorAt(deels, color.setHex(c.deel));
        deels++;
      }
      n++;
    }
    m.legs.count = n * 2;
    m.arms.count = n * 2;
    m.torso.count = n;
    m.head.count = n;
    m.hair.count = n;
    m.deel.count = deels;
    for (const mesh of Object.values(m)) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
}
