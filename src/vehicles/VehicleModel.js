// Машины түр зуурын (placeholder) low-poly загвар.
// Их биеийг хажуугийн профайлаар (2D дүрс) зурж, өргөнөөр нь "шахаж" (extrude) гаргадаг —
// хэдхэн цэгээр машины дүрс гарна. Их биеийн төрөл бүр (BODY_TYPES) өөрийн профайл, гэрэл,
// суудлын байрлалтай. Дараа нь GLTF загвараар солихдоо зөвхөн энэ классыг өөрчилнө:
// Vehicle нь `root`, `seat`, `updateWheels()`, `setSteeringWheel()`, `setBrakeLights()`-ийг л ашигладаг.
// NPC машинууд энэ загвараас InstancedMesh-д зориулсан geometry гаргаж авдаг (npc/carVisuals.js).
import * as THREE from 'three';
import { lowPolyMaterial } from '../world/materials.js';
import { createPlateTexture } from '../world/textures.js';

/**
 * Их биеийн төрлүүд. Профайлын цэгүүд [урагш (z), дээш (y)] метрээр, машины эх цэг газрын түвшинд.
 * length — профайлыг зурсан урт (өөр урттай машинд z-ийг масштаблана).
 */
export const BODY_TYPES = {
  // Хибрид / такси (liftback)
  liftback: {
    length: 4.48,
    body: [[-2.24, 0.34], [2.14, 0.34], [2.25, 0.52], [2.22, 0.72], [1.95, 0.82], [1.0, 0.96], [-1.95, 1.0], [-2.24, 0.92], [-2.26, 0.55]],
    cabin: [[1.02, 0.95], [0.05, 1.42], [-0.95, 1.44], [-1.98, 0.99]],
    cabinInset: 0.2,
    roof: { front: 0.05, rear: -0.95, y: 1.445 },
    bPillar: { z: -0.38, from: 0.95, to: 1.43 },
    bumpers: { front: 2.2, rear: -2.22, y: 0.45 },
    grille: { z: 2.235, y: 0.6 },
    headlights: { z: 2.16, y: 0.74, x: 0.56 },
    taillights: { z: -2.245, y: 0.86, x: 0.58 },
    plates: { front: 2.275, frontY: 0.47, rear: -2.275, rearY: 0.63 },
    mirrors: { z: 0.92, y: 1.0 },
    seat: { hip: 0.44, z: -0.22, x: 0.38 },
    dash: { y: 0.88, z: 0.78 },
    column: { y: 0.86, z: 0.36 },
    rearSeat: { y: 0.62, z: -1.3 },
  },
  // Том жийп
  suv: {
    length: 4.9,
    body: [[-2.45, 0.46], [2.36, 0.46], [2.47, 0.64], [2.45, 0.98], [2.2, 1.1], [1.3, 1.2], [-2.36, 1.22], [-2.47, 1.12], [-2.47, 0.62]],
    cabin: [[1.32, 1.19], [0.55, 1.78], [-2.18, 1.8], [-2.36, 1.21]],
    cabinInset: 0.14,
    roof: { front: 0.5, rear: -2.15, y: 1.81 },
    bPillar: { z: -0.55, from: 1.2, to: 1.79 },
    bumpers: { front: 2.42, rear: -2.44, y: 0.58 },
    grille: { z: 2.47, y: 0.84 },
    headlights: { z: 2.41, y: 0.93, x: 0.66 },
    taillights: { z: -2.475, y: 1.0, x: 0.72 },
    plates: { front: 2.5, frontY: 0.6, rear: -2.5, rearY: 0.78 },
    mirrors: { z: 1.05, y: 1.28 },
    seat: { hip: 0.62, z: -0.35, x: 0.42 },
    dash: { y: 1.1, z: 0.95 },
    column: { y: 1.08, z: 0.5 },
    rearSeat: { y: 0.82, z: -1.45 },
  },
  // Микро автобус (van)
  van: {
    length: 5.2,
    body: [[-2.6, 0.42], [2.5, 0.42], [2.62, 0.6], [2.6, 1.02], [2.4, 1.12], [-2.55, 1.16], [-2.62, 1.06], [-2.62, 0.55]],
    cabin: [[2.42, 1.11], [1.85, 2.18], [-2.48, 2.24], [-2.58, 1.15]],
    cabinInset: 0.1,
    roof: { front: 1.85, rear: -2.48, y: 2.23 },
    bPillar: { z: 1.15, from: 1.12, to: 2.2 },
    bumpers: { front: 2.58, rear: -2.6, y: 0.52 },
    grille: { z: 2.62, y: 0.82 },
    headlights: { z: 2.57, y: 0.96, x: 0.68 },
    taillights: { z: -2.625, y: 1.0, x: 0.78 },
    plates: { front: 2.65, frontY: 0.55, rear: -2.65, rearY: 0.75 },
    mirrors: { z: 2.05, y: 1.45 },
    seat: { hip: 0.78, z: 1.25, x: 0.42 },
    dash: { y: 1.25, z: 2.1 },
    column: { y: 1.2, z: 1.75 },
    rearSeat: { y: 0.9, z: -0.6 },
  },
};

