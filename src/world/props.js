// Түр зуурын (placeholder) 3D объектууд — энгийн геометр дүрсээр бүтээв.
// Дараа нь GLTF загвараар солихдоо зөвхөн эдгээр функцийн дотор талыг өөрчилнө
// (буцаах утга нь THREE.Object3D хэвээр үлдэнэ).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lowPolyMaterial } from './materials.js';
import { drawMeander } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Гэрийн хэмжээ (collider-т ашиглана). */
export const GER = Object.freeze({ radius: 3.2, wallHeight: 1.7, roofHeight: 1.3, height: 3.15 });

/** Монгол гэр: эсгий хана, дээвэр, тооно, улаан хаалга, зуухны яндан. Хаалга нь +Z (өмнө) зүгт. */
export function createGer() {
  const { radius: R, wallHeight: wallH, roofHeight: roofH } = GER;
  const felt = lowPolyMaterial(0xf0ece1);
  const roofFelt = lowPolyMaterial(0xe6e0d2);
  const rope = lowPolyMaterial(0x3d68a3);
  const door = lowPolyMaterial(0xc4532b);
  const wood = lowPolyMaterial(0x6e4b2a);
  const pipe = lowPolyMaterial(0x4d5157, { metalness: 0.3, roughness: 0.6 });

  const ger = new THREE.Group();
  ger.name = 'Ger';
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    ger.add(mesh);
    return mesh;
  };

  add(new THREE.CylinderGeometry(R, R, wallH, 16), felt, 0, wallH / 2, 0); // Хана (эсгий)
  add(new THREE.CylinderGeometry(0.55, R + 0.25, roofH, 16), roofFelt, 0, wallH + roofH / 2, 0); // Дээвэр
  add(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 12), wood, 0, wallH + roofH + 0.05, 0); // Тооно
  for (const y of [0.45, 1.3]) {
    add(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.07, 16), rope, 0, y, 0); // Бүслүүр олс
  }
  add(new THREE.BoxGeometry(1.2, 1.62, 0.12), wood, 0, 0.81, R - 0.02); // Хаалганы хүрээ
  add(new THREE.BoxGeometry(0.95, 1.45, 0.14), door, 0, 0.74, R); // Хаалга
  add(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 6), pipe, 0.75, wallH + roofH + 0.05, -0.2); // Яндан
  return ger;
}

/**
 * Мод — InstancedMesh: 70 мод = 2 draw call (их бие + навч).
 * @param {{x:number, z:number, scale:number, rotY:number}[]} trees
 * @returns {THREE.InstancedMesh[]}
 */
export function createTrees(trees, random) {
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.2, 2.4, 6);
  trunkGeometry.translate(0, 1.2, 0);
  const canopyGeometry = new THREE.IcosahedronGeometry(1.3, 0);
  canopyGeometry.scale(1, 1.3, 1);
  canopyGeometry.translate(0, 3.5, 0);

  const trunks = new THREE.InstancedMesh(trunkGeometry, lowPolyMaterial(0x6a4a30), trees.length);
  const canopies = new THREE.InstancedMesh(canopyGeometry, lowPolyMaterial(0xffffff), trees.length);
  trunks.name = 'TreeTrunks';
  canopies.name = 'TreeCanopies';

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const greens = [0x4f7a3a, 0x5d8a40, 0x46703a, 0x6b8f45];

  trees.forEach((tree, i) => {
    position.set(tree.x, 0, tree.z);
    rotation.setFromAxisAngle(UP, tree.rotY);
    scale.setScalar(tree.scale);
    matrix.compose(position, rotation, scale);
    trunks.setMatrixAt(i, matrix);
    canopies.setMatrixAt(i, matrix);
    color.setHex(greens[i % greens.length]).offsetHSL(0, 0, (random() - 0.5) * 0.06);
    canopies.setColorAt(i, color);
  });
  return [trunks, canopies];
}

/**
 * Гудамжны гэрэлт шон — нэг geometry дотор 3 хэсэг (шон, гар, гэрэл), InstancedMesh.
 * @param {{x:number, z:number, rotY:number}[]} placements rotY = 0 үед гэрэл +Z зүг рүү харна
 */
export function createLampPosts(placements, baseY = 0) {
  const pole = new THREE.CylinderGeometry(0.07, 0.1, 4.6, 6);
  pole.translate(0, 2.3, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.0);
  arm.translate(0, 4.5, 0.45);
  const head = new THREE.BoxGeometry(0.34, 0.12, 0.5);
  head.translate(0, 4.44, 0.9);
  const geometry = mergeGeometries([pole, arm, head], true); // true → хэсэг бүр өөрийн материалтай

  const metal = lowPolyMaterial(0x3c4148, { metalness: 0.3, roughness: 0.6 });
  const lamp = lowPolyMaterial(0xfff1c9, { emissive: 0xffd27a, emissiveIntensity: 0.5, roughness: 0.4 });
  const mesh = new THREE.InstancedMesh(geometry, [metal, metal, lamp], placements.length);
  mesh.name = 'LampPosts';

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  placements.forEach((placement, i) => {
    position.set(placement.x, baseY, placement.z);
    rotation.setFromAxisAngle(UP, placement.rotY);
    matrix.compose(position, rotation, one);
    mesh.setMatrixAt(i, matrix);
  });
  return mesh;
}

