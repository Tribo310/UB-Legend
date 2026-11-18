// Машин: Rapier-ийн DynamicRayCastVehicleController дээр суурилсан физик.
//
// Их бие нь жинтэй (dynamic) хайрцаг, дугуй бүр нь доош шидэгдсэн цацраг (raycast):
// цацраг газар мөргөсөн зайгаар түдгэлзүүлэлт (пүрш) шахагдаж, их биеийг түлхэнэ;
// дугуйн цэг дээр хөдөлгүүр, тоормос, хажуугийн үрэлтийн импульс үйлчилнэ.
// Энэ арга нь бодит дугуйн хэлбэрийн мөргөлдөөнөөс хамаагүй тогтвортой бөгөөд хурдан.
//
// Физик нь тогтмол 60 Гц алхамтай тул дүрслэхдээ хоёр алхмын хооронд interpolation хийнэ.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config.js';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { clamp, lerp } from '../core/utils.js';
import { VEHICLE_TYPES } from './vehicleTypes.js';
import { BODY_TYPES, VehicleModel } from './VehicleModel.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3();
const IDENTITY_QUATERNION = new THREE.Quaternion();
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const IDLE_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false });
const tempVector = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();

/** Утгыг target руу хамгийн ихдээ maxDelta-аар ойртуулна. */
function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** Дээд хурдад ойртох тусам хөдөлгүүрийн хүч буурна (0..1). */
function engineTaper(speedRatio) {
  if (speedRatio <= 0) return 1;
  if (speedRatio >= 1) return 0;
  return 1 - speedRatio * speedRatio * speedRatio;
}

export class Vehicle {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/Physics.js').Physics} physics
   * @param {string} typeId vehicleTypes.js-ийн түлхүүр ("hybrid", "taxi", "suv", "minibus")
   * @param {{position:{x:number,y:number,z:number}, yaw:number}} spawn Зогсоол
   * @param {{color?: number, persistent?: boolean}} [options]
   *   persistent: false бол тоглогчоос хол орхигдоход устгагдана (жишээ нь хулгайлсан машин)
   */
  constructor(scene, physics, typeId, spawn, options = {}) {
    const def = VEHICLE_TYPES[typeId];
    if (!def) throw new Error(`Тодорхойгүй машины төрөл: ${typeId}`);
    this.typeId = typeId;
    this.def = def;
    this.physics = physics;
    this.spawn = { position: { ...spawn.position }, yaw: spawn.yaw };
    this.persistent = options.persistent ?? true;
    this.bodyShape = BODY_TYPES[def.body ?? 'liftback'];
    this.lengthScale = def.size.length / this.bodyShape.length;

    // Тайван зогсоход пүрш хэр шахагдах вэ (жин ÷ хатуулаг) → машины эх цэг яг газрын түвшинд
    // байхаар дугуйн бэхэлгээний өндрийг сонгоно. Ингэснээр загварыг газраас эхлэн зурж болно.
    this.connectionY = Vehicle.connectionHeight(def);

    this.model = new VehicleModel(def, this.connectionY, { bodyColor: options.color });
    scene.add(this.model.root);
    this.createBody();
    this.createController();

    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.hasDriver = false;
    this.steerAngle = 0;
    this.speed = 0; // м/с, урагш = +, ухрах = −
    this.braking = false;
    this.flipTimer = 0;
    this.surfaceGrip = 1; // Үе шат 7: мөстэй замд < 1 болно
    this.onRecovered = null; // Хөмөрснөөс эргүүлж тавигдахад дуудна
    // Цагдаа (Үе шат 5): ai — компьютер жолоодож байна (hasDriver-тэй хамт), siren — анивчдаг гэрэл
    this.police = Boolean(def.police);
    this.ai = false;
    this.siren = false;
    this.sirenTime = Math.random();
    this.disposed = false;

    // Interpolation-ий төлөв
    this.prevPosition = new THREE.Vector3();
    this.currPosition = new THREE.Vector3();
    this.renderPosition = new THREE.Vector3();
    this.prevQuaternion = new THREE.Quaternion();
    this.currQuaternion = new THREE.Quaternion();
    this.renderQuaternion = new THREE.Quaternion();
    this.captureState(true);

    // Жолооч суудал руу шилжих хөдөлгөөн
    this.driverModel = null;
    this.driverBlend = 1;
    this.driverStartPosition = new THREE.Vector3();
    this.driverStartQuaternion = new THREE.Quaternion();

    this.updateVisual(0, 1);
  }