/** Профайлыг өргөнөөр шахаж, машины тэнхлэгт (урагш = +Z) тааруулсан geometry. */
function extrudeProfile(points, width, scale) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z * scale, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2); // Профайлын x → машины +Z, шахалт → X тэнхлэг
  geometry.translate(width / 2, 0, 0);
  return geometry;
}

/** Хоёр цэгийг холбосон нарийн "багана" (A, C багана). */
function strut(material, from, to, thickness, x) {
  const dz = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dz, dy);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, length), material);
  mesh.position.set(x, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
  mesh.rotation.x = -Math.atan2(dy, dz);
  return mesh;
}

export class VehicleModel {
  /**
   * @param {object} def vehicleTypes.js-ийн тодорхойлолт
   * @param {number} connectionY Дугуйн бэхэлгээний өндөр (Vehicle тооцоолно)
   * @param {{bodyColor?: number}} [options] Их биеийн өнгийг солих (NPC-ээс хулгайлсан машин г.м.)
   */
  constructor(def, connectionY, options = {}) {
    this.def = def;
    this.body = BODY_TYPES[def.body ?? 'liftback'];
    this.connectionY = connectionY;
    this.bodyColor = options.bodyColor ?? def.colors.body;
    this.root = new THREE.Group();
    this.root.name = 'Vehicle';
    this.wheels = [];
    this.build();
  }

