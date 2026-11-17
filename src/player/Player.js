// Тоглогч (Бат): Rapier-ийн kinematic character controller (KCC) дээр суурилсан хөдөлгөөн.
//
// KCC нь хана дагуу гулсах, шат/хашлага дээр автоматаар гарах, налуу өгсөх зэргийг
// өөрөө шийднэ. Бид "хаашаа хэр хурдан явахыг хүсэж байна" гэдгийг тооцоолж өгөөд,
// доош буухад газарт наалдахыг (snapToGround) өөрсдөө хийнэ.
//
// Физик нь тогтмол алхмаар (60 Гц) ажилладаг тул дүрслэхдээ өмнөх ба одоогийн
// байрлалын хооронд interpolation хийнэ — 144 Гц дэлгэц дээр ч гөлгөр харагдана.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config.js';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { clamp, damp, dampAngle } from '../core/utils.js';
import { PlayerModel } from './PlayerModel.js';

const CONTROLLER_OFFSET = 0.02; // KCC саадаас 2 см зай барина ("арьс")
const STEP_SMOOTHING = 16; // Шатаар өгсөх/буухад загварын өндрийг зөөлрүүлэх хурд
const MIN_SUPPORT_NORMAL_Y = 0.1; // Үүнээс босоо (ханын) нормалтай гадаргуу дээр "наалдахгүй"
const desiredMove = { x: 0, y: 0, z: 0 };
const nextTranslation = { x: 0, y: 0, z: 0 };
const probePosition = { x: 0, y: 0, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const DOWN = { x: 0, y: -1, z: 0 };

export class Player {
  constructor(scene, physics) {
    const cfg = CONFIG.player;
    this.physics = physics;
    this.model = new PlayerModel();
    scene.add(this.model.root);

    // Капсулын төв = хөлийн ул + (halfHeight + radius)
    this.centerOffset = cfg.halfHeight + cfg.radius;
    this.spawnPosition = new THREE.Vector3(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z);

    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.spawnPosition.x,
        this.spawnPosition.y + this.centerOffset,
        this.spawnPosition.z,
      ),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(cfg.halfHeight, cfg.radius).setCollisionGroups(collisionGroups(GROUP.PLAYER)),
      this.body,
    );
    this.shape = new RAPIER.Capsule(cfg.halfHeight, cfg.radius); // Газар хайх shape cast-д

    const controller = world.createCharacterController(CONTROLLER_OFFSET);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(true);
    controller.enableAutostep(cfg.stepHeight, cfg.stepMinWidth, false);
    // Rapier-ийн snap-to-ground-ийн оронд snapToGround()-оо ашиглана (доорх тайлбарыг үз)
    controller.setMaxSlopeClimbAngle(cfg.maxSlopeClimb);
    controller.setMinSlopeSlideAngle(cfg.minSlopeSlide);
    controller.setApplyImpulsesToDynamicBodies(true); // Машин, конус, хайрцгийг түлхэнэ
    controller.setCharacterMass(cfg.mass);
    this.controller = controller;
    // Дүр юутай мөргөлдөх вэ (камерын тусгай бүлгээс бусад бүгд)
    this.queryGroups = collisionGroups(
      GROUP.PLAYER,
      GROUP.WORLD | GROUP.PROP | GROUP.VEHICLE | GROUP.NPC | GROUP.DEBRIS,
    );

    this.position = this.spawnPosition.clone(); // Хөлийн байрлал (физикийн сүүлийн алхам)
    this.prevPosition = this.position.clone(); // Өмнөх алхам (interpolation-д)
    this.renderPosition = this.position.clone(); // Дэлгэцэнд зурах байрлал
    this.velocity = new THREE.Vector3();
    this.moveInput = new THREE.Vector2();
    this.moveDirection = new THREE.Vector3();
    this.cameraYaw = 0;
    this.facing = cfg.spawnFacing;
    this.targetFacing = cfg.spawnFacing;
    this.running = false;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.horizontalSpeed = 0; // Бодит хэвтээ хурд (хананд тулбал 0) — анимаци, FOV-д
    this.stepOffset = 0; // Шатны гишгүүр бүрт загвар "үсрэхгүй" байх босоо зөрүү

    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facing;
  }

  /** Кадр бүр: оролтыг уншина (физик алхмаас тусдаа, учир нь алхам кадр бүр болохгүй байж болно). */
  handleInput(input, cameraYaw) {
    const move = input.getMoveVector();
    this.moveInput.set(move.x, move.y);
    this.running = input.isDown('run');
    this.cameraYaw = cameraYaw;
    if (input.wasPressed('jump')) this.jumpBufferTimer = CONFIG.player.jumpBuffer;
  }

  /** Тогтмол физик алхам (1/60 сек). */
  fixedUpdate(dt) {
    const cfg = CONFIG.player;

    // 1) Камерын чиглэлд харьцангуй хөдөлгөөн: урагш = камер харж буй зүг
    const sin = Math.sin(this.cameraYaw);
    const cos = Math.cos(this.cameraYaw);
    const ix = this.moveInput.x;
    const iy = this.moveInput.y;
    this.moveDirection.set(cos * ix - sin * iy, 0, -sin * ix - cos * iy);
    const amount = Math.min(1, this.moveDirection.length()); // Жойстикоор зөөлөн түлхвэл удаан алхана
    if (amount > 1e-3) this.moveDirection.divideScalar(this.moveDirection.length());
    const targetSpeed = (this.running ? cfg.runSpeed : cfg.walkSpeed) * amount;

    // 2) Хэвтээ хурдыг зорилтот хурд руу зөөлөн ойртуулна (хурдатгал/тоормос)
    const accel = this.grounded ? cfg.groundAccel : cfg.airAccel;
    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (this.moveDirection.x * targetSpeed - this.velocity.x) * k;
    this.velocity.z += (this.moveDirection.z * targetSpeed - this.velocity.z) * k;

    // 3) Үсрэлт: coyote time (ирмэгээс унасны дараахан) + jump buffer (газардахаас өмнөхөн дарсан)
    this.coyoteTimer = this.grounded ? cfg.coyoteTime : Math.max(0, this.coyoteTimer - dt);
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    let jumped = false;
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.velocity.y = cfg.jumpSpeed;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      jumped = true;
    }

    // 4) Хүндийн хүч. Газар дээр байхад босоо хурд 0 — хүссэн шилжилт нь хэвтээ л байна.
    //    Учир нь Rapier-ийн KCC (0.21) хавтгай шал руу налуу (урагш + доош) хөдөлгөөнийг
    //    тоон алдаанаас болж хааяа бүхэлд нь тасалдаг ("гацах") ба шатны autostep-ийг ч саатуулдаг.
    //    Доош налуу/шатаар буухад газарт наалдахыг snapToGround() хариуцна.
    const onGround = this.grounded && !jumped;
    if (onGround) this.velocity.y = 0;
    else this.velocity.y = Math.max(this.velocity.y + cfg.gravity * dt, -cfg.maxFallSpeed);

    // 5) Character controller: хүссэн шилжилтийг саадтай мөргөлдүүлж засна (хана дагуу гулсах, шатаар өгсөх)
    desiredMove.x = this.velocity.x * dt;
    desiredMove.y = this.velocity.y * dt;
    desiredMove.z = this.velocity.z * dt;
    this.controller.computeColliderMovement(
      this.collider,
      desiredMove,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.queryGroups,
    );
    const moved = this.controller.computedMovement();
    let grounded = !jumped && this.controller.computedGrounded();

    // 6) Газар дагах: өмнө нь газар дээр байсан бол доош налуу, шатны дагуу газарт наалдана
    if (onGround) {
      const gap = this.snapToGround(moved);
      if (gap !== null) {
        moved.y -= gap;
        grounded = true;
      }
      // Шат/хашлагаар өгсөх, буухад загварын өндрийг огцом биш, зөөлөн шилжүүлнэ
      if (Math.abs(moved.y) > 0.05) this.stepOffset = clamp(this.stepOffset - moved.y, -0.5, 0.5);
    }

    if (grounded) {
      if (!this.grounded && this.velocity.y < -4) this.model.land(clamp(-this.velocity.y / 18, 0, 1));
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else if (this.velocity.y > 0 && moved.y < desiredMove.y * 0.5) {
      this.velocity.y = 0; // Толгой тааз мөргөсөн
    }
    this.grounded = grounded;

    // Бодит хэвтээ хурд: хананд тулбал буурна, зорилтот хурдаас хэтрэхгүй (autostep-ийн түлхэлтийг үл тооно)
    const actualSpeed = Math.hypot(moved.x, moved.z) / dt;
    this.horizontalSpeed = Math.min(actualSpeed, Math.hypot(this.velocity.x, this.velocity.z));

    // 7) Байрлалыг шинэчилж, физикийн биед дамжуулна
    this.prevPosition.copy(this.position);
    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;
    nextTranslation.x = this.position.x;
    nextTranslation.y = this.position.y + this.centerOffset;
    nextTranslation.z = this.position.z;
    this.body.setNextKinematicTranslation(nextTranslation);

    if (this.position.y < cfg.fallRespawnY) this.respawn();
  }

  /**
   * Кадр бүр: физикийн хоёр алхмын хооронд байрлалыг interpolation хийж, дүрийг эргүүлж, анимацилна.
   * @param {number} alpha 0..1 — дараагийн физик алхам хүртэлх хувь
   */
  updateVisual(dt, alpha) {
    this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
    this.stepOffset = damp(this.stepOffset, 0, STEP_SMOOTHING, dt);
    this.model.root.position.set(this.renderPosition.x, this.renderPosition.y + this.stepOffset, this.renderPosition.z);

    // Дүр хөдөлж буй зүг рүүгээ эргэнэ
    if (this.moveInput.lengthSq() > 1e-4 && this.moveDirection.lengthSq() > 1e-6) {
      this.targetFacing = Math.atan2(this.moveDirection.x, this.moveDirection.z);
    }
    this.facing = dampAngle(this.facing, this.targetFacing, CONFIG.player.turnSpeed, dt);
    this.model.root.rotation.y = this.facing;

    this.model.animate(dt, {
      speed: this.horizontalSpeed,
      grounded: this.grounded,
      seated: false,
      walkSpeed: CONFIG.player.walkSpeed,
      runSpeed: CONFIG.player.runSpeed,
    });
  }

  /** Машинд сууж байх үеийн анимаци (загвар нь машины суудалд хавсарсан байна). */
  updateSeatedVisual(dt) {
    this.model.animate(dt, {
      speed: 0,
      grounded: true,
      seated: true,
      walkSpeed: CONFIG.player.walkSpeed,
      runSpeed: CONFIG.player.runSpeed,
    });
  }

  /**
   * Машинд суухад физик биеийг унтраана (машинтай мөргөлдөхгүй), буухад эргүүлж асаана.
   * @param {boolean} enabled
   */
  setPhysicsEnabled(enabled) {
    this.collider.setEnabled(enabled);
    this.velocity.set(0, 0, 0);
    this.horizontalSpeed = 0;
    this.jumpBufferTimer = 0;
    if (!enabled) this.grounded = false;
  }

  /** Машин жолоодож байхад тоглогчийн байрлал машиныг дагана (камер, сүүдэр, debug-д ашиглана). */
  followVehicle(position) {
    this.position.copy(position);
    this.prevPosition.copy(position);
    this.renderPosition.copy(position);
  }

  /**
   * Капсулыг доош "шидэж" (shape cast) хөл доорх газар хүртэлх зайг олно.
   * Налуу/шатаар буухад дүр агаарт "үсэрч" явахгүй, газраа дагана.
   * @param {{x:number,y:number,z:number}} moved Энэ алхмын KCC шилжилт
   * @returns {number|null} Доошлох зай (м), эсвэл ойрхон газар байхгүй бол null (ирмэгээс унах)
   */
  snapToGround(moved) {
    probePosition.x = this.position.x + moved.x;
    probePosition.y = this.position.y + this.centerOffset + moved.y;
    probePosition.z = this.position.z + moved.z;
    const hit = this.physics.world.castShape(
      probePosition,
      NO_ROTATION,
      DOWN,
      this.shape,
      CONTROLLER_OFFSET, // KCC-тэй адил 2 см зай үлдээнэ
      CONFIG.player.snapDistance,
      false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.queryGroups,
      this.collider,
      this.body,
    );
    // Доороос тулж буй аливаа гадаргуу (шал, налуу, шатны ирмэг) тохирно. Шатаар буухад капсулын
    // бөөрөнхий ул эхлээд гишгүүрийн ирмэгт хүрдэг (нормал нь налуу) — түүнийг дагаж гулсан бууна.
    if (!hit || hit.normal1.y < MIN_SUPPORT_NORMAL_Y) return null;
    return hit.time_of_impact;
  }

  /** Эхлэлийн цэг рүү буцаана (унасан, гацсан үед). */
  respawn() {
    this.teleport(this.spawnPosition, CONFIG.player.spawnFacing);
  }

  /**
   * Дүрийг шууд өгөгдсөн цэг рүү шилжүүлнэ (машинаас буух, буцах үед).
   * @param {{x:number,y:number,z:number}} position Хөлийн байрлал
   * @param {number} facing Харах чиглэл (радиан)
   */
  teleport(position, facing) {
    this.position.set(position.x, position.y, position.z);
    this.prevPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.horizontalSpeed = 0;
    this.stepOffset = 0;
    this.grounded = false;
    this.facing = this.targetFacing = facing;
    this.jumpBufferTimer = 0;
    const translation = { x: this.position.x, y: this.position.y + this.centerOffset, z: this.position.z };
    this.body.setTranslation(translation, true);
    this.body.setNextKinematicTranslation(translation);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    this.model.root.position.copy(this.position);
    // Машинаас буухад загварт машины хазайлт үлдэж болно — бүх тэнхлэгийг тэглээд зөвхөн чиглэлийг өгнө
    this.model.root.rotation.set(0, facing, 0);
  }

  /**
   * Энэ цэгт дүрийн капсул багтах уу (машинаас буух цэгийг шалгахад)?
   * @param {{x:number,y:number,z:number}} feetPosition
   */
  canStandAt(feetPosition) {
    probePosition.x = feetPosition.x;
    probePosition.y = feetPosition.y + this.centerOffset + 0.05;
    probePosition.z = feetPosition.z;
    const blocker = this.physics.world.intersectionWithShape(
      probePosition,
      NO_ROTATION,
      this.shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.queryGroups,
      this.collider,
      this.body,
    );
    return blocker === null;
  }

  setVisible(visible) {
    this.model.root.visible = visible;
  }
}