  /** Дугуйн бэхэлгээний өндөр: машин тайван зогсоход эх цэг нь газрын түвшинд байхаар. */
  static connectionHeight(def) {
    const w = def.wheels;
    const staticCompression = Math.abs(CONFIG.physics.gravity) / (4 * w.stiffness);
    return w.radius + w.suspensionRest - staticCompression;
  }

  createBody() {
    const { def } = this;
    const { size, mass } = def;
    const world = this.physics.world;
    const rotation = tempQuaternion.setFromAxisAngle(UP, this.spawn.yaw);
    const p = this.spawn.position;

    // Хайрцгийн инерцийн момент (ойролцоо) — хүндийн төв нь нам (centerOfMassY)
    const height = 1.1;
    const inertia = {
      x: (mass / 12) * (height * height + size.length * size.length),
      y: (mass / 12) * (size.width * size.width + size.length * size.length),
      z: (mass / 12) * (size.width * size.width + height * height),
    };
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setLinearDamping(def.linearDamping)
      .setAngularDamping(def.angularDamping)
      .setCcdEnabled(true) // Өндөр хурдад нимгэн шон "нэвтэрч" гарахгүй
      .setAdditionalMassProperties(mass, { x: 0, y: def.centerOfMassY, z: 0 }, inertia, IDENTITY_ROTATION);
    this.body = world.createRigidBody(desc);

    // Мөргөлдөөний хэлбэр: доод их бие + бүхээг (профайлын хүрээнээс). Нягт 0 — масс нь дээрх тохиргооноос л ирнэ.
    const groups = collisionGroups(GROUP.VEHICLE);
    const s = this.lengthScale;
    const shape = this.bodyShape;
    const bodyY = shape.body.map((p) => p[1]);
    const bottom = Math.min(...bodyY);
    const belt = Math.max(...bodyY);
    const cabinZ = shape.cabin.map((p) => p[0] * s);
    const cabinY = shape.cabin.map((p) => p[1]);
    const cabinFront = Math.max(...cabinZ);
    const cabinRear = Math.min(...cabinZ);
    const cabinBottom = Math.min(...cabinY);
    const cabinTop = Math.max(...cabinY);
    const shapes = [
      RAPIER.ColliderDesc.cuboid(size.width / 2, (belt - bottom) / 2, size.length / 2 - 0.02).setTranslation(0, (belt + bottom) / 2, 0),
      RAPIER.ColliderDesc.cuboid((size.width - shape.cabinInset) / 2 - 0.02, (cabinTop - cabinBottom) / 2, ((cabinFront - cabinRear) / 2) * 0.85)
        .setTranslation(0, (cabinTop + cabinBottom) / 2, (cabinFront + cabinRear) / 2),
    ];
    this.colliders = shapes.map((shape) =>
      world.createCollider(
        shape.setDensity(0).setFriction(0.4).setRestitution(0.1).setCollisionGroups(groups),
        this.body,
      ),
    );
  }