/** Байрлалаас хамаарсан тогтмол "санамсаргүй" утга (−0.5..0.5). Ижил цэг → ижил утга (ан цав үүсэхгүй). */
function hash3(x, y, z) {
  const s =
    Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/**
 * Хотыг тойрсон алс холын уулс (Богд уул маягаар өмнөд тал нь өндөр).
 * Бүх уулыг нэг geometry болгон нэгтгэсэн → 1 draw call.
 * @param {() => number} random
 * @param {{minDistance?: number, spread?: number, size?: number}} [options]
 */
export function createMountains(random, { minDistance = 520, spread = 220, size = 1 } = {}) {
  const geometries = [];
  const count = 22;
  const low = new THREE.Color(0x58703f);
  const high = new THREE.Color(0x8c7b5e);
  const tint = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.25;
    const south = Math.max(0, Math.sin(angle)); // +Z = өмнөд зүг
    const radius = (110 + random() * 120 + south * 60) * size;
    const height = (70 + random() * 90 + south * 90) * size;
    const distance = minDistance + random() * spread;

    const geometry = new THREE.ConeGeometry(radius, height, 7 + Math.floor(random() * 4), 4, true);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let v = 0; v < position.count; v++) {
      const x = position.getX(v);
      const y = position.getY(v);
      const z = position.getZ(v);
      const t = (y + height / 2) / height; // 0 = бэл, 1 = орой
      if (t > 0.001) {
        position.setXYZ(
          v,
          x + hash3(x, y, z) * radius * 0.22,
          y + hash3(z, x, y) * height * 0.12,
          z + hash3(y, z, x) * radius * 0.22,
        );
      }
      tint.copy(low).lerp(high, Math.min(1, t * 1.3));
      colors[v * 3] = tint.r;
      colors[v * 3 + 1] = tint.g;
      colors[v * 3 + 2] = tint.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.translate(Math.cos(angle) * distance, height / 2 - 3, Math.sin(angle) * distance);
    geometries.push(geometry);
  }

  const merged = mergeGeometries(geometries);
  geometries.forEach((geometry) => geometry.dispose());
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'Mountains';
  return mesh;
}

/** Самбарын хэмжээ (collider-т ашиглана). */
export const SIGN = Object.freeze({ width: 4.2, height: 3.1, boardHeight: 2.0 });

/**
 * Хоёр хэл дээр бичигдэх самбар (canvas текстур). draw(title, subtitle)-ийг хэл солигдох бүрт дахин дуудна.
 */
export function createSign(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 });
  const frame = lowPolyMaterial(0x2b2f36);
  const legHeight = SIGN.height - SIGN.boardHeight;

  const group = new THREE.Group();
  group.name = 'Sign';
  // BoxGeometry-ийн материалын дараалал: +X, −X, +Y, −Y, +Z (нүүр), −Z
  const board = new THREE.Mesh(new THREE.BoxGeometry(SIGN.width, SIGN.boardHeight, 0.14), [frame, frame, frame, frame, face, frame]);
  board.position.y = legHeight + SIGN.boardHeight / 2;
  group.add(board);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, legHeight + 0.2, 0.14), frame);
    post.position.set(side * (SIGN.width / 2 - 0.4), (legHeight + 0.2) / 2, -0.03);
    group.add(post);
  }

  const fontStack = '"Montserrat Variable", "Segoe UI", Roboto, Arial, sans-serif';
  function fitFont(text, weight, size, maxWidth) {
    let fontSize = size;
    do {
      ctx.font = `${weight} ${fontSize}px ${fontStack}`;
      fontSize -= 4;
    } while (ctx.measureText(text).width > maxWidth && fontSize > 20);
  }

  function draw(title, subtitle) {
    const { width, height } = canvas;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#1d3557');
    gradient.addColorStop(1, '#0f1c2e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    drawMeander(ctx, 40, 34, width - 80, 40, '#d9a441');
    drawMeander(ctx, 40, height - 74, width - 80, 40, '#d9a441');
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, width - 32, height - 32);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4efe4';
    fitFont(title, 800, 96, width - 140);
    ctx.fillText(title, width / 2, height * 0.44);
    ctx.fillStyle = '#e8bd5c';
    fitFont(subtitle, 600, 46, width - 160);
    ctx.fillText(subtitle, width / 2, height * 0.64);
    texture.needsUpdate = true;
  }

  return { group, draw };
}
