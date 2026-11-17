// Сургалтын талбай (хотын зах): хөдөлгөөн, үсрэлт, шат, налуу, камерын мөргөлдөөнийг шалгах
// объектууд ба зүүн талд нь жолоодлогын талбай (конус, трамплин).
// Бүх байрлал локал координатаар — origin-оор дэлхий дээр хаана ч байрлуулж болно.
//
// Чиглэл: −Z = хойд, +Z = өмнөд, +X = зүүн, −X = баруун.
import * as THREE from 'three';
import { GROUP } from '../core/Physics.js';
import { mulberry32 } from '../core/utils.js';
import { ACCESS_ROAD, DRIVING_AREA, DrivingArea } from './DrivingArea.js';
import { lowPolyMaterial } from './materials.js';
import { createGer, createLampPosts, createTrees, GER } from './props.js';
import { placeSign } from './signs.js';
import { StaticBuilder } from './StaticBuilder.js';
import { createCrateTexture, createOrnamentTexture, createPavingTexture } from './textures.js';

export const PLAZA_SIZE = 44;
export const PLAZA_HEIGHT = 0.15; // Талбай газраас бага зэрэг өндөр — "хашлага" дээр автоматаар гарахыг шалгана
const TOP = PLAZA_HEIGHT;

const GER_SPOTS = [
  { x: -32, z: 30, rotY: 0 },
  { x: -41, z: 22, rotY: 0.25 },
];

/** Талбай дээрх машины зогсоол (локал координат). */
export const TRAINING_VEHICLE_SPAWNS = [{ type: 'hybrid', position: { x: 5, y: TOP + 0.05, z: 3.5 }, yaw: Math.PI / 2 }];

/** Сургалтын талбайн локал хүрээ (газрын зураг, мод тарихад). */
export const TRAINING_BOUNDS = Object.freeze({ minX: -50, maxX: 175, minZ: -40, maxZ: 48 });

export class TestZone {
  /**
   * @param {{x:number, z:number}} origin Талбайн төв дэлхийн координатаар
   */
  constructor(scene, physics, renderer, origin) {
    this.scene = scene;
    this.physics = physics;
    this.renderer = renderer;
    this.origin = origin;
    this.builder = new StaticBuilder(scene, physics, origin);
    const random = mulberry32(20261117);

    this.buildPlaza();
    this.buildParkour();
    this.buildCrates();
    this.buildWallAndPillars();
    this.buildGers();
    this.buildLamps();
    this.buildTrees(random);
    placeSign(this.builder, renderer, {
      x: -4.5,
      y: TOP,
      z: 3,
      rotY: 0.35,
      titleKey: 'world.signTitle',
      subtitleKey: 'world.signSubtitle',
    });
    this.drivingArea = new DrivingArea(scene, physics, renderer, this.builder);
  }

  /** Талбайн машины зогсоолуудыг дэлхийн координатаар буцаана. */
  getVehicleSpawns() {
    return TRAINING_VEHICLE_SPAWNS.map((spawn) => ({
      ...spawn,
      position: this.builder.toWorld(spawn.position.x, spawn.position.y, spawn.position.z),
    }));
  }

  /** Төв талбай: бетон хавтанцар. */
  buildPlaza() {
    const paving = createPavingTexture(this.renderer);
    paving.repeat.set(PLAZA_SIZE / 4, PLAZA_SIZE / 4); // Текстурын нэг давталт = 4 м
    const top = new THREE.MeshStandardMaterial({ map: paving, roughness: 0.95 });
    const side = lowPolyMaterial(0x9a958b);
    this.builder.box({
      size: [PLAZA_SIZE, PLAZA_HEIGHT, PLAZA_SIZE],
      position: [0, PLAZA_HEIGHT / 2, 0],
      geometry: new THREE.BoxGeometry(PLAZA_SIZE, PLAZA_HEIGHT, PLAZA_SIZE),
      material: [side, side, top, side, side, side],
      castShadow: false,
    });
  }

