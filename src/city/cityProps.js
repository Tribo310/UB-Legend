// Хотын давтагддаг объектуудын geometry (InstancedMesh-д). Хэсэг бүрийн өнгийг vertex color-оор
// "шингээж", бүх хэсгийг нэг geometry болгон нэгтгэдэг → объект бүр нэг draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const color = new THREE.Color();

/** Geometry-д нэг өнгийн vertex color нэмнэ (index-гүй болгож, нэгтгэхэд бэлдэнэ). */
function painted(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  color.setHex(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return painted(g, hex);
}

function cylinder(rTop, rBottom, h, segments, x, y, z, hex) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments);
  g.translate(x, y, z);
  return painted(g, hex);
}

/** Vertex color-той low-poly материал (InstancedMesh-ийн instance өнгөтэй үржигдэнэ). */
export function vertexColorMaterial(overrides = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, ...overrides });
}

/** Гудамжны гэрэлт шон (7 м). Гар нь +Z зүг (зам руу) сунана. */
export function streetLampGeometry() {
  return mergeGeometries([
    cylinder(0.08, 0.12, 7, 6, 0, 3.5, 0, 0x3a3f46),
    box(0.1, 0.1, 1.6, 0, 6.9, 0.75, 0x3a3f46),
    box(0.42, 0.14, 0.6, 0, 6.82, 1.45, 0xf3ecd2),
  ]);
}

/** Гэрлэн дохионы чийдэнгүүдийн өндөр (дээрээс: улаан, шар, ногоон) ба нүүрний z. */
export const TRAFFIC_LAMPS = Object.freeze({ red: 3.92, yellow: 3.6, green: 3.28, faceZ: 0.18 });

/** Гэрлэн дохио: шон + 3 унтраалттай чийдэн. Асаалттай чийдэнг npc/TrafficSignals.js зурна. Нүүр нь +Z. */
export function trafficLightGeometry() {
  return mergeGeometries([
    cylinder(0.08, 0.1, 3.4, 6, 0, 1.7, 0, 0x2f3338),
    box(0.36, 1.05, 0.28, 0, 3.6, 0, 0x22262a),
    box(0.2, 0.2, 0.05, 0, TRAFFIC_LAMPS.red, 0.15, 0x4a2422),
    box(0.2, 0.2, 0.05, 0, TRAFFIC_LAMPS.yellow, 0.15, 0x4a3f22),
    box(0.2, 0.2, 0.05, 0, TRAFFIC_LAMPS.green, 0.15, 0x22422a),
  ]);
}

/** Троллейбусын утасны шон (8 м). */
export function trolleyPoleGeometry() {
  return mergeGeometries([cylinder(0.1, 0.14, 8, 6, 0, 4, 0, 0x4a5058), box(0.12, 0.12, 0.9, 0, 7.6, 0.4, 0x4a5058)]);
}

/** Монгол гэр (vertex color, нэг geometry). Хаалга нь +Z зүг рүү. Радиус ≈ 3.2 м. */
export function gerGeometry() {
  const R = 3.2;
  const wallH = 1.7;
  const roofH = 1.3;
  return mergeGeometries([
    cylinder(R, R, wallH, 14, 0, wallH / 2, 0, 0xf0ece1),
    cylinder(0.55, R + 0.25, roofH, 14, 0, wallH + roofH / 2, 0, 0xe2dccd),
    cylinder(0.62, 0.62, 0.14, 10, 0, wallH + roofH + 0.05, 0, 0x6e4b2a),
    cylinder(R + 0.03, R + 0.03, 0.07, 14, 0, 0.45, 0, 0x3d68a3),
    cylinder(R + 0.03, R + 0.03, 0.07, 14, 0, 1.3, 0, 0x3d68a3),
    box(1.2, 1.62, 0.12, 0, 0.81, R - 0.02, 0x6e4b2a),
    box(0.95, 1.45, 0.14, 0, 0.74, R, 0xc4532b),
    cylinder(0.08, 0.08, 1.3, 6, 0.75, wallH + roofH + 0.05, -0.2, 0x4d5157),
  ]);
}

/** Гэр хорооллын жижиг байшингийн их бие (6 × 3 × 5 м, суурь y = 0). */
export function houseBodyGeometry() {
  return mergeGeometries([
    box(6, 3, 5, 0, 1.5, 0, 0xffffff),
    box(1.0, 1.9, 0.1, 1.2, 0.95, 2.52, 0x5a3d24), // Хаалга
    box(1.2, 0.9, 0.08, -1.4, 1.7, 2.52, 0x2b3a48), // Цонх
  ]);
}

/** Байшингийн дөрвөн налуутай төмөр дээвэр (ногоон, улаан, хөх — instance өнгөөр). */
export function houseRoofGeometry() {
  const roof = new THREE.ConeGeometry(4.6, 1.8, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1, 1, 0.84);
  roof.translate(0, 3.9, 0);
  return painted(roof, 0xffffff);
}
