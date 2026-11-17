// Батын түр зуурын (placeholder) low-poly загвар — энгийн хайрцагнуудаас бүтэв.
// Хүрэм нь дээлийн энгэр маягийн алтан хээтэй. Анимаци нь процедурын (кодоор тооцоолно),
// тиймээс анимацийн файл шаардлагагүй.
//
// Дараа нь GLTF загвар (жишээ нь Blender-ээс) оруулахдаа энэ классыг солиход л хангалттай:
// Player нь зөвхөн `root`, `animate()`, `land()` гэсэн гадаад интерфэйсийг ашигладаг.
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';

const COLORS = {
  skin: 0xc58c5c,
  jacket: 0x23507f, // Хөх хүрэм
  trim: 0xd9a441, // Алтан хээ (энгэр, зах)
  sash: 0xc4532b, // Бүс
  pants: 0x2a2e35,
  shoes: 0x3b2a1e,
  hair: 0x16120f,
  eyes: 0x111111,
};

export class PlayerModel {
  constructor() {
    this.root = new THREE.Group(); // Хөлийн ул дээр, Y тэнхлэгээр эргэнэ
    this.root.name = 'Player';
    this.materials = {};
    for (const [name, color] of Object.entries(COLORS)) {
      this.materials[name] = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
    }
    this.build();

    // Анимацийн төлөв
    this.phase = 0; // Алхмын мөчлөгийн үе (радиан)
    this.time = 0;
    this.moveBlend = 0; // 0 = зогсож байна, 1 = алхаж байна
    this.runBlend = 0; // 0 = алхах, 1 = гүйх
    this.airBlend = 0; // 1 = агаарт
    this.seatBlend = 0; // 1 = машинд сууж байна
    this.landDip = 0; // Газардахад суух хэмжээ
  }