  /** 2 м өндөр тавцан: өмнөөс шат, зүүнээс налуу, баруунаас үсрэх блокууд. */
  buildParkour() {
    const b = this.builder;
    const concrete = lowPolyMaterial(0x9aa3ad);
    const light = lowPolyMaterial(0xb7bdc5);
    const wood = lowPolyMaterial(0xc29a62);
    const height = 2.0;
    const cx = 10;
    const cz = -10;
    const half = 2.5;

    b.box({ size: [half * 2, height, half * 2], position: [cx, TOP + height / 2, cz], material: concrete });

    // Шат: 8 гишгүүр × 0.25 м (stepHeight = 0.4 тул автоматаар өгсөнө)
    const steps = 8;
    const rise = height / steps;
    const depth = 0.45;
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      b.box({
        size: [3, h, depth],
        position: [cx, TOP + h / 2, cz + half + (steps - i - 0.5) * depth],
        material: i % 2 ? concrete : light,
      });
    }

    // Налуу (16°): дээд ирмэг нь тавцангийн зүүн ирмэгтэй нийлнэ
    const angle = THREE.MathUtils.degToRad(16);
    const run = height / Math.tan(angle);
    const length = height / Math.sin(angle);
    const thickness = 0.3;
    const midX = cx + half + run / 2;
    const midY = TOP + height / 2;
    b.box({
      size: [length, thickness, 3],
      // Хавтангийн төв нь налуугийн гадаргуугаас нормалын дагуу thickness/2-оор доор
      position: [midX - Math.sin(angle) * (thickness / 2), midY - Math.cos(angle) * (thickness / 2), cz],
      rotation: [0, 0, -angle],
      material: wood,
    });

