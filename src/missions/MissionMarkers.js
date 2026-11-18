// Даалгаврын 3D тэмдэг:
//   • газар дээр аажуухан эргэлддэг дугуй — ирмэгээр нь Монгол алхан хээ, голд нь дүрийн үсэг;
//   • дээш гарсан гэрэлт багана — холоос (барилгын дээгүүр) харагдана;
//   • машин, зорилт дээр хөвөх сум.
// Өнгө нь даалгавар өгсөн дүрийнх (Ганаа — шар, Багш — улаан, Сараа — цэнхэр), зорилт — алтан.
import * as THREE from 'three';
import { drawMeander } from '../world/textures.js';

const discTextures = new Map();
let beamAlpha = null;

/** Доороосоо дээш бүдгэрдэг босоо градиент (баганын alphaMap). */
function beamAlphaTexture() {
  if (beamAlpha) return beamAlpha;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#000');
  gradient.addColorStop(0.55, '#555');
  gradient.addColorStop(1, '#fff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 128);
  beamAlpha = new THREE.CanvasTexture(canvas);
  return beamAlpha;
}

/** Хээтэй дугуйн текстур (өнгө, үсэг бүрт нэг удаа зурна). */
function discTexture(color, letter) {
  const key = `${color}|${letter}`;
  let texture = discTextures.get(key);
  if (texture) return texture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.fillStyle = 'rgba(10, 14, 22, 0.35)';
  ctx.beginPath();
  ctx.arc(c, c, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  for (const radius of [120, 86]) {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Хоёр цагирагийн хооронд алхан хээ (тойргийн дагуу 14 хэсэг)
  for (let i = 0; i < 14; i++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((i / 14) * Math.PI * 2);
    drawMeander(ctx, -18, -113, 36, 20, color);
    ctx.restore();
  }
  if (letter) {
    ctx.fillStyle = color;
    ctx.font = '800 96px "Montserrat Variable", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, c, c + 6);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  discTextures.set(key, texture);
  return texture;
}

export class MissionMarker {
  /**
   * @param {THREE.Scene} scene
   * @param {{color: string, letter?: string, radius?: number, beam?: boolean}} options
   */
  constructor(scene, { color, letter = '', radius = 2.3, beam = true }) {
    this.group = new THREE.Group();
    this.group.name = 'MissionMarker';
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({ map: discTexture(color, letter), transparent: true, depthWrite: false, toneMapped: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.06;
    disc.renderOrder = 2;
    this.disc = disc;
    this.group.add(disc);
    if (beam) {
      this.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 40, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          alphaMap: beamAlphaTexture(),
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      this.beam.position.y = 20;
      this.group.add(this.beam);
    }
    scene.add(this.group);
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  set visible(value) {
    this.group.visible = value;
  }

  get visible() {
    return this.group.visible;
  }

  update(time) {
    this.disc.rotation.z = time * 0.35;
    if (this.beam) this.beam.material.opacity = 0.38 + Math.sin(time * 2.4) * 0.1;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
  }
}

/** Машин, дагах зорилт дээр хөвөх доош заасан сум. */
export class FloatingArrow {
  constructor(scene, color) {
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 4), material);
    this.mesh.rotation.x = Math.PI; // Үзүүр нь доошоо
    this.mesh.name = 'MissionArrow';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** @param {{x:number, y:number, z:number}|null} position */
  show(position, height, time) {
    if (!position) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(position.x, position.y + height + Math.sin(time * 3) * 0.18, position.z);
    this.mesh.rotation.y = time * 1.5;
  }

  hide() {
    this.mesh.visible = false;
  }
}