  /** Хайрцаг хэлбэрийн биеийн хэсэг. */
  part(parent, width, height, depth, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Үе мөч (эргэх цэг). */
  joint(parent, x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }

  build() {
    // Хонго: бие ба хөлний эцэг (≈0.92 м өндөрт)
    this.hips = this.joint(this.root, 0, 0.92, 0);
    this.part(this.hips, 0.38, 0.18, 0.23, 'pants', 0, 0.02, 0);

    // Их бие (гүйхэд урагш бөхийнө)
    this.torso = this.joint(this.hips, 0, 0.08, 0);
    this.part(this.torso, 0.44, 0.5, 0.25, 'jacket', 0, 0.25, 0);
    this.part(this.torso, 0.46, 0.07, 0.27, 'sash', 0, 0.04, 0);
    const lapel = this.part(this.torso, 0.045, 0.3, 0.012, 'trim', -0.08, 0.33, 0.129);
    lapel.rotation.z = -Math.PI / 4; // Дээлийн энгэр: хүзүүнээс баруун суга руу
    this.part(this.torso, 0.3, 0.06, 0.27, 'trim', 0, 0.5, 0);
    this.part(this.torso, 0.1, 0.07, 0.1, 'skin', 0, 0.535, 0);

    // Толгой (нүд нь урд талыг заана)
    this.head = this.joint(this.torso, 0, 0.57, 0);
    this.part(this.head, 0.23, 0.26, 0.24, 'skin', 0, 0.13, 0);
    this.part(this.head, 0.25, 0.08, 0.26, 'hair', 0, 0.27, -0.005);
    this.part(this.head, 0.25, 0.16, 0.06, 'hair', 0, 0.2, -0.1);
    this.part(this.head, 0.045, 0.03, 0.012, 'eyes', -0.055, 0.15, 0.121);
    this.part(this.head, 0.045, 0.03, 0.012, 'eyes', 0.055, 0.15, 0.121);

    // Гар: мөр → тохой → гар
    this.arms = [-1, 1].map((side) => {
      const shoulder = this.joint(this.torso, side * 0.29, 0.46, 0);
      this.part(shoulder, 0.12, 0.34, 0.13, 'jacket', 0, -0.15, 0);
      const elbow = this.joint(shoulder, 0, -0.31, 0);
      this.part(elbow, 0.11, 0.28, 0.12, 'jacket', 0, -0.13, 0);
      this.part(elbow, 0.09, 0.09, 0.09, 'skin', 0, -0.31, 0);
      return { shoulder, elbow, side };
    });

    // Хөл: хонго → өвдөг → гутал
    this.legs = [-1, 1].map((side) => {
      const hip = this.joint(this.hips, side * 0.11, -0.02, 0);
      this.part(hip, 0.16, 0.44, 0.18, 'pants', 0, -0.22, 0);
      const knee = this.joint(hip, 0, -0.44, 0);
      this.part(knee, 0.15, 0.42, 0.16, 'pants', 0, -0.21, 0);
      this.part(knee, 0.16, 0.08, 0.27, 'shoes', 0, -0.42, 0.04);
      return { hip, knee, side };
    });
  }

  /**
   * Процедурын анимаци: зогсох (амьсгаа), алхах, гүйх, агаарт байх, газардах, машинд суух.
   * @param {number} dt
   * @param {{speed:number, grounded:boolean, seated:boolean, walkSpeed:number, runSpeed:number}} state
   */
  animate(dt, state) {
    this.time += dt;
    const move = clamp(state.speed / state.walkSpeed, 0, 1);
    const run = clamp((state.speed - state.walkSpeed) / (state.runSpeed - state.walkSpeed), 0, 1);
    this.moveBlend = damp(this.moveBlend, move, 10, dt);
    this.runBlend = damp(this.runBlend, run, 6, dt);
    this.airBlend = damp(this.airBlend, state.grounded ? 0 : 1, 14, dt);
    this.seatBlend = damp(this.seatBlend, state.seated ? 1 : 0, 9, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);

    // Алхмын давтамж явсан зайтай пропорциональ → хөл газар "гулсахгүй"
    const strideLength = lerp(1.4, 2.6, this.runBlend);
    if (state.grounded) this.phase += (state.speed / strideLength) * Math.PI * 2 * dt;

    const sinP = Math.sin(this.phase);
    const cosP = Math.cos(this.phase);
    const air = this.airBlend;
    const ground = 1 - air;
    const idle = 1 - this.moveBlend;
    const swing = lerp(0.5, 0.95, this.runBlend) * this.moveBlend * ground;
    const kneeBend = lerp(0.55, 1.5, this.runBlend) * this.moveBlend;
    const breath = Math.sin(this.time * 2.1);

    // Суух байрлал руу шилжих жин: 0 = хөдөлгөөний анимаци, 1 = машинд сууж, жолооны хүрд барина
    const seat = this.seatBlend;
    const mix = (pose, seated) => pose + (seated - pose) * seat;

    // Хөл: урагш савлах үед өвдөг нугарна
    const [legL, legR] = this.legs;
    legL.hip.rotation.x = mix(-sinP * swing - 0.55 * air, -1.45);
    legR.hip.rotation.x = mix(sinP * swing + 0.3 * air, -1.45);
    legL.knee.rotation.x = mix((Math.max(0, cosP) * kneeBend + 0.05) * ground + 0.9 * air, 1.35);
    legR.knee.rotation.x = mix((Math.max(0, -cosP) * kneeBend + 0.05) * ground + 0.5 * air, 1.35);

    // Гар: хөлний эсрэг савлана, агаарт тэнцвэр барьж дэлгэнэ
    const [armL, armR] = this.arms;
    const armSwing = swing * 0.85;
    armL.shoulder.rotation.x = mix(sinP * armSwing - 0.35 * air, -1.05);
    armR.shoulder.rotation.x = mix(-sinP * armSwing - 0.35 * air, -1.05);
    const spread = 0.07 + 0.55 * air + 0.015 * breath * idle;
    armL.shoulder.rotation.z = mix(-spread, 0.1);
    armR.shoulder.rotation.z = mix(spread, -0.1);
    const elbow = lerp(0.2, 1.25, this.runBlend) * this.moveBlend + 0.12 + 0.3 * air;
    armL.elbow.rotation.x = mix(-elbow, -0.5);
    armR.elbow.rotation.x = mix(-elbow, -0.5);

    // Их бие: гүйхэд урагш бөхийж, мөр нь хөлний эсрэг бага зэрэг эргэнэ; суухад бага зэрэг налж сууна
    this.torso.rotation.x = mix(lerp(0.04, 0.2, this.runBlend) * this.moveBlend, -0.1);
    this.torso.rotation.y = mix(sinP * 0.1 * swing, 0);

    // Алхам бүрт дээш доош савлах + газардах үед суух + амьсгаа
    const bob = (1 - Math.abs(cosP)) * lerp(0.025, 0.06, this.runBlend) * this.moveBlend * ground;
    this.hips.position.y = mix(0.92 - bob - this.landDip * 0.14 + breath * 0.004 * idle, 0.92);
  }

  /** Газардах үеийн "суух" эффект. impact: 0..1 */
  land(impact) {
    this.landDip = Math.max(this.landDip, impact);
  }
}