  createController() {
    const w = this.def.wheels;
    const controller = this.physics.world.createVehicleController(this.body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2; // rapier.js-д энэ setter "setIndexForwardAxis" нэртэй property байдаг

    // 0 урд-зүүн, 1 урд-баруун, 2 хойд-зүүн, 3 хойд-баруун (зүүн = +X)
    const layout = [
      [w.halfTrack, w.frontZ],
      [-w.halfTrack, w.frontZ],
      [w.halfTrack, w.rearZ],
      [-w.halfTrack, w.rearZ],
    ];
    layout.forEach(([x, z], i) => {
      // Тэнхлэг (axle) −X → "урагш" нь (дээш × тэнхлэг) = +Z
      controller.addWheel({ x, y: this.connectionY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, w.suspensionRest, w.radius);
      controller.setWheelSuspensionStiffness(i, w.stiffness);
      controller.setWheelSuspensionCompression(i, w.compression);
      controller.setWheelSuspensionRelaxation(i, w.relaxation);
      controller.setWheelMaxSuspensionTravel(i, w.maxTravel);
      controller.setWheelMaxSuspensionForce(i, w.maxForce);
    });
    this.controller = controller;
    this.frontWheels = [0, 1];
    this.rearWheels = [2, 3];
    this.drivenWheels = { front: [0, 1], rear: [2, 3], all: [0, 1, 2, 3] }[this.def.drive];
    // Дугуйн цацраг зөвхөн газар, статик биеттэй мөргөлдөнө (өөрийн их бие, конус, хүнийг үл тооно)
    this.wheelRayGroups = collisionGroups(GROUP.VEHICLE, GROUP.WORLD | GROUP.PROP);
    this.setSurfaceGrip(1);
  }

  /** Замын барьцыг өөрчилнө (1 = хуурай асфальт, 0.3 орчим = мөс). */
  setSurfaceGrip(grip) {
    const w = this.def.wheels;
    this.surfaceGrip = grip;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelFrictionSlip(i, w.frictionSlip * grip);
      this.controller.setWheelSideFrictionStiffness(i, w.sideFriction * grip);
    }
  }

  /** Жолоочийн оролт (Input.getDriveInput()-ийн үр дүн). */
  setDriverInput(input) {
    this.input.throttle = input.throttle;
    this.input.brake = input.brake;
    this.input.steer = input.steer;
    this.input.handbrake = input.handbrake;
  }

  /** Тогтмол физик алхам — world.step()-ээс ӨМНӨ дуудна. */
  fixedUpdate(dt) {
    const { def, controller } = this;
    const w = def.wheels;
    // Rapier 0.21: тоглоомын явцад (цагдаа, булаасан машин) үүсгэсэн машины биеийг эхний алхамд
    // "идэвхгүй" (disabled) болгох нь хөтөч дээр ажиглагдсан — дахин идэвхжүүлэхэд хэвийн ажиллана.
    if (!this.body.isEnabled()) this.body.setEnabled(true);
    const input = this.hasDriver ? this.input : IDLE_INPUT;
    const speed = controller.currentVehicleSpeed();
    this.speed = speed;

    // 1) Жолоо: хурд нэмэгдэх тусам эргэх өнцөг багасна (өндөр хурдад хөмрөхөөс сэргийлнэ)
    const speedFactor = clamp(Math.abs(speed) / def.steer.speedForMinAngle, 0, 1);
    const maxAngle = lerp(def.steer.maxAngle, def.steer.highSpeedAngle, speedFactor);
    const target = -input.steer * maxAngle; // Rapier-т эерэг өнцөг = зүүн тийш
    const returning = Math.abs(target) < Math.abs(this.steerAngle) || target * this.steerAngle < 0;
    const rate = returning ? def.steer.returnRate : def.steer.rate;
    this.steerAngle = moveTowards(this.steerAngle, target, rate * dt);
    for (const i of this.frontWheels) controller.setWheelSteering(i, this.steerAngle);

    // 2) Хөдөлгүүр ба тоормос
    const maxForward = def.maxSpeedKmh / 3.6;
    const maxReverse = def.maxReverseKmh / 3.6;
    let engine = 0;
    let brake = 0;
    if (input.throttle > 0.01) {
      if (speed < -0.5) brake = def.brakeImpulse * input.throttle; // Ухарч яваад урагш дарвал эхлээд зогсоно
      else engine = def.engineForce * input.throttle * engineTaper(speed / maxForward);
    }
    if (input.brake > 0.01) {
      if (speed > 0.5) {
        brake = Math.max(brake, def.brakeImpulse * input.brake);
        engine = 0;
      } else if (input.throttle <= 0.01) {
        engine = -def.engineForce * def.reverseForceRatio * input.brake * engineTaper(-speed / maxReverse);
      }
    }
    if (engine === 0 && brake === 0) brake = this.hasDriver ? def.coastBrakeImpulse : def.parkingBrakeImpulse;
    this.braking = brake > def.coastBrakeImpulse * 2 || input.handbrake;

    for (let i = 0; i < 4; i++) {
      // Rapier: хөдөлгүүрийн хүчтэй дугуйд тоормос үйлчилдэггүй — хөтлөгч бус дугуйд тоормос өгнө
      controller.setWheelEngineForce(i, this.drivenWheels.includes(i) ? engine : 0);
      controller.setWheelBrake(i, brake);
    }

    // 3) Гар тоормос: арын дугуй түгжигдэж, хажуу тийш гулсана (эргэлтэд "drift")
    const rearSideFriction = (input.handbrake ? w.handbrakeSideFriction : w.sideFriction) * this.surfaceGrip;
    for (const i of this.rearWheels) {
      if (input.handbrake) {
        controller.setWheelEngineForce(i, 0);
        controller.setWheelBrake(i, def.handbrakeImpulse);
      }
      controller.setWheelSideFrictionStiffness(i, rearSideFriction);
    }

    // 4) Downforce: хурд²-д пропорциональ доош түлхэлт (дугуй газарт хүрч байх үед л)
    if (this.wheelsInContact() > 0) {
      const v = this.body.linvel();
      const speedSq = v.x * v.x + v.y * v.y + v.z * v.z;
      if (speedSq > 1) this.body.applyImpulse({ x: 0, y: -def.downforce * speedSq * dt, z: 0 }, true);
    }

    // 5) Дугуйн цацраг, түдгэлзүүлэлт, үрэлтийг тооцоолж их биед импульс өгнө
    controller.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.wheelRayGroups);

    // 6) Хөмөрсөн (хажуу, дээвэр дээрээ) бөгөөд зогссон бол хэсэг хугацааны дараа эргүүлж тавина
    const r = this.body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    this.flipTimer = upY < 0.35 && Math.abs(speed) < 2 ? this.flipTimer + dt : 0;
    if (this.flipTimer > CONFIG.vehicle.flipRecoverDelay) {
      const p = this.body.translation();
      this.teleport({ x: p.x, y: p.y + 1.2, z: p.z }, this.yaw);
      this.onRecovered?.(this);
    }
  }