  build() {
    const { def, root, body: b } = this;
    const { colors, size } = def;
    const s = size.length / b.length; // z тэнхлэгийн масштаб
    const halfWidth = size.width / 2;
    const driverX = def.rightHandDrive ? -b.seat.x : b.seat.x; // Баруун тал = −X

    const paint = lowPolyMaterial(this.bodyColor, { roughness: 0.45, metalness: 0.25 });
    this.paintMaterial = paint;
    const trim = lowPolyMaterial(colors.trim, { roughness: 0.7 });
    const glass = lowPolyMaterial(colors.glass, { roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.72 });
    const interior = lowPolyMaterial(colors.interior);
    const headlight = lowPolyMaterial(0xfff6dc, { emissive: 0xfff1c4, emissiveIntensity: 0.6, roughness: 0.3 });
    // Тоормосны гэрэл машин бүрт тусдаа материал (гэрэлтэлт нь өөрчлөгдөнө)
    this.brakeMaterial = new THREE.MeshStandardMaterial({
      color: 0x8c1d1d,
      emissive: 0xff2a1a,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      flatShading: true,
    });

    const add = (geometry, material, x = 0, y = 0, z = 0, parent = root) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const inside = (mesh) => {
      mesh.userData.interior = true; // NPC-ийн instanced загварт оруулахгүй
      return mesh;
    };

    // Их бие ба шилэн бүхээг
    add(extrudeProfile(b.body, size.width, s), paint);
    const cabinWidth = size.width - b.cabinInset;
    const cabin = add(extrudeProfile(b.cabin, cabinWidth, s), glass);
    cabin.castShadow = false;
    const roofLength = (b.roof.front - b.roof.rear) * s;
    add(new THREE.BoxGeometry(cabinWidth - 0.06, 0.05, roofLength), paint, 0, b.roof.y, ((b.roof.front + b.roof.rear) / 2) * s);

    // Баганууд (A, B, C)
    const pillarX = cabinWidth / 2 - 0.02;
    const [c0, c1, c2, c3] = b.cabin;
    const sc = (p) => [p[0] * s, p[1]];
    for (const side of [-1, 1]) {
      root.add(strut(paint, sc(c0), sc(c1), 0.07, side * pillarX));
      root.add(strut(paint, sc(c2), sc(c3), 0.07, side * pillarX));
      const bHeight = b.bPillar.to - b.bPillar.from;
      add(new THREE.BoxGeometry(0.07, bHeight, 0.1), trim, side * pillarX, (b.bPillar.from + b.bPillar.to) / 2, b.bPillar.z * s);
    }

    // Бампер, сараалж, толь
    add(new THREE.BoxGeometry(size.width + 0.02, 0.18, 0.14), trim, 0, b.bumpers.y, b.bumpers.front * s);
    add(new THREE.BoxGeometry(size.width + 0.02, 0.18, 0.12), trim, 0, b.bumpers.y + 0.02, b.bumpers.rear * s);
    add(new THREE.BoxGeometry(size.width * 0.52, 0.12, 0.05), trim, 0, b.grille.y, b.grille.z * s);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.2, 0.1, 0.07), trim, side * (halfWidth + 0.08), b.mirrors.y, b.mirrors.z * s);
    }

    // Урд, хойд гэрэл
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.42, 0.1, 0.06), headlight, side * b.headlights.x, b.headlights.y, b.headlights.z * s);
      add(new THREE.BoxGeometry(0.4, 0.1, 0.05), this.brakeMaterial, side * b.taillights.x, b.taillights.y, b.taillights.z * s);
    }

    // Улсын дугаар (урд, хойд)
    const plateMaterial = new THREE.MeshStandardMaterial({ map: createPlateTexture(def.plate), roughness: 0.6 });
    const plateGeometry = new THREE.PlaneGeometry(0.46, 0.115);
    add(plateGeometry, plateMaterial, 0, b.plates.frontY, b.plates.front * s).castShadow = false;
    const rearPlate = add(plateGeometry, plateMaterial, 0, b.plates.rearY, b.plates.rear * s);
    rearPlate.rotation.y = Math.PI;
    rearPlate.castShadow = false;

    // Таксины тэмдэг (дээвэр дээр)
    if (def.taxiSign) {
      add(new THREE.BoxGeometry(0.55, 0.2, 0.26), lowPolyMaterial(0xf6c026, { roughness: 0.5 }), 0, b.roof.y + 0.12, ((b.roof.front + b.roof.rear) / 2) * s);
      add(new THREE.BoxGeometry(0.57, 0.06, 0.28), trim, 0, b.roof.y + 0.1, ((b.roof.front + b.roof.rear) / 2) * s);
    }

    // Дотор тал: суудал, самбар, жолооны хүрд (шилээр харагдана)
    for (const x of [driverX, -driverX]) {
      inside(add(new THREE.BoxGeometry(0.48, 0.1, 0.5), interior, x, b.seat.hip - 0.07, b.seat.z * s));
      const back = inside(add(new THREE.BoxGeometry(0.48, 0.62, 0.1), interior, x, b.seat.hip + 0.26, (b.seat.z - 0.28) * s));
      back.rotation.x = -0.15;
    }
    inside(add(new THREE.BoxGeometry(size.width - 0.4, 0.45, 0.4), interior, 0, b.rearSeat.y, b.rearSeat.z * s));
    inside(add(new THREE.BoxGeometry(size.width - 0.3, 0.18, 0.38), interior, 0, b.dash.y, b.dash.z * s));
    const column = new THREE.Group();
    column.position.set(driverX, b.column.y, b.column.z * s);
    column.rotation.x = -0.5;
    root.add(column);
    this.steeringWheel = inside(add(new THREE.TorusGeometry(0.16, 0.025, 6, 14), trim, 0, 0, 0, column));
    inside(add(new THREE.BoxGeometry(0.3, 0.03, 0.02), trim, 0, 0, 0, this.steeringWheel)); // Хүрдний хөндлөвч

    // Жолоочийн суудал — тоглогчийн загвар энд хавсарна (хонго нь b.seat.hip өндөрт)
    this.seat = new THREE.Object3D();
    this.seat.position.set(driverX, b.seat.hip - 0.92, b.seat.z * s);
    root.add(this.seat);

    this.buildWheels();
  }

  buildWheels() {
    const w = this.def.wheels;
    const tire = lowPolyMaterial(0x1d1f22, { roughness: 0.95 });
    const rim = lowPolyMaterial(0xb9c0c7, { roughness: 0.35, metalness: 0.6 });
    const spoke = lowPolyMaterial(0x6d747c, { roughness: 0.5, metalness: 0.4 });
    const tireGeometry = new THREE.CylinderGeometry(w.radius, w.radius, w.width, 16);
    tireGeometry.rotateZ(Math.PI / 2); // Тэнхлэг нь X дагуу
    const rimGeometry = new THREE.CylinderGeometry(w.radius * 0.62, w.radius * 0.62, w.width + 0.012, 10);
    rimGeometry.rotateZ(Math.PI / 2);

    // Дараалал: 0 урд-зүүн, 1 урд-баруун, 2 хойд-зүүн, 3 хойд-баруун (зүүн = +X).
    // frontZ/rearZ нь машины бодит урт дахь байрлал (масштаблахгүй)
    const layout = [
      [w.halfTrack, w.frontZ],
      [-w.halfTrack, w.frontZ],
      [w.halfTrack, w.rearZ],
      [-w.halfTrack, w.rearZ],
    ];
    for (const [x, z] of layout) {
      const group = new THREE.Group();
      group.position.set(x, this.connectionY - w.suspensionRest, z);
      const tireMesh = new THREE.Mesh(tireGeometry, tire);
      tireMesh.castShadow = true;
      group.add(tireMesh, new THREE.Mesh(rimGeometry, rim));
      // Хөндлөвч — дугуй эргэж байгааг харуулна
      const outer = Math.sign(x) * (w.width / 2 + 0.008);
      for (const rotation of [0, Math.PI / 2]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.015, w.radius * 1.15, 0.07), spoke);
        bar.position.x = outer;
        bar.rotation.x = rotation;
        group.add(bar);
      }
      this.root.add(group);
      this.wheels.push(group);
    }
  }

  /**
   * Дугуйн байрлал, эргэлтийг физикээс шинэчилнэ.
   * @param {import('@dimforge/rapier3d-compat').DynamicRayCastVehicleController} controller
   */
  updateWheels(controller) {
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      const suspension = controller.wheelSuspensionLength(i) ?? this.def.wheels.suspensionRest;
      wheel.position.y = this.connectionY - suspension;
      // Эхлээд тэнхлэгээ тойрон эргэлдэнэ (X), дараа нь жолоогоор эргэнэ (Y)
      wheel.rotation.set(controller.wheelRotation(i) ?? 0, controller.wheelSteering(i) ?? 0, 0, 'YXZ');
    }
  }

  /** Жолооны хүрдийг дугуйн өнцөгтэй уялдуулж эргүүлнэ. */
  setSteeringWheel(angle) {
    this.steeringWheel.rotation.z = angle * 4;
  }

  setBrakeLights(on) {
    this.brakeMaterial.emissiveIntensity = on ? 2.2 : 0.35;
  }

  /** Загварыг ертөнцөөс устгах үед (GPU буфер чөлөөлөх). */
  dispose() {
    this.root.removeFromParent();
    this.brakeMaterial.dispose();
  }
}
