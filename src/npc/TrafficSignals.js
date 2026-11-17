// Гэрлэн дохио: уулзвар бүр өөрийн мөчлөгтэй.
//   хойд-өмнө ногоон → шар (3 с) → бүгд улаан (2 с) → зүүн-баруун ногоон → шар → бүгд улаан → ...
// Өргөн чөлөөний чиглэлд ногоон нь урт. Уулзваруудын мөчлөг байрлалаараа шилжсэн тул
// өргөн чөлөөгөөр явахад "ногоон долгион" маягаар гэрэл ээлжлэн асна.
// Асаалттай чийдэнг (улаан/шар/ногоон) гэрэлтдэг InstancedMesh-ээр зурна — 1 draw call.
import * as THREE from 'three';
import { TRAFFIC_LAMPS } from '../city/cityProps.js';

const YELLOW = 3;
const ALL_RED = 2;
const LAMP_COLORS = { red: 0xff3b30, yellow: 0xffc531, green: 0x37f07a };

const matrix = new THREE.Matrix4();
const local = new THREE.Matrix4();
const rotation = new THREE.Matrix4();
const color = new THREE.Color();

export class TrafficSignals {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./TrafficNetwork.js').TrafficNetwork} network
   * @param {{x:number, y:number, z:number, rotY:number, nodeId:string, axis:'x'|'z'}[]} lights CityBuilder.trafficLights
   */
  constructor(scene, network, lights) {
    /** @type {Map<string, {greenX:number, greenZ:number, cycle:number, time:number}>} */
    this.signals = new Map();
    for (const node of network.nodes.values()) {
      if (node.control !== 'signal') continue;
      const avenueX = node.net.edges.some((e) => e.type === 'avenue' && e.axis === 'x');
      const avenueZ = node.net.edges.some((e) => e.type === 'avenue' && e.axis === 'z');
      const greenX = avenueX && !avenueZ ? 18 : avenueZ && !avenueX ? 11 : 14;
      const greenZ = avenueZ && !avenueX ? 18 : avenueX && !avenueZ ? 11 : 14;
      const cycle = greenX + greenZ + 2 * (YELLOW + ALL_RED);
      const offset = (((node.x * 0.11 + node.z * 0.07) % cycle) + cycle) % cycle;
      this.signals.set(node.id, { greenX, greenZ, cycle, time: offset });
    }

    this.lights = lights.filter((light) => this.signals.has(light.nodeId));
    this.shown = new Array(this.lights.length).fill('');
    const glowMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.glow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.21, 0.21, 0.06), glowMaterial, Math.max(1, this.lights.length));
    this.glow.count = this.lights.length;
    this.glow.name = 'TrafficLightGlow';
    this.glow.frustumCulled = false;
    scene.add(this.glow);
    this.updateVisuals();
  }

  update(dt) {
    for (const signal of this.signals.values()) signal.time = (signal.time + dt) % signal.cycle;
  }

  /**
   * Тухайн тэнхлэгийн дагуу явж буй хөдөлгөөнд ямар гэрэл асаж байна вэ.
   * @param {string} nodeId
   * @param {'x'|'z'} axis 'z' — хойд-өмнө, 'x' — зүүн-баруун чиглэлийн хөдөлгөөн
   * @returns {'green'|'yellow'|'red'}
   */
  state(nodeId, axis) {
    const s = this.signals.get(nodeId);
    if (!s) return 'green';
    const t = s.time;
    const zRedEnd = s.greenZ + YELLOW + ALL_RED;
    if (axis === 'z') return t < s.greenZ ? 'green' : t < s.greenZ + YELLOW ? 'yellow' : 'red';
    if (t < zRedEnd) return 'red';
    const xGreenEnd = zRedEnd + s.greenX;
    return t < xGreenEnd ? 'green' : t < xGreenEnd + YELLOW ? 'yellow' : 'red';
  }

  /** Тухайн чиглэлийн ногоон эхэлснээс хойш хэдэн секунд өнгөрсөн бэ (мөчлөг доторх). */
  sinceGreen(s, axis) {
    const start = axis === 'z' ? 0 : s.greenZ + YELLOW + ALL_RED;
    return (s.time - start + s.cycle) % s.cycle;
  }

  /** Ногоон асах хүртэл хэдэн секунд (одоо ногоон бол 0). Явган хүн гарц эхлэх эсэхээ шийднэ. */
  timeUntilGreen(nodeId, axis) {
    const s = this.signals.get(nodeId);
    if (!s) return 0;
    const since = this.sinceGreen(s, axis);
    return since < (axis === 'z' ? s.greenZ : s.greenX) ? 0 : s.cycle - since;
  }

  /** Шар унтарсны дараах "бүгд улаан" үе — уулзвар дээр үлдсэн машин гарч дуусах хугацаа. */
  isClearing(nodeId, axis) {
    const s = this.signals.get(nodeId);
    if (!s) return false;
    const yellowEnd = (axis === 'z' ? s.greenZ : s.greenX) + YELLOW;
    const since = this.sinceGreen(s, axis);
    return since >= yellowEnd && since < yellowEnd + ALL_RED;
  }

  /** Асаалттай чийдэнг шинэчилнэ (зөвхөн өөрчлөгдсөн гэрлүүдийг). */
  updateVisuals() {
    let changed = false;
    this.lights.forEach((light, i) => {
      const state = this.state(light.nodeId, light.axis);
      if (state === this.shown[i]) return;
      this.shown[i] = state;
      rotation.makeRotationY(light.rotY);
      local.makeTranslation(0, TRAFFIC_LAMPS[state], TRAFFIC_LAMPS.faceZ);
      matrix.makeTranslation(light.x, light.y, light.z).multiply(rotation).multiply(local);
      this.glow.setMatrixAt(i, matrix);
      this.glow.setColorAt(i, color.setHex(LAMP_COLORS[state]));
      changed = true;
    });
    if (changed) {
      this.glow.instanceMatrix.needsUpdate = true;
      if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    }
  }
}
