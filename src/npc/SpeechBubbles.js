// Яриан "хөөс": NPC-ийн толгой дээр богино текст (DOM элемент).
// Байрлалыг кадр бүр камерын проекцоор шинэчилнэ. Хол (≈38 м) эсвэл камерын ард бол харагдахгүй.
// Элементүүдийг дахин ашиглана (pool) — DOM байнга үүсгэж/устгахгүй.
import * as THREE from 'three';
import { clamp } from '../core/utils.js';

const MAX_BUBBLES = 6;
const MAX_DISTANCE = 38;
const projected = new THREE.Vector3();

export class SpeechBubbles {
  /**
   * @param {HTMLElement|null} container HUD доторх давхарга
   * @param {THREE.Camera} camera
   */
  constructor(container, camera) {
    this.container = container;
    this.camera = camera;
    this.active = [];
    this.pool = [];
  }

  /**
   * @param {{x:number, y:number, z:number}} anchor Дагах байрлал (жишээ нь ped.renderPosition)
   * @param {number} height Байрлалаас дээш хэдэн метрт харуулах
   * @param {string} text
   */
  say(anchor, height, text, duration = 2.8) {
    if (!this.container) return;
    const camera = this.camera.position;
    if (Math.hypot(anchor.x - camera.x, anchor.z - camera.z) > MAX_DISTANCE) return; // Хол бол сонсогдохгүй
    let bubble = this.active.find((b) => b.anchor === anchor);
    if (!bubble) {
      if (this.active.length >= MAX_BUBBLES) this.release(this.active[0]);
      bubble = this.pool.pop() ?? this.create();
      this.active.push(bubble);
    }
    bubble.anchor = anchor;
    bubble.height = height;
    bubble.time = duration;
    bubble.duration = duration;
    bubble.element.textContent = text;
    bubble.element.hidden = false;
  }

  create() {
    const element = document.createElement('div');
    element.className = 'speech';
    element.hidden = true;
    this.container.appendChild(element);
    return { element, anchor: null, height: 0, time: 0, duration: 0 };
  }

  release(bubble) {
    bubble.element.hidden = true;
    bubble.anchor = null;
    const index = this.active.indexOf(bubble);
    if (index >= 0) this.active.splice(index, 1);
    this.pool.push(bubble);
  }

  clear() {
    while (this.active.length > 0) this.release(this.active[0]);
  }

  update(dt) {
    if (this.active.length === 0) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const camera = this.camera.position;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const bubble = this.active[i];
      bubble.time -= dt;
      if (bubble.time <= 0) {
        this.release(bubble);
        continue;
      }
      projected.set(bubble.anchor.x, bubble.anchor.y + bubble.height, bubble.anchor.z);
      const distance = projected.distanceTo(camera);
      projected.project(this.camera);
      const visible = distance < MAX_DISTANCE && projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      bubble.element.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) continue;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const fadeIn = clamp((bubble.duration - bubble.time) / 0.15, 0, 1);
      const fadeOut = clamp(bubble.time / 0.35, 0, 1);
      const far = clamp(1 - (distance - 28) / 10, 0, 1);
      bubble.element.style.opacity = String(Math.min(fadeIn, fadeOut) * far);
      const scale = clamp(14 / distance, 0.75, 1.1);
      bubble.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    }
  }
}
