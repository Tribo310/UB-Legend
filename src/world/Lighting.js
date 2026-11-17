// Гэрэлтүүлэг: тэнгэрийн (hemisphere) гэрэл + нар (directional) сүүдэртэй.
//
// Гүйцэтгэл: том ертөнц бүхэлдээ сүүдэрт орохгүй — сүүдрийн камер зөвхөн
// тоглогчийн эргэн тойронд (±40 м) дагаж хөдөлнө. Хөдлөх үед сүүдэр "чичрэхгүй"
// байхын тулд байрлалыг сүүдрийн текстурын пикселийн (texel) торонд тааруулна.
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

const SUN_DISTANCE = 150;
const snapped = new THREE.Vector3();

export class Lighting {
  constructor(scene) {
    // Нар баруун-өмнөд зүгээс тусна (+Z = өмнө, −X = баруун)
    this.sunDirection = new THREE.Vector3(-0.45, 0.78, 0.43).normalize();

    this.hemisphere = new THREE.HemisphereLight(0xd3e6ff, 0x7d6c48, 1.35);
    scene.add(this.hemisphere);

    const { shadowMapSize, shadowExtent } = CONFIG.graphics;
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const camera = sun.shadow.camera;
    camera.left = -shadowExtent;
    camera.right = shadowExtent;
    camera.top = shadowExtent;
    camera.bottom = -shadowExtent;
    camera.near = 1;
    camera.far = SUN_DISTANCE * 2;
    camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Сүүдрийн камерын координатын тэнхлэгүүд (баруун, дээш) — пикселд тааруулахад хэрэгтэй
    this.texelSize = (shadowExtent * 2) / shadowMapSize;
    this.lightRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDirection).normalize();
    this.lightUp = new THREE.Vector3().crossVectors(this.sunDirection, this.lightRight).normalize();
  }

  /** Нар болон сүүдрийн хүрээг өгөгдсөн цэг (тоглогч) рүү шилжүүлнэ. */
  update(focus) {
    const texel = this.texelSize;
    const right = Math.round(focus.dot(this.lightRight) / texel) * texel;
    const up = Math.round(focus.dot(this.lightUp) / texel) * texel;
    const forward = focus.dot(this.sunDirection);
    snapped
      .copy(this.lightRight)
      .multiplyScalar(right)
      .addScaledVector(this.lightUp, up)
      .addScaledVector(this.sunDirection, forward);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDirection, SUN_DISTANCE);
  }
}