  /** Физикийн алхам бүрийн ДАРАА: interpolation-д өмнөх ба одоогийн байрлалыг хадгална. */
  captureState(snap = false) {
    const t = this.body.translation();
    const r = this.body.rotation();
    if (snap) {
      this.prevPosition.set(t.x, t.y, t.z);
      this.prevQuaternion.set(r.x, r.y, r.z, r.w);
    } else {
      this.prevPosition.copy(this.currPosition);
      this.prevQuaternion.copy(this.currQuaternion);
    }
    this.currPosition.set(t.x, t.y, t.z);
    this.currQuaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Кадр бүр: машин, дугуй, жолооны хүрд, тоормосны гэрлийг дүрсэлнэ. */
  updateVisual(dt, alpha) {
    this.renderPosition.lerpVectors(this.prevPosition, this.currPosition, alpha);
    this.renderQuaternion.slerpQuaternions(this.prevQuaternion, this.currQuaternion, alpha);
    this.model.root.position.copy(this.renderPosition);
    this.model.root.quaternion.copy(this.renderQuaternion);
    this.model.updateWheels(this.controller);
    this.model.setSteeringWheel(this.steerAngle);
    this.model.setBrakeLights(this.braking);
    if (this.police) {
      this.sirenTime += dt;
      this.model.setSiren(this.siren, this.sirenTime);
    }
    this.updateDriverTransition(dt);
  }

  /** Машины харж буй чиглэл (радиан; 0 = +Z). */
  get yaw() {
    tempVector.copy(FORWARD).applyQuaternion(this.currQuaternion);
    return Math.atan2(tempVector.x, tempVector.z);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  wheelsInContact() {
    let count = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) count++;
    return count;
  }

  /** Машиныг шууд өгөгдсөн цэг рүү (хурдгүйгээр) шилжүүлнэ. */
  teleport(position, yaw) {
    const rotation = tempQuaternion.setFromAxisAngle(UP, yaw);
    this.body.setTranslation(position, true);
    this.body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.flipTimer = 0;
    this.captureState(true);
  }

  resetToSpawn() {
    this.teleport(this.spawn.position, this.spawn.yaw);
  }

  /** Машиныг ертөнцөөс бүрмөсөн устгана (физик бие, контроллер, загвар). */
  dispose() {
    const world = this.physics.world;
    world.removeVehicleController(this.controller);
    world.removeRigidBody(this.body); // Хавсарсан collider-ууд хамт устна
    this.model.dispose();
    this.disposed = true;
  }

  // ---------- Жолооч ----------

  /** Тоглогчийн загварыг жолоочийн суудалд хавсаргаж, суудал руу зөөлөн шилжүүлнэ. */
  attachDriver(playerModel) {
    this.model.root.updateMatrixWorld(true);
    playerModel.root.updateMatrixWorld(true);
    this.model.seat.attach(playerModel.root); // Дэлхийн байрлалаа хадгалан суудалд шилжинэ
    this.driverModel = playerModel;
    this.driverStartPosition.copy(playerModel.root.position);
    this.driverStartQuaternion.copy(playerModel.root.quaternion);
    this.driverBlend = 0;
    this.hasDriver = true;
  }

  updateDriverTransition(dt) {
    if (!this.driverModel || this.driverBlend >= 1) return;
    this.driverBlend = Math.min(1, this.driverBlend + dt / CONFIG.vehicle.enterDuration);
    const t = 1 - (1 - this.driverBlend) ** 3; // Эхэндээ хурдан, сүүлдээ зөөлөн
    const root = this.driverModel.root;
    root.position.lerpVectors(this.driverStartPosition, ORIGIN, t);
    root.quaternion.slerpQuaternions(this.driverStartQuaternion, IDENTITY_QUATERNION, t);
  }

  /** Жолоочийг машинаас салгаж, ертөнцөд буцаана. */
  detachDriver(scene) {
    if (this.driverModel) {
      this.model.root.updateMatrixWorld(true);
      scene.attach(this.driverModel.root);
    }
    this.driverModel = null;
    this.hasDriver = false;
    this.setDriverInput(IDLE_INPUT);
  }

  /**
   * Буух цэгийг олно: жолоочийн тал → нөгөө тал → ар → урд. Бүгд хаалттай бол null.
   * @param {(feet: THREE.Vector3) => boolean} canStandAt Тоглогчийн капсул багтах эсэхийг шалгана
   */
  findExitPosition(canStandAt) {
    const { size } = this.def;
    const driverSide = this.def.rightHandDrive ? -1 : 1;
    const side = size.width / 2 + 0.6;
    const end = size.length / 2 + 0.7;
    const yawRotation = tempQuaternion.setFromAxisAngle(UP, this.yaw);
    const candidates = [
      [driverSide * side, -0.1],
      [-driverSide * side, -0.1],
      [0, -end],
      [0, end],
    ];
    for (const [x, z] of candidates) {
      const spot = new THREE.Vector3(x, 0, z).applyQuaternion(yawRotation).add(this.currPosition);
      spot.y += 0.05;
      if (canStandAt(spot)) return spot;
    }
    return null;
  }
}
