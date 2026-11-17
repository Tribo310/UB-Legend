// Хот барих: cityLayout.js-ийн өгөгдлөөс зам, явган зам, барилга, гол, гүүр, тойрог,
// гэрэлт шон, гэрлэн дохио, троллейбусын утсыг үүсгэж, бүгдэд нь collider нэмнэ.
//
// Гүйцэтгэл:
//  • Барилга, гэр, хашаа, шон, мод нь 240 м-ийн хэсгүүдэд (chunk) хуваагдсан InstancedMesh —
//    хэсэг бүр нэг-хоёр draw call, харагдахгүй хэсгийг frustum culling бүхэлд нь алгасна.
//  • LOD: камераас 560 м-ээс хол хэсэгт зөвхөн өндөр барилгууд, цонхгүй хямд материалаар.
//  • Зам, тэмдэглэгээ, явган зам нь цөөн нэгтгэсэн (merged) mesh.
//  • Цонх нь shader-ээр процедураар зурагдана (buildingMaterial.js) — текстур ачаалахгүй.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUP } from '../core/Physics.js';
import { clamp, lerp, mulberry32 } from '../core/utils.js';
import { lowPolyMaterial } from '../world/materials.js';
import { createTrees } from '../world/props.js';
import { makeStatic } from '../world/StaticBuilder.js';
import { createAsphaltTexture, createPavingTexture, createSteppeTexture } from '../world/textures.js';
import { createBuildingMaterial, createDistantBuildingMaterial } from './buildingMaterial.js';
import {
  gerGeometry,
  houseBodyGeometry,
  houseRoofGeometry,
  streetLampGeometry,
  trafficLightGeometry,
  trolleyPoleGeometry,
  vertexColorMaterial,
} from './cityProps.js';
import { AVENUE_Z, BRIDGES, buildRoadNetwork, RIVER, ROUNDABOUT, SIDEWALK, X_LINES, Z_LINES } from './cityLayout.js';

const CHUNK_SIZE = 240;
const LOD_DISTANCE = 560;
const SLAB = SIDEWALK.height; // Блок (явган зам) замаас 0.15 м өндөр
const ROAD_Y = 0.01;
const PAINT_Y = 0.02;
const RIVER_EXTENT = 1000;

/** Барилгын хэв маяг: их биеийн өнгө, фасад [цонхны алхам, давхар, цонхны өргөн %, өндөр %], шилний өнгө. */
const STYLES = {
  glass: {
    colors: [0x8ea6b9, 0x9db2c3, 0x7d93a6, 0xa7b7c3, 0x6f8799],
    facade: [3.0, 3.6, 0.9, 0.82],
    glass: [0x22364c, 0x2a4a66, 0x1d3550, 0x35546e],
  },
  office: {
    colors: [0xc8bea9, 0xb8b0a1, 0xd5cab5, 0xa8a39a, 0xbfa58a],
    facade: [3.4, 3.4, 0.56, 0.56],
    glass: [0x2a3644, 0x323e4a],
  },
  panel: {
    colors: [0xc9c5bd, 0xbfb5a8, 0xd4c3b2, 0xb6bcc2, 0xdacdbd, 0xc9b6a6],
    facade: [3.0, 2.8, 0.42, 0.46],
    glass: [0x384047, 0x2d343a],
  },
  luxury: {
    colors: [0xf1ede4, 0xe7e3d9, 0xf5efe5, 0xe9e2d2],
    facade: [3.6, 3.3, 0.72, 0.68],
    glass: [0x2b4257, 0x34506b],
  },
  villa: { colors: [0xe9dcc3, 0xd9c7a8, 0xf0e6d6], facade: [3.2, 3.0, 0.5, 0.55], glass: [0x2c3b48] },
  stall: {
    colors: [0xc8442f, 0x2f6fb5, 0xe2b43c, 0x3f8f4e, 0xd9772b, 0x8a4fa3, 0xe9e3d5, 0x2a9d8f],
    facade: [0, 0, 0, 0],
    glass: [0x000000],
  },
  warehouse: { colors: [0x9ca3a9, 0xb3a78f, 0xa49a8a], facade: [6, 4.2, 0.3, 0.24], glass: [0x2f3a44] },
  shed: { colors: [0x8a6a4a, 0x7a5d40, 0x9a7a55], facade: [0, 0, 0, 0], glass: [0x000000] },
  government: { colors: [0xeadfc8], facade: [3.6, 4.2, 0.5, 0.62], glass: [0x2a3a4a] },
};

const HOUSE_COLORS = [0xe8e0d0, 0xd9c9a9, 0xc9d4d8, 0xe2c8b8, 0xd8d2b0];
const ROOF_COLORS = [0x3f7f4f, 0xa63d2f, 0x2f5f9a, 0x6f7f3f, 0x8a3a3a];
const FENCE_COLORS = [0x7a5a3a, 0x6b4f33, 0x8a6a46, 0x5f4630];

const UP = new THREE.Vector3(0, 1, 0);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const tint = new THREE.Color();

