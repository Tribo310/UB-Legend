// 3-р этгээдийн (third-person) камер.
//  • Хулгана / баруун стикээр объектыг тойрон эргэнэ (yaw, pitch)
//  • Хулганы дугуйгаар ойртуулна / холдуулна (горим бүрт тусдаа санана)
//  • Хана, барилга камер ба объектын хооронд орвол камер урагшилж, саадыг нэвт харахгүй
//  • Профайл: "onFoot" (явган) ба "vehicle" (машин) — зай, өндөр, FOV өөр.
//    Машин жолоодох үед хулгана хөдөлгөхгүй бол камер машины ард аажмаар буцна.
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { clamp, damp, dampAngle } from '../core/utils.js';

const goal = new THREE.Vector3();
const direction = new THREE.Vector3();

export class ThirdPersonCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../core/Physics.js').Physics} physics
   * @param {import('../core/Settings.js').Settings} settings
   */
  constructor(camera, physics, settings) {
    const c = CONFIG.camera;
    this.camera = camera;
    this.physics = physics;
    this.settings = settings;
    this.profiles = { onFoot: c.onFoot, vehicle: c.vehicle };
    this.zoomByProfile = { onFoot: c.onFoot.distance, vehicle: c.vehicle.distance };
    this.profileName = 'onFoot';
    this.profile = c.onFoot;

    this.yaw = 0; // 0 үед камер объектын +Z талд, −Z зүг рүү харна
    this.pitch = this.profile.startPitch;
    this.targetDistance = this.profile.distance; // Тоглогчийн сонгосон зай (дугуй)
    this.zoomDistance = this.profile.distance; // Зөөлөрсөн зай
    this.distance = this.profile.distance; // Саадыг тооцсон бодит зай
    this.fov = c.fov;
    this.pivot = new THREE.Vector3();
    this.initialized = false;
    this.idleTime = 0; // Хулгана/стик хөдлөөгүй хугацаа
    this.forceRecenter = false; // Машинд суумагц хурдаас үл хамааран ард нь эргэнэ
    // Камерын цацраг зөвхөн WORLD бүлэгтэй мөргөлдөнө (мод, шон, дүр, машиныг үл тооно)
    this.rayGroups = collisionGroups(GROUP.CAMERA, GROUP.WORLD);
  }

  /** Камерын горим солих ("onFoot" | "vehicle"). Тоглогчийн сонгосон зайг горим бүрт санана. */
  setProfile(name) {
    if (name === this.profileName) return;
    this.zoomByProfile[this.profileName] = this.targetDistance;
    this.profileName = name;
    this.profile = this.profiles[name];
    this.targetDistance = this.zoomByProfile[name];
    this.pitch = clamp(this.pitch, this.profile.minPitch, this.profile.maxPitch);
  }

  /** Дараагийн update-ээр камерыг объектын ард шууд эргүүлж эхэлнэ. */
  requestRecenter() {
    this.forceRecenter = true;
  }

  handleInput(input, dt) {
    const c = CONFIG.camera;
    const sensitivity = c.mouseSensitivity * this.settings.get('mouseSensitivity');
    const invert = this.settings.get('invertY') ? -1 : 1;
    const stick = input.getLookStick();

    const yawDelta = input.mouseDX * sensitivity + stick.x * c.padYawSpeed * dt;
    const pitchDelta = (input.mouseDY * sensitivity + stick.y * c.padPitchSpeed * dt) * invert;
    if (yawDelta !== 0 || pitchDelta !== 0) {
      this.idleTime = 0;
      this.forceRecenter = false; // Тоглогч өөрөө камер удирдвал саад болохгүй
    }
    this.yaw -= yawDelta;
    this.pitch = clamp(this.pitch + pitchDelta, this.profile.minPitch, this.profile.maxPitch);
    if (input.wheel !== 0) {
      this.targetDistance = clamp(
        this.targetDistance * Math.pow(1.12, input.wheel),
        this.profile.minDistance,
        this.profile.maxDistance,
      );
    }
  }

  /** Цэс дээр (тоглоом эхлэхээс өмнө) камер аажуухан тойрно. */
  orbit(dt, speed = 0.08) {
    this.yaw += speed * dt;
  }

  /** Камерыг объектын ард шууд байрлуулна (эхлэх, буцах үед). */
  resetBehind(facing) {
    this.yaw = facing + Math.PI;
    this.pitch = this.profile.startPitch;
    this.targetDistance = this.zoomDistance = this.distance = this.profile.distance;
    this.initialized = false;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} focus Дагах объектын байрлал (дүрийн хөл / машины эх цэг)
   * @param {number} speed Объектын хурд (м/с) — FOV, зай, ард эргэх логикт
   * @param {number|null} [behindYaw] Объектын ард байх камерын yaw (машинд); null бол эргэхгүй
   */
  update(dt, focus, speed = 0, behindYaw = null) {
    const c = CONFIG.camera;
    const profile = this.profile;
    goal.set(focus.x, focus.y + profile.pivotHeight, focus.z);
    if (!this.initialized) {
      this.pivot.copy(goal);
      this.initialized = true;
    } else {
      const horizontal = 1 - Math.exp(-profile.followSharpness * dt);
      const vertical = 1 - Math.exp(-profile.verticalSharpness * dt);
      this.pivot.x += (goal.x - this.pivot.x) * horizontal;
      this.pivot.z += (goal.z - this.pivot.z) * horizontal;
      this.pivot.y += (goal.y - this.pivot.y) * vertical;
    }

    // Машины ард аажмаар эргэх (хулгана хэсэг хугацаанд хөдлөөгүй, машин явж байхад)
    this.idleTime += dt;
    if (profile.autoRecenter && behindYaw !== null) {
      const moving = Math.abs(speed) > profile.recenterMinSpeed;
      if (this.forceRecenter || (moving && this.idleTime > profile.recenterDelay)) {
        const sharpness = this.forceRecenter ? profile.recenterSharpness * 1.6 : profile.recenterSharpness;
        this.yaw = dampAngle(this.yaw, behindYaw, sharpness, dt);
        this.pitch = damp(this.pitch, profile.startPitch, sharpness, dt);
        if (this.forceRecenter && Math.abs(Math.atan2(Math.sin(behindYaw - this.yaw), Math.cos(behindYaw - this.yaw))) < 0.02) {
          this.forceRecenter = false;
        }
      }
    }

    // Хурдны мэдрэмж: FOV өргөсөж, (машинд) камер бага зэрэг холдоно
    const [slow, fast] = profile.fovSpeedRange;
    const speedAmount = clamp((Math.abs(speed) - slow) / (fast - slow), 0, 1);
    this.zoomDistance = damp(this.zoomDistance, this.targetDistance + profile.extraDistanceAtSpeed * speedAmount, c.zoomSharpness, dt);

    // Pivot-оос камер руу чиглэсэн нэгж вектор (бөмбөрцгийн координат)
    const cosPitch = Math.cos(this.pitch);
    direction.set(Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), Math.cos(this.yaw) * cosPitch);

    // Саад шалгах: pivot → камер цацраг. Саад руу шууд ойртож, саад арилахад аажмаар холдоно
    let allowed = this.zoomDistance;
    const hit = this.physics.castRay(this.pivot, direction, this.zoomDistance + c.collisionMargin, this.rayGroups);
    if (hit !== null) allowed = Math.max(c.minCollisionDistance, hit - c.collisionMargin);
    this.distance = allowed < this.distance ? allowed : damp(this.distance, allowed, c.collisionRecover, dt);

    this.camera.position.copy(this.pivot).addScaledVector(direction, this.distance);
    this.camera.lookAt(this.pivot);

    this.fov = damp(this.fov, c.fov + speedAmount * profile.fovBoost, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