    // Үсрэлтийн блокууд: 0.5 м (амархан) ба 1.0 м (хамгийн их үсрэлт ≈ 1.25 м)
    b.box({ size: [2, 0.5, 2], position: [cx - 4.5, TOP + 0.25, cz + 1.5], material: light });
    b.box({ size: [2, 1.0, 2], position: [cx - 4.5, TOP + 0.5, cz - 1], material: concrete });
  }

  /** Модон хайрцагнууд — дээр нь үсэрч гарах. */
  buildCrates() {
    const crate = new THREE.MeshStandardMaterial({ map: createCrateTexture(this.renderer), roughness: 0.85 });
    const crates = [
      { x: -8, z: -5, level: 0, size: 1, rotY: 0.1 },
      { x: -9.7, z: -6.3, level: 0, size: 1, rotY: -0.05 },
      { x: -9.7, z: -6.3, level: 1, size: 1, rotY: 0.08 }, // 2 давхар (2 м) — шууд үсэрч хүрэхгүй
      { x: -11.4, z: -5.1, level: 0, size: 1, rotY: 0.3 },
      { x: -6.6, z: -3.6, level: 0, size: 0.6, rotY: 0.4 },
    ];
    for (const c of crates) {
      this.builder.box({
        size: [c.size, c.size, c.size],
        position: [c.x, TOP + c.size / 2 + c.level, c.z],
        rotation: [0, c.rotY, 0],
        material: crate,
      });
    }
  }

  /** Хээтэй хана ба баганууд — камер саад тойрох эсэхийг шалгана. */
  buildWallAndPillars() {
    const b = this.builder;
    const wallLength = 16;
    const wall = lowPolyMaterial(0xb7b1a6);
    b.box({ size: [0.6, 3, wallLength], position: [-17, TOP + 1.5, -6], material: wall });

    // Монгол хээтэй тууз (зөвхөн чимэглэл, collider хэрэггүй)
    const ornament = createOrnamentTexture(this.renderer);
    const bandHeight = 0.3;
    const tileLength = (ornament.image.width / ornament.image.height) * bandHeight;
    ornament.repeat.set(wallLength / tileLength, 1);
    const band = new THREE.MeshStandardMaterial({ map: ornament, roughness: 0.8 });
    const bandMesh = new THREE.Mesh(new THREE.BoxGeometry(0.64, bandHeight, wallLength), [band, band, wall, wall, wall, wall]);
    bandMesh.position.set(-17, TOP + 2.35, -6);
    b.add(bandMesh);

    const pillar = lowPolyMaterial(0xa9a29a);
    for (const [x, z] of [[-14, 12], [-10, 12], [-14, 16], [-10, 16]]) {
      b.cylinder({ radius: 0.45, height: 4, position: [x, TOP + 2, z], material: pillar, segments: 10 });
    }
  }

  /** Талбайн гадна хоёр гэр (Үе шат 9-д гэр хороолол болно). */
  buildGers() {
    for (const spot of GER_SPOTS) {
      const ger = createGer();
      ger.position.set(spot.x, 0, spot.z);
      ger.rotation.y = spot.rotY;
      this.builder.add(ger);
      this.builder.cylinderCollider({ x: spot.x, y: GER.height / 2, z: spot.z }, GER.height / 2, GER.radius + 0.1);
    }
  }

  /** Талбайг тойрсон гэрэлт шон (шөнийн гэрэлтүүлэг Үе шат 7-д). */
  buildLamps() {
    const inset = PLAZA_SIZE / 2 - 1.2;
    const placements = [];
    for (const offset of [-15, 0, 15]) {
      placements.push({ x: offset, z: -inset, rotY: 0 }); // Хойд тал → гэрэл төв рүү
      placements.push({ x: offset, z: inset, rotY: Math.PI }); // Өмнөд тал
      placements.push({ x: -inset, z: offset, rotY: Math.PI / 2 }); // Баруун тал
      placements.push({ x: inset, z: offset, rotY: -Math.PI / 2 }); // Зүүн тал
    }
    this.builder.add(createLampPosts(placements, TOP));
    for (const p of placements) {
      this.builder.cylinderCollider({ x: p.x, y: TOP + 2.3, z: p.z }, 2.3, 0.12, { group: GROUP.PROP });
    }
  }

  /** Талбайг тойрсон модод (InstancedMesh). Хойд тал (гол, зам) руу тарихгүй. */
  buildTrees(random) {
    const trees = [];
    for (let attempt = 0; trees.length < 45 && attempt < 3000; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = 36 + random() * 70;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (z < -55) continue; // Хойд талд нь голын эргийн зам бий
      if (GER_SPOTS.some((g) => Math.hypot(x - g.x, z - g.z) < 9)) continue;
      if (trees.some((tree) => Math.hypot(x - tree.x, z - tree.z) < 5)) continue;
      if (isNearDrivingArea(x, z)) continue; // Зам, жолоодлогын талбай дээр мод ургахгүй
      trees.push({ x, z, scale: 0.95 + random() * 0.55, rotY: random() * Math.PI * 2 });
    }
    for (const mesh of createTrees(trees, random)) this.builder.add(mesh);
    for (const tree of trees) {
      // Зөвхөн их бие нь collider. Камер модыг нэвт харна (GROUP.PROP)
      const halfHeight = 1.2 * tree.scale;
      this.builder.cylinderCollider({ x: tree.x, y: halfHeight, z: tree.z }, halfHeight, 0.22 * tree.scale, {
        group: GROUP.PROP,
      });
    }
  }
}

/** Цэг нь жолоодлогын талбай эсвэл зам руу (8 м зайтай) орох уу? */
function isNearDrivingArea(x, z) {
  const margin = 8;
  const area = DRIVING_AREA;
  const inArea = x > area.minX - margin && x < area.maxX + margin && z > area.minZ - margin && z < area.maxZ + margin;
  const road = ACCESS_ROAD;
  const onRoad =
    x > road.fromX - margin && x < road.toX + margin && Math.abs(z - road.centerZ) < road.width / 2 + margin;
  return inArea || onRoad;
}