/** Хэвтээ тэгш өнцөгт (y түвшинд), UV нь дэлхийн координатаар (tile м тутамд давтагдана). */
function flatRect(rect, y, tile = 1) {
  const { minX, maxX, minZ, maxZ } = rect;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([minX, y, minZ, minX, y, maxZ, maxX, y, maxZ, maxX, y, minZ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([minX / tile, minZ / tile, minX / tile, maxZ / tile, maxX / tile, maxZ / tile, maxX / tile, minZ / tile], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** Блокийн хашлагын (curb) дөрвөн босоо тал. */
function slabSides(rect, height) {
  const { minX, maxX, minZ, maxZ } = rect;
  const parts = [];
  const side = (w, x, z, rotY) => {
    const g = new THREE.PlaneGeometry(w, height);
    g.rotateY(rotY);
    g.translate(x, height / 2, z);
    parts.push(g);
  };
  side(maxX - minX, (minX + maxX) / 2, maxZ, 0);
  side(maxX - minX, (minX + maxX) / 2, minZ, Math.PI);
  side(maxZ - minZ, maxX, (minZ + maxZ) / 2, Math.PI / 2);
  side(maxZ - minZ, minX, (minZ + maxZ) / 2, -Math.PI / 2);
  return parts;
}

/** Тэнхлэгийн дагуу (axis = 'x' бол X чиглэлд урт) нарийн тэгш өнцөгт. */
function axisRect(axis, from, to, center, halfWidth) {
  return axis === 'x'
    ? { minX: from, maxX: to, minZ: center - halfWidth, maxZ: center + halfWidth }
    : { minX: center - halfWidth, maxX: center + halfWidth, minZ: from, maxZ: to };
}

function merge(parts) {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

export class CityBuilder {
  constructor(scene, physics, renderer) {
    this.scene = scene;
    this.physics = physics;
    this.renderer = renderer;
    this.random = mulberry32(7771);
    this.network = buildRoadNetwork();
    this.chunks = new Map();
    /** Газрын зурагт зориулсан хялбаршуулсан өгөгдөл (Minimap) */
    this.map = { roads: [], intersections: [], blocks: [], buildings: [], gers: [], trees: [], bridges: [], roundabout: ROUNDABOUT };
    this.buildingMaterial = createBuildingMaterial();
    this.distantMaterial = createDistantBuildingMaterial();
    this.unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // Суурь нь y = 0

    this.indexBlocks();
    this.buildRoads();
    this.buildBlocks();
    this.buildRiver();
    this.buildRoundabout();
    this.buildStreetFurniture();
    this.buildChunks();
  }

  pick(list) {
    return list[Math.floor(this.random() * list.length)];
  }

  // ---------- Блок, chunk хайлт ----------

  indexBlocks() {
    this.blockByCell = new Map();
    for (const block of this.network.blocks) this.blockByCell.set(`${block.cx},${block.cz}`, block);
  }

  /** Цэгийн доорх блок (байхгүй бол null). */
  blockAt(x, z) {
    const xi = X_LINES.findIndex((line, i) => i + 1 < X_LINES.length && x >= line && x < X_LINES[i + 1]);
    const zi = Z_LINES.findIndex((line, i) => i + 1 < Z_LINES.length && z >= line && z < Z_LINES[i + 1]);
    if (xi < 0 || zi < 0) return null;
    const block = this.blockByCell.get(`${(X_LINES[xi] + X_LINES[xi + 1]) / 2},${(Z_LINES[zi] + Z_LINES[zi + 1]) / 2}`);
    if (!block) return null;
    const r = block.rect;
    return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ ? block : null;
  }

  /** Тухайн цэгийн газрын өндөр (явган замын блок дээр 0.15, бусад газар 0). */
  surfaceY(x, z) {
    const block = this.blockAt(x, z);
    return block?.paved ? SLAB : 0;
  }

  chunkAt(x, z) {
    const i = Math.floor(x / CHUNK_SIZE);
    const j = Math.floor(z / CHUNK_SIZE);
    const key = `${i},${j}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = {
        center: new THREE.Vector3((i + 0.5) * CHUNK_SIZE, 0, (j + 0.5) * CHUNK_SIZE),
        buildings: [],
        gers: [],
        houses: [],
        fences: [],
        lamps: [],
        trafficLights: [],
        trolleyPoles: [],
        trees: [],
      };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  // ---------- Зам ----------

  buildRoads() {
    const asphalt = [];
    const dirt = [];
    const paint = [];
    for (const edge of this.network.edges) {
      const r = edge.rect;
      if (r.maxX - r.minX <= 0.1 || r.maxZ - r.minZ <= 0.1) continue;
      (edge.type === 'dirt' ? dirt : asphalt).push(flatRect(r, ROAD_Y, 6));
      this.map.roads.push({ rect: r, type: edge.type, bridge: edge.bridge });
      this.addLaneMarkings(edge, paint);
    }
    for (const node of this.network.nodes.values()) {
      if (node.roundabout || node.widthNS === 0 || node.widthEW === 0) continue;
      const rect = { minX: node.x - node.widthNS / 2, maxX: node.x + node.widthNS / 2, minZ: node.z - node.widthEW / 2, maxZ: node.z + node.widthEW / 2 };
      const paved = node.edges.some((e) => e.type !== 'dirt');
      (paved ? asphalt : dirt).push(flatRect(rect, ROAD_Y, 6));
      this.map.intersections.push({ rect, paved });
      // Явган хүний гарц: хатуу хучилттай бүх уулзварт (явган хүн эндүүр гарна, машин өмнө нь зогсоно)
      if (paved && node.edges.length >= 3) this.addCrosswalks(node, paint);
    }
    // Тойргийн цагираг зам
    const ring = new THREE.RingGeometry(ROUNDABOUT.island, ROUNDABOUT.radius, 48, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(ROUNDABOUT.x, ROAD_Y, ROUNDABOUT.z);
    const uv = ring.attributes.uv;
    const pos = ring.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
    asphalt.push(ring);

    const asphaltTexture = createAsphaltTexture(this.renderer);
    // polygonOffset: зам газрын хавтгайгаас үргэлж "урд" зурагдана (z-fighting үгүй)
    const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const asphaltMaterial = new THREE.MeshStandardMaterial({ map: asphaltTexture, roughness: 0.92, ...offset });
    const dirtMaterial = new THREE.MeshStandardMaterial({ map: asphaltTexture, color: 0xb59a74, roughness: 1, ...offset });
    const paintMaterial = lowPolyMaterial(0xf1f1ec, { roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const [parts, material, name] of [
      [asphalt.map((g) => (g.index ? g.toNonIndexed() : g)), asphaltMaterial, 'Roads'],
      [dirt.map((g) => (g.index ? g.toNonIndexed() : g)), dirtMaterial, 'DirtRoads'],
      [paint.map((g) => (g.index ? g.toNonIndexed() : g)), paintMaterial, 'RoadMarkings'],
    ]) {
      const geometry = merge(parts);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      makeStatic(mesh, false, true);
      this.scene.add(mesh);
    }
  }

  /** Замын тэмдэглэгээ: өргөн чөлөөнд давхар төв шугам + эгнээний тасархай, гудамжинд тасархай төв шугам. */
  addLaneMarkings(edge, parts) {
    if (edge.type === 'dirt') return;
    const r = edge.rect;
    const axis = edge.axis;
    const from = axis === 'x' ? r.minX : r.minZ;
    const to = axis === 'x' ? r.maxX : r.maxZ;
    const center = axis === 'x' ? (r.minZ + r.maxZ) / 2 : (r.minX + r.maxX) / 2;
    const dashed = (offset, dash, gap) => {
      for (let s = from + 2; s + dash < to - 2; s += dash + gap) parts.push(flatRect(axisRect(axis, s, s + dash, center + offset, 0.08), PAINT_Y));
    };
    if (edge.type === 'avenue') {
      for (const offset of [-0.22, 0.22]) parts.push(flatRect(axisRect(axis, from + 1, to - 1, center + offset, 0.07), PAINT_Y));
      dashed(-edge.width / 4, 3, 5);
      dashed(edge.width / 4, 3, 5);
    } else {
      dashed(0, 3, 4);
    }
  }

  /** Өргөн чөлөөний уулзвар бүрт явган хүний гарц (зебра). */
  addCrosswalks(node, parts) {
    for (const edge of node.edges) {
      if (edge.type === 'dirt' || edge.bridge) continue;
      const r = edge.rect;
      const other = edge.a === node ? edge.b : edge.a;
      const axis = edge.axis;
      const towardsPositive = axis === 'x' ? other.x > node.x : other.z > node.z;
      const edgeStart = axis === 'x' ? (towardsPositive ? r.minX : r.maxX) : towardsPositive ? r.minZ : r.maxZ;
      const s0 = towardsPositive ? edgeStart + 1 : edgeStart - 4;
      const s1 = s0 + 3;
      const acrossMin = axis === 'x' ? r.minZ : r.minX;
      const acrossMax = axis === 'x' ? r.maxZ : r.maxX;
      for (let a = acrossMin + 0.6; a + 0.5 < acrossMax - 0.4; a += 1.0) {
        parts.push(flatRect(axisRect(axis, s0, s1, a + 0.25, 0.25), PAINT_Y));
      }
    }
  }

  // ---------- Блок (явган зам) ба барилга ----------

  buildBlocks() {
    const sidewalk = [];
    const lots = [];
    const lawns = [];
    const curbs = [];
    const w = SIDEWALK.width;
    for (const block of this.network.blocks) {
      const r = block.rect;
      this.map.blocks.push({ rect: r, kind: block.kind, paved: block.paved });
      if (block.paved) {
        // Явган замын цагираг + дотор хэсэг (талбай, зүлэг)
        sidewalk.push(flatRect({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.minZ + w }, SLAB, 4));
        sidewalk.push(flatRect({ minX: r.minX, maxX: r.maxX, minZ: r.maxZ - w, maxZ: r.maxZ }, SLAB, 4));
        sidewalk.push(flatRect({ minX: r.minX, maxX: r.minX + w, minZ: r.minZ + w, maxZ: r.maxZ - w }, SLAB, 4));
        sidewalk.push(flatRect({ minX: r.maxX - w, maxX: r.maxX, minZ: r.minZ + w, maxZ: r.maxZ - w }, SLAB, 4));
        const inner = { minX: r.minX + w, maxX: r.maxX - w, minZ: r.minZ + w, maxZ: r.maxZ - w };
        const green = block.kind === 'park' || block.kind === 'khoroolol' || block.kind === 'zaisan';
        if (block.kind === 'square') sidewalk.push(flatRect(inner, SLAB, 4));
        else (green ? lawns : lots).push(flatRect(inner, SLAB, green ? 14 : 8));
        curbs.push(...slabSides(r, SLAB));
        this.physics.addStaticBox(
          { x: (r.minX + r.maxX) / 2, y: SLAB / 2, z: (r.minZ + r.maxZ) / 2 },
          { x: (r.maxX - r.minX) / 2, y: SLAB / 2, z: (r.maxZ - r.minZ) / 2 },
          { group: GROUP.WORLD },
        );
      }
      this.populateBlock(block);
    }

    const paving = createPavingTexture(this.renderer);
    const grass = createSteppeTexture(this.renderer);
    const groups = [
      [sidewalk, new THREE.MeshStandardMaterial({ map: paving, roughness: 0.95 }), 'Sidewalks'],
      [lots, new THREE.MeshStandardMaterial({ map: paving, color: 0xb9b4aa, roughness: 0.95 }), 'Lots'],
      [lawns, new THREE.MeshStandardMaterial({ map: grass, color: 0xc6d6a0, roughness: 1 }), 'Lawns'],
      [curbs.map((g) => g.toNonIndexed()), lowPolyMaterial(0xa8a39a), 'Curbs'],
    ];
    for (const [parts, material, name] of groups) {
      const geometry = merge(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      makeStatic(mesh, false, true);
      this.scene.add(mesh);
    }
  }

  populateBlock(block) {
    const r = block.rect;
    const w = SIDEWALK.width;
    const inner = { minX: r.minX + w, maxX: r.maxX - w, minZ: r.minZ + w, maxZ: r.maxZ - w };
    switch (block.kind) {
      case 'center':
        return this.populateDowntown(block, inner);
      case 'market':
        return this.populateMarket(block, inner);
      case 'khoroolol':
        return this.populateKhoroolol(block, inner);
      case 'gerNorth':
        return this.populateGerDistrict(block, r);
      case 'zaisan':
        return this.populateZaisan(block, inner);
      case 'park':
        return this.populatePark(block, inner);
      case 'square':
        return this.populateSquare(block, inner);
      default:
        return undefined;
    }
  }

  /**
   * Барилга нэмэх (харагдах instance + collider + газрын зураг).
   * @param {{x:number, z:number, w:number, d:number, h:number, y?:number, style:string, color?:number}} spec
   */
  addBuilding({ x, z, w, d, h, y = SLAB, style, color }) {
    const s = STYLES[style];
    this.chunkAt(x, z).buildings.push({ x, z, w, d, h, y, color: color ?? this.pick(s.colors), facade: s.facade, glass: this.pick(s.glass) });
    this.physics.addStaticBox({ x, y: y + h / 2, z }, { x: w / 2, y: h / 2, z: d / 2 }, { group: GROUP.WORLD });
    this.map.buildings.push({ x, z, w, d, h });
  }

  addTree(x, z, scaleFactor = 1) {
    const s = scaleFactor * (0.85 + this.random() * 0.5);
    this.chunkAt(x, z).trees.push({ x, z, y: this.surfaceY(x, z), scale: s, rotY: this.random() * Math.PI * 2 });
    const halfHeight = 1.2 * s;
    this.physics.addStaticCylinder({ x, y: halfHeight, z }, halfHeight, 0.22 * s, { group: GROUP.PROP });
    this.map.trees.push({ x, z });
  }

  /** Төв: шилэн цамхаг, оффисын барилга. Төвд ойртох тусам өндөр. */
  populateDowntown(block, inner) {
    const random = this.random;
    const lots = 2;
    const lotW = (inner.maxX - inner.minX) / lots;
    const lotD = (inner.maxZ - inner.minZ) / lots;
    const heightFactor = clamp(1 - Math.hypot(block.cx, block.cz) / 430, 0.25, 1);
    for (let i = 0; i < lots; i++) {
      for (let j = 0; j < lots; j++) {
        const cx = inner.minX + (i + 0.5) * lotW;
        const cz = inner.minZ + (j + 0.5) * lotD;
        if (random() < 0.12) {
          // Жижиг талбай + мод
          for (let k = 0; k < 4; k++) this.addTree(cx + (random() - 0.5) * lotW * 0.6, cz + (random() - 0.5) * lotD * 0.6);
          continue;
        }
        const isGlass = random() < 0.45 + heightFactor * 0.4;
        const w = lotW * (0.6 + random() * 0.28);
        const d = lotD * (0.6 + random() * 0.28);
        if (isGlass) {
          const h = lerp(28, 118, heightFactor) * (0.55 + random() * 0.55);
          if (random() < 0.4) {
            // Суурь (подиум) + түүн дээр нарийн цамхаг
            const podium = 8 + random() * 5;
            this.addBuilding({ x: cx, z: cz, w, d, h: podium, style: 'office' });
            this.addBuilding({ x: cx, z: cz, w: w * 0.62, d: d * 0.62, h, y: SLAB + podium, style: 'glass' });
          } else {
            this.addBuilding({ x: cx, z: cz, w, d, h, style: 'glass' });
          }
        } else {
          this.addBuilding({ x: cx, z: cz, w, d, h: 12 + random() * 26, style: 'office' });
        }
      }
    }
  }

  /** Их зах: урт лангууны эгнээ, заримд нь хаалттай захын байр. */
  populateMarket(block, inner) {
    const random = this.random;
    const width = inner.maxX - inner.minX;
    const depth = inner.maxZ - inner.minZ;
    const cx = (inner.minX + inner.maxX) / 2;
    if (random() < 0.45) {
      this.addBuilding({ x: cx, z: (inner.minZ + inner.maxZ) / 2, w: width - 26, d: depth - 26, h: 9 + random() * 4, style: 'warehouse' });
      // Байрыг тойрсон жижиг лангуунууд
      for (let x = inner.minX + 4; x < inner.maxX - 4; x += 7.5) {
        this.addBuilding({ x, z: inner.minZ + 3.5, w: 6, d: 5, h: 3 + random() * 1.2, style: 'stall' });
        this.addBuilding({ x, z: inner.maxZ - 3.5, w: 6, d: 5, h: 3 + random() * 1.2, style: 'stall' });
      }
      return;
    }
    // Нэг дээвэр доорх урт лангууны эгнээнүүд, хооронд нь гудамж
    const rows = 6;
    const rowDepth = 6;
    const pitch = depth / rows;
    for (let k = 0; k < rows; k++) {
      const z = inner.minZ + (k + 0.5) * pitch;
      this.addBuilding({ x: cx, z, w: width - 8 - random() * 6, d: rowDepth, h: 3.2 + random() * 1.6, style: 'stall' });
    }
  }

  /** Зүүн хороолол: 5 ба 9 давхар урт панель байрнууд, дунд нь хашаан доторх зүлэг, мод. */
  populateKhoroolol(block, inner) {
    const random = this.random;
    const width = inner.maxX - inner.minX;
    const depth = inner.maxZ - inner.minZ;
    const cx = (inner.minX + inner.maxX) / 2;
    const cz = (inner.minZ + inner.maxZ) / 2;
    const floors = () => (random() < 0.5 ? 5 * 2.8 + 1.4 : 9 * 2.8 + 1.8);
    this.addBuilding({ x: cx, z: inner.minZ + 7.5, w: width - 10, d: 12.5, h: floors(), style: 'panel' });
    this.addBuilding({ x: cx, z: inner.maxZ - 7.5, w: width - 10, d: 12.5, h: floors(), style: 'panel' });
    if (random() < 0.6) this.addBuilding({ x: inner.minX + 7.5, z: cz, w: 12.5, d: depth - 44, h: 5 * 2.8 + 1.4, style: 'panel' });
    for (let k = 0; k < 7; k++) this.addTree(cx + 6 + (random() - 0.5) * (width - 40), cz + (random() - 0.5) * (depth - 44));
  }

  /** Хойд толгой: модон хашаатай хашаанууд, дотор нь гэр эсвэл жижиг байшин. Шороон зам, явган замгүй. */
  populateGerDistrict(block, rect) {
    const random = this.random;
    const margin = 1.5;
    const alley = 6;
    const minX = rect.minX + margin;
    const maxX = rect.maxX - margin;
    const cols = 3;
    const plotW = (maxX - minX) / cols;
    const rowDepth = (rect.maxZ - rect.minZ - 2 * margin - alley) / 2;
    const rows = [
      { minZ: rect.minZ + margin, maxZ: rect.minZ + margin + rowDepth, gateSide: 'max' },
      { minZ: rect.maxZ - margin - rowDepth, maxZ: rect.maxZ - margin, gateSide: 'min' },
    ];
    const gate = 3.2;
    for (const row of rows) {
      // Босоо хашаанууд (хөрш хашаанууд хуваалцана)
      for (let k = 0; k <= cols; k++) this.addFence(minX + k * plotW, row.minZ, minX + k * plotW, row.maxZ);
      for (let c = 0; c < cols; c++) {
        const x0 = minX + c * plotW;
        const x1 = x0 + plotW;
        const gateZ = row.gateSide === 'max' ? row.maxZ : row.minZ;
        const wallZ = row.gateSide === 'max' ? row.minZ : row.maxZ;
        this.addFence(x0, wallZ, x1, wallZ);
        // Гудамж руу харсан талд хаалга (нээлттэй зай)
        const gateX = x0 + plotW * (0.3 + random() * 0.4);
        this.addFence(x0, gateZ, gateX - gate / 2, gateZ);
        this.addFence(gateX + gate / 2, gateZ, x1, gateZ);
        this.populatePlot({ minX: x0, maxX: x1, minZ: row.minZ, maxZ: row.maxZ }, gateZ);
      }
    }
  }

  populatePlot(plot, gateZ) {
    const random = this.random;
    const cx = (plot.minX + plot.maxX) / 2 + (random() - 0.5) * 6;
    const towardGate = Math.sign(gateZ - (plot.minZ + plot.maxZ) / 2);
    const cz = (plot.minZ + plot.maxZ) / 2 - towardGate * (4 + random() * 6);
    const roll = random();
    if (roll < 0.6) {
      // Гэр — хаалга нь урагш (+Z)
      this.chunkAt(cx, cz).gers.push({ x: cx, z: cz, rotY: (random() - 0.5) * 0.4 });
      this.physics.addStaticCylinder({ x: cx, y: 1.6, z: cz }, 1.6, 3.35, { group: GROUP.WORLD });
      this.map.gers.push({ x: cx, z: cz });
    } else if (roll < 0.95) {
      const rotY = towardGate > 0 ? 0 : Math.PI;
      this.chunkAt(cx, cz).houses.push({ x: cx, z: cz, rotY, body: this.pick(HOUSE_COLORS), roof: this.pick(ROOF_COLORS) });
      this.physics.addStaticBox({ x: cx, y: 2.3, z: cz }, { x: 3.1, y: 2.3, z: 2.6 }, { group: GROUP.WORLD });
      this.map.buildings.push({ x: cx, z: cz, w: 6, d: 5, h: 4.7 });
    }
    if (random() < 0.5) {
      // Жижиг агуулах / модон амбаар
      const sx = plot.maxX - 3.5;
      const sz = towardGate > 0 ? plot.minZ + 3.5 : plot.maxZ - 3.5;
      this.addBuilding({ x: sx, z: sz, w: 3, d: 3, h: 2.4, y: 0, style: 'shed' });
    }
  }

  /** Модон хашаа (2 м өндөр). (x1,z1) → (x2,z2) шулуун. */
  addFence(x1, z1, x2, z2) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.5) return;
    const x = (x1 + x2) / 2;
    const z = (z1 + z2) / 2;
    const rotY = Math.atan2(-(z2 - z1), x2 - x1);
    this.chunkAt(x, z).fences.push({ x, z, length, rotY, color: this.pick(FENCE_COLORS) });
    quaternion.setFromAxisAngle(UP, rotY);
    this.physics.addStaticBox({ x, y: 1, z }, { x: length / 2, y: 1, z: 0.07 }, { rotation: quaternion, group: GROUP.PROP });
  }

  /** Цагаан толгой: тансаг цамхаг, вилла, мод. (Үе шат 9-д толгодын газрын гадаргуу нэмэгдэнэ.) */
  populateZaisan(block, inner) {
    const random = this.random;
    const width = inner.maxX - inner.minX;
    const depth = inner.maxZ - inner.minZ;
    const cx = (inner.minX + inner.maxX) / 2;
    const cz = (inner.minZ + inner.maxZ) / 2;
    this.addBuilding({ x: cx - width * 0.18, z: cz - depth * 0.15, w: 22, d: 22, h: 40 + random() * 50, style: 'luxury' });
    if (random() < 0.6) this.addBuilding({ x: cx + width * 0.22, z: cz + depth * 0.2, w: 20, d: 18, h: 30 + random() * 35, style: 'luxury' });
    for (let k = 0; k < 3; k++) {
      this.addBuilding({ x: inner.minX + 10 + k * (width - 20) / 2, z: inner.maxZ - 9, w: 12, d: 10, h: 7 + random() * 3, style: 'villa' });
    }
    for (let k = 0; k < 6; k++) this.addTree(cx + (random() - 0.5) * (width - 12), cz + (random() - 0.5) * (depth - 30));
  }

  /** Голын эргийн цэцэрлэг: зүлэг, мод. */
  populatePark(block, inner) {
    const random = this.random;
    for (let k = 0; k < 26; k++) {
      this.addTree(inner.minX + 3 + random() * (inner.maxX - inner.minX - 6), inner.minZ + 3 + random() * (inner.maxZ - inner.minZ - 6), 1.1);
    }
  }

  /** Төв талбай: хойд талд нь Засгийн газрын ордон маягийн барилга, төвд нь хөшөө. */
  populateSquare(block, inner) {
    const cx = (inner.minX + inner.maxX) / 2;
    const width = inner.maxX - inner.minX;
    const palaceZ = inner.minZ + 15;
    const cream = STYLES.government.colors[0];
    this.addBuilding({ x: cx, z: palaceZ, w: width - 8, d: 24, h: 20, style: 'government', color: cream });
    this.addBuilding({ x: cx, z: palaceZ + 2, w: 30, d: 28, h: 28, style: 'government', color: cream });

    // Багануудтай үүдний хэсэг + дээвэр
    const white = lowPolyMaterial(0xf4efe4);
    const portico = new THREE.Group();
    const columnGeometry = new THREE.CylinderGeometry(0.7, 0.8, 14, 10);
    for (let k = 0; k < 8; k++) {
      const column = new THREE.Mesh(columnGeometry, white);
      column.position.set(cx - 12.25 + k * 3.5, SLAB + 7, palaceZ + 18);
      portico.add(column);
      this.physics.addStaticCylinder({ x: column.position.x, y: SLAB + 7, z: palaceZ + 18 }, 7, 0.8, { group: GROUP.WORLD });
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 6), white);
    roof.position.set(cx, SLAB + 14.8, palaceZ + 17);
    portico.add(roof);
    makeStatic(portico);
    this.scene.add(portico);

    // Талбайн төвийн хөшөө (зохиомол): тавцан + дөрвөлжин багана + алтан бөмбөлөг
    this.addMonument(cx, inner.minZ + 62, 1);
    for (const dx of [-1, 1]) {
      for (const dz of [0, 1]) this.addTree(cx + dx * (width / 2 - 6), inner.minZ + 46 + dz * 30, 1.1);
    }
  }

  addMonument(x, z, size) {
    const stone = lowPolyMaterial(0x8f8a80);
    const bronze = lowPolyMaterial(0x6b5a3e, { metalness: 0.4, roughness: 0.5 });
    const gold = lowPolyMaterial(0xd9a441, { metalness: 0.6, roughness: 0.35 });
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(7 * size, 1.6 * size, 7 * size), stone);
    base.position.set(x, SLAB + 0.8 * size, z);
    const stele = new THREE.Mesh(new THREE.CylinderGeometry(0.7 * size, 1.3 * size, 16 * size, 4), bronze);
    stele.rotation.y = Math.PI / 4;
    stele.position.set(x, SLAB + 1.6 * size + 8 * size, z);
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 * size, 1), gold);
    top.position.set(x, SLAB + 1.6 * size + 16.6 * size, z);
    group.add(base, stele, top);
    makeStatic(group);
    this.scene.add(group);
    this.physics.addStaticBox({ x, y: SLAB + 0.8 * size, z }, { x: 3.5 * size, y: 0.8 * size, z: 3.5 * size }, { group: GROUP.WORLD });
    this.physics.addStaticCylinder({ x, y: SLAB + 9.6 * size, z }, 8 * size, 1.2 * size, { group: GROUP.WORLD });
  }

  // ---------- Гол, далан, гүүр ----------

  buildRiver() {
    const { north, south, waterY } = RIVER;
    const water = new THREE.Mesh(
      flatRect({ minX: -RIVER_EXTENT, maxX: RIVER_EXTENT, minZ: north - 1, maxZ: south + 1 }, waterY),
      new THREE.MeshStandardMaterial({ color: 0x3f7391, roughness: 0.12, metalness: 0.15 }),
    );
    water.name = 'River';
    makeStatic(water, false, true);
    this.scene.add(water);
    this.map.water = { minX: -RIVER_EXTENT, maxX: RIVER_EXTENT, minZ: north, maxZ: south };

    // Гүүрээр тасалдсан далангийн хэсгүүд
    const bridgeSpans = BRIDGES.map((x) => {
      const width = x === 60 ? 22 : 14;
      return [x - width / 2 - 1.2, x + width / 2 + 1.2];
    }).sort((a, b) => a[0] - b[0]);
    const intervals = [];
    let cursor = -RIVER_EXTENT;
    for (const [a, b] of bridgeSpans) {
      intervals.push([cursor, a]);
      cursor = b;
    }
    intervals.push([cursor, RIVER_EXTENT]);

    const stone = lowPolyMaterial(0x9b958a);
    const rail = lowPolyMaterial(0x3c4148, { metalness: 0.3, roughness: 0.6 });
    const walls = new THREE.Group();
    const postPositions = [];
    for (const [bankZ, sign] of [[north, -1], [south, 1]]) {
      const wallZ = bankZ + (sign * 1.2) / 2; // Далангийн хана эргийн гадна тал руу 1.2 м зузаан
      for (const [x0, x1] of intervals) {
        const length = x1 - x0;
        const x = (x0 + x1) / 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 1.7, 1.2), stone);
        wall.position.set(x, waterY - 0.4 + 0.85, wallZ);
        const top = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, 0.08), rail);
        top.position.set(x, 1.5, bankZ + sign * 0.3);
        const mid = new THREE.Mesh(new THREE.BoxGeometry(length, 0.05, 0.05), rail);
        mid.position.set(x, 1.05, bankZ + sign * 0.3);
        walls.add(wall, top, mid);
        for (let px = x0 + 1; px < x1; px += 2.5) postPositions.push([px, bankZ + sign * 0.3]);
        // Хүн, машин гол руу унахгүй (≈1.6 м — үсэрч давахгүй)
        this.physics.addStaticBox({ x, y: 0.8, z: wallZ }, { x: length / 2, y: 0.8, z: 0.6 }, { group: GROUP.WORLD });
      }
    }
    // Гүүрийн их бие ба хашлага
    for (const bx of BRIDGES) {
      const width = bx === 60 ? 22 : 14;
      const half = width / 2 + 1.2;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.7, south - north + 2.4), stone);
      deck.position.set(bx, -0.35, (north + south) / 2);
      walls.add(deck);
      for (const side of [-1, 1]) {
        const x = bx + side * (half - 0.4);
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, south - north + 2.4), stone);
        parapet.position.set(x, 0.5, (north + south) / 2);
        walls.add(parapet);
        this.physics.addStaticBox({ x, y: 0.55, z: (north + south) / 2 }, { x: 0.25, y: 0.55, z: (south - north) / 2 + 1.2 }, { group: GROUP.WORLD });
      }
      this.map.bridges.push({ minX: bx - half, maxX: bx + half, minZ: north - 1.2, maxZ: south + 1.2 });
    }
    makeStatic(walls);
    this.scene.add(walls);

    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1.5, 0.07).translate(0, 0.75, 0), rail, postPositions.length);
    postPositions.forEach(([x, z], i) => posts.setMatrixAt(i, matrix.makeTranslation(x, 0, z)));
    posts.name = 'RiverRailPosts';
    makeStatic(posts, false, false);
    this.scene.add(posts);

    // Голын хоёр эргийн бургас (мод)
    for (let x = -RIVER_EXTENT + 20; x < RIVER_EXTENT - 20; x += 24 + this.random() * 18) {
      if (bridgeSpans.some(([a, b]) => x > a - 8 && x < b + 8)) continue;
      this.addTree(x + (this.random() - 0.5) * 6, north - 12 - this.random() * 14, 1.2);
      this.addTree(x + (this.random() - 0.5) * 6, south + 12 + this.random() * 14, 1.2);
    }
  }

  // ---------- Тойрог ----------

  buildRoundabout() {
    const { x, z, island } = ROUNDABOUT;
    const grass = lowPolyMaterial(0x6f9a4a);
    const curb = lowPolyMaterial(0xa8a39a);
    const isle = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(island - 0.4, island - 0.4, SLAB + 0.02, 40), grass);
    top.position.set(x, (SLAB + 0.02) / 2, z);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(island, island, SLAB, 40, 1, true), curb);
    ring.position.set(x, SLAB / 2, z);
    isle.add(top, ring);
    makeStatic(isle, false, true);
    this.scene.add(isle);
    this.physics.addStaticCylinder({ x, y: SLAB / 2, z }, SLAB / 2, island, { group: GROUP.WORLD });
    this.addMonument(x, z, 0.7);
  }

  // ---------- Гэрэлт шон, гэрлэн дохио, троллейбус ----------

  buildStreetFurniture() {
    const spacing = 36;
    for (const edge of this.network.edges) {
      if (edge.type === 'dirt') continue;
      const r = edge.rect;
      const along = edge.axis === 'x';
      const from = along ? r.minX : r.minZ;
      const to = along ? r.maxX : r.maxZ;
      const length = to - from;
      if (length < 20) continue;
      const count = Math.floor((length - 12) / spacing) + 1;
      const start = from + (length - (count - 1) * spacing) / 2;
      for (let k = 0; k < count; k++) {
        const s = start + k * spacing;
        if (!along && s > RIVER.north - 6 && s < RIVER.south + 6) continue; // Гүүр дээр шон тавихгүй
        // Шон хашлагаас 0.7 м — явган хүний алхах зурвасыг (1.4–3 м) чөлөөтэй үлдээнэ
        if (along) {
          this.addLamp(s, r.minZ - 0.7, 0);
          this.addLamp(s + spacing / 2 < to - 6 ? s + spacing / 2 : s, r.maxZ + 0.7, Math.PI);
        } else {
          this.addLamp(r.minX - 0.7, s, Math.PI / 2);
          this.addLamp(r.maxX + 0.7, s + spacing / 2 < to - 6 ? s + spacing / 2 : s, -Math.PI / 2);
        }
      }
      // Троллейбусын утас — төв өргөн чөлөөний дагуу
      if (edge.type === 'avenue' && along && r.minZ < AVENUE_Z && r.maxZ > AVENUE_Z) this.addTrolleyLine(edge);
    }

    // Өргөн чөлөөний уулзвар бүрт 4 гэрлэн дохио. Тус бүр нэг чиглэлээс ирж буй жолоочийн
    // баруун гар талын буланд, түүн рүү харж зогсоно (баруун гар талын хөдөлгөөн):
    //   зүүн-өмнөд булан → урдаас (хойд зүг рүү) ирэгчдэд, баруун-хойд → хойноос,
    //   баруун-өмнөд → баруунаас, зүүн-хойд → зүүнээс ирэгчдэд.
    this.trafficLights = [];
    for (const node of this.network.nodes.values()) {
      if (node.roundabout || node.widthNS === 0 || node.widthEW === 0) continue;
      if (!node.edges.some((e) => e.type === 'avenue')) continue;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = node.x + sx * (node.widthNS / 2 + 1.6);
        const z = node.z + sz * (node.widthEW / 2 + 1.6);
        const axis = sx === sz ? 'z' : 'x'; // Аль тэнхлэгийн дагуух хөдөлгөөнийг удирдах вэ
        const rotY = sx === sz ? (sx > 0 ? 0 : Math.PI) : sx < 0 ? -Math.PI / 2 : Math.PI / 2;
        const y = this.surfaceY(x, z);
        this.chunkAt(x, z).trafficLights.push({ x, y, z, rotY });
        this.trafficLights.push({ x, y, z, rotY, nodeId: node.id, axis });
        this.physics.addStaticCylinder({ x, y: 1.7, z }, 1.7, 0.12, { group: GROUP.PROP });
      }
    }
    this.buildTrolleyWires();
  }

  addLamp(x, z, rotY) {
    const y = this.surfaceY(x, z);
    this.chunkAt(x, z).lamps.push({ x, y, z, rotY });
    this.physics.addStaticCylinder({ x, y: y + 3.5, z }, 3.5, 0.14, { group: GROUP.PROP });
  }

  addTrolleyLine(edge) {
    const r = edge.rect;
    this.trolleySpans ??= [];
    const poleOffset = edge.width / 2 + 0.8;
    for (let x = r.minX + 8; x < r.maxX - 4; x += 40) {
      for (const side of [-1, 1]) {
        const z = AVENUE_Z + side * poleOffset;
        this.chunkAt(x, z).trolleyPoles.push({ x, y: this.surfaceY(x, z), z, rotY: side < 0 ? 0 : Math.PI });
        this.physics.addStaticCylinder({ x, y: 4, z }, 4, 0.14, { group: GROUP.PROP });
      }
      this.trolleySpans.push(x);
    }
    this.trolleyEdges ??= [];
    this.trolleyEdges.push(r);
  }

  /** Утаснууд: эгнээ бүрийн дээгүүр 2 утас + шон хоорондын хөндлөн утас (LineSegments — 1 draw call). */
  buildTrolleyWires() {
    if (!this.trolleyEdges) return;
    const points = [];
    const wireY = 6.6;
    for (const r of this.trolleyEdges) {
      for (const offset of [-5.8, -5.2, 5.2, 5.8]) {
        points.push(r.minX, wireY, AVENUE_Z + offset, r.maxX, wireY, AVENUE_Z + offset);
      }
    }
    const poleOffset = 22 / 2 + 0.8;
    for (const x of this.trolleySpans) points.push(x, 7.4, AVENUE_Z - poleOffset, x, 7.4, AVENUE_Z + poleOffset);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const wires = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x23272c }));
    wires.name = 'TrolleyWires';
    makeStatic(wires, false, false);
    this.scene.add(wires);
  }

  // ---------- Chunk → InstancedMesh + LOD ----------

  buildChunks() {
    const gerGeo = gerGeometry();
    const houseBody = houseBodyGeometry();
    const houseRoof = houseRoofGeometry();
    const lampGeo = streetLampGeometry();
    const trafficGeo = trafficLightGeometry();
    const trolleyGeo = trolleyPoleGeometry();
    const vcMaterial = vertexColorMaterial();
    const fenceMaterial = lowPolyMaterial(0xffffff, { roughness: 0.95 });

    for (const chunk of this.chunks.values()) {
      const lod = new THREE.LOD();
      lod.position.copy(chunk.center);
      const near = new THREE.Group();
      const far = new THREE.Group();
      const local = (item) => [item.x - chunk.center.x, item.y ?? 0, item.z - chunk.center.z];

      if (chunk.buildings.length) {
        near.add(this.buildingMesh(chunk, chunk.buildings, true));
        const tall = chunk.buildings.filter((b) => b.h > 10);
        if (tall.length) far.add(this.buildingMesh(chunk, tall, false));
      }
      const simple = (geometry, material, items, { castShadow = true, scaleOf = null } = {}) => {
        if (!items.length) return null;
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        items.forEach((item, i) => {
          position.fromArray(local(item));
          quaternion.setFromAxisAngle(UP, item.rotY ?? 0);
          if (scaleOf) scaleOf(item, scale);
          else scale.set(1, 1, 1);
          mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
          if (item.color !== undefined) mesh.setColorAt(i, tint.setHex(item.color));
        });
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        near.add(mesh);
        return mesh;
      };
      simple(gerGeo, vcMaterial, chunk.gers);
      simple(houseBody, vcMaterial, chunk.houses.map((h) => ({ ...h, color: h.body })));
      simple(houseRoof, vcMaterial, chunk.houses.map((h) => ({ ...h, color: h.roof })));
      simple(this.unitBox, fenceMaterial, chunk.fences, { scaleOf: (f, s) => s.set(f.length, 2, 0.14) });
      simple(lampGeo, vcMaterial, chunk.lamps, { castShadow: false });
      simple(trafficGeo, vcMaterial, chunk.trafficLights, { castShadow: false });
      simple(trolleyGeo, vcMaterial, chunk.trolleyPoles, { castShadow: false });
      if (chunk.trees.length) {
        const trees = chunk.trees.map((t) => ({ x: t.x - chunk.center.x, z: t.z - chunk.center.z, scale: t.scale, rotY: t.rotY }));
        for (const mesh of createTrees(trees, this.random)) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          near.add(mesh);
        }
      }

      lod.addLevel(near, 0);
      lod.addLevel(far, LOD_DISTANCE);
      // Матрицыг нэг удаа тооцоолно (сүүдрийн тохиргоог хэвээр үлдээнэ)
      lod.traverse((object) => {
        object.matrixAutoUpdate = false;
        object.updateMatrix();
      });
      this.scene.add(lod);
    }
  }

  /** Хэсгийн барилгууд → нэг InstancedMesh (ойрын: цонхтой фасад + сүүдэр, холын: хямд). */
  buildingMesh(chunk, list, detailed) {
    const geometry = this.unitBox.clone();
    const mesh = new THREE.InstancedMesh(geometry, detailed ? this.buildingMaterial : this.distantMaterial, list.length);
    if (detailed) {
      const facade = new Float32Array(list.length * 4);
      const glass = new Float32Array(list.length * 3);
      list.forEach((b, i) => {
        facade.set(b.facade, i * 4);
        tint.setHex(b.glass);
        glass[i * 3] = tint.r;
        glass[i * 3 + 1] = tint.g;
        glass[i * 3 + 2] = tint.b;
      });
      geometry.setAttribute('aFacade', new THREE.InstancedBufferAttribute(facade, 4));
      geometry.setAttribute('aGlass', new THREE.InstancedBufferAttribute(glass, 3));
    }
    list.forEach((b, i) => {
      position.set(b.x - chunk.center.x, b.y, b.z - chunk.center.z);
      quaternion.identity();
      scale.set(b.w, b.h, b.d);
      mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      mesh.setColorAt(i, tint.setHex(b.color));
    });
    mesh.name = detailed ? 'Buildings' : 'BuildingsFar';
    mesh.castShadow = detailed;
    mesh.receiveShadow = detailed;
    mesh.computeBoundingSphere();
    return mesh;
  }
}
