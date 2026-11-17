// Үе шат 2-ын жолоодлогын талбай (талбайн зүүн, +X талд): асфальт зам ба талбай,
// конусын слалом, үсрэлтийн трамплин, мөргөж нураах хайрцагнууд.
// Конус, хайрцаг нь жинтэй (dynamic) биет — машин, дүр түлхэж унагаана.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { lowPolyMaterial } from './materials.js';
import { placeSign } from './signs.js';
import { createAsphaltTexture, createCrateTexture } from './textures.js';

/** Асфальт талбайн хүрээ (м). TestZone мод тарихдаа энэ хэсгийг алгасна. */
export const DRIVING_AREA = Object.freeze({ minX: 40, maxX: 170, minZ: -30, maxZ: 40 });
/** Төв талбайгаас жолоодлогын талбай руу орох зам. */
export const ACCESS_ROAD = Object.freeze({ fromX: 21.9, toX: 40.5, centerZ: 5.5, width: 8 });

const ASPHALT_Y = 0.012; // Газраас бага зэрэг дээр (z-fighting-ээс сэргийлнэ)
const PAINT_Y = 0.02;
const ASPHALT_TILE = 6; // Асфальтын текстурын нэг давталт (м)
const RAMP = { startX: 145, length: 8, height: 1.3, width: 4.5 };

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

/** Хэвтээ хавтгай (y = 0 түвшинд), UV-г метрээр давтагдахаар тохируулна. */
function flatPlane(width, depth, tile) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  if (tile) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * depth) / tile);
  }
  return geometry;
}

export class DrivingArea {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/Physics.js').Physics} physics
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./StaticBuilder.js').StaticBuilder} builder
   */
  constructor(scene, physics, renderer, builder) {
    this.scene = scene;
    this.physics = physics;
    this.builder = builder;
    /** @type {{body: import('@dimforge/rapier3d-compat').RigidBody, mesh: THREE.InstancedMesh, index: number, start: {x:number,y:number,z:number}, dirty: boolean}[]} */
    this.dynamicProps = [];

    this.buildSurface(renderer);
    this.buildMarkings();
    this.buildRamp();
    this.buildCones();
    this.buildCrateStack(renderer);
    placeSign(builder, renderer, {
      x: 26,
      y: 0,
      z: 13.5,
      rotY: -Math.PI / 2, // Нүүр нь баруун зүг (төв талбай) рүү харна
      titleKey: 'world.drivingSignTitle',
      subtitleKey: 'world.drivingSignSubtitle',
    });
  }

  buildSurface(renderer) {
    const texture = createAsphaltTexture(renderer);
    // polygonOffset: асфальтыг газрын хавтгайгаас үргэлж "урд" зурна
    const asphalt = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const area = DRIVING_AREA;
    const pad = new THREE.Mesh(flatPlane(area.maxX - area.minX, area.maxZ - area.minZ, ASPHALT_TILE), asphalt);
    pad.position.set((area.minX + area.maxX) / 2, ASPHALT_Y, (area.minZ + area.maxZ) / 2);
    const road = new THREE.Mesh(flatPlane(ACCESS_ROAD.toX - ACCESS_ROAD.fromX, ACCESS_ROAD.width, ASPHALT_TILE), asphalt);
    road.position.set((ACCESS_ROAD.fromX + ACCESS_ROAD.toX) / 2, ASPHALT_Y, ACCESS_ROAD.centerZ);
    this.builder.add(pad, false, true);
    this.builder.add(road, false, true);
  }

  /** Замын цагаан тэмдэглэгээ: тасархай төв шугам, замын захын шугам, талбайн хүрээ. */
  buildMarkings() {
    const paint = lowPolyMaterial(0xf1f1ec, {
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const parts = [];
    const line = (cx, cz, width, depth) => {
      const geometry = flatPlane(width, depth);
      geometry.translate(cx, PAINT_Y, cz);
      parts.push(geometry);
    };
    // Төв шугам (3 м зураас, 3 м зай) — зам ба слаломын дагуу
    for (let x = ACCESS_ROAD.fromX + 2; x < RAMP.startX - 6; x += 6) line(x + 1.5, ACCESS_ROAD.centerZ, 3, 0.16);
    // Замын захын тасралтгүй шугам
    const roadLength = ACCESS_ROAD.toX - ACCESS_ROAD.fromX;
    const roadMid = (ACCESS_ROAD.fromX + ACCESS_ROAD.toX) / 2;
    line(roadMid, ACCESS_ROAD.centerZ - ACCESS_ROAD.width / 2 + 0.35, roadLength, 0.14);
    line(roadMid, ACCESS_ROAD.centerZ + ACCESS_ROAD.width / 2 - 0.35, roadLength, 0.14);
    // Талбайн хүрээ
    const a = DRIVING_AREA;
    const width = a.maxX - a.minX;
    const depth = a.maxZ - a.minZ;
    line((a.minX + a.maxX) / 2, a.minZ + 0.6, width - 1.2, 0.25);
    line((a.minX + a.maxX) / 2, a.maxZ - 0.6, width - 1.2, 0.25);
    line(a.minX + 0.6, (a.minZ + a.maxZ) / 2, 0.25, depth - 1.2);
    line(a.maxX - 0.6, (a.minZ + a.maxZ) / 2, 0.25, depth - 1.2);

    const mesh = new THREE.Mesh(mergeGeometries(parts), paint); // Бүх шугам = 1 draw call
    parts.forEach((geometry) => geometry.dispose());
    this.builder.add(mesh, false, true);
  }

  /** Үсрэлтийн трамплин (шаантаг хэлбэр) — collider нь convex hull. */
  buildRamp() {
    const { startX, length, height, width } = RAMP;
    const z = ACCESS_ROAD.centerZ;
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(length, height), new THREE.Vector2(length, 0)]);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geometry.translate(0, 0, -width / 2);
    const ramp = new THREE.Mesh(geometry, lowPolyMaterial(0xc9a24e));
    ramp.position.set(startX, 0, z);
    this.builder.add(ramp);

    const w = width / 2;
    const points = new Float32Array([0, 0, -w, length, height, -w, length, 0, -w, 0, 0, w, length, height, w, length, 0, w]);
    this.builder.convexHullCollider(points, { x: startX, y: 0, z }, { friction: 0.9 });
  }

  /** Слаломын конусууд — InstancedMesh (нэг geometry, 3 материал). */
  buildCones() {
    const spots = [];
    for (let x = 55; x <= 135; x += 10) spots.push([x, ACCESS_ROAD.centerZ]);
    spots.push([RAMP.startX - 2, ACCESS_ROAD.centerZ - 2.8], [RAMP.startX - 2, ACCESS_ROAD.centerZ + 2.8]);

    const cone = new THREE.ConeGeometry(0.18, 0.55, 12);
    const stripe = new THREE.CylinderGeometry(0.098, 0.118, 0.1, 12);
    const base = new THREE.BoxGeometry(0.38, 0.04, 0.38);
    base.translate(0, -0.255, 0);
    const geometry = mergeGeometries([cone, stripe, base], true);
    const orange = lowPolyMaterial(0xf06a1d, { roughness: 0.6 });
    const white = lowPolyMaterial(0xf4f4f4, { roughness: 0.5 });
    const mesh = new THREE.InstancedMesh(geometry, [orange, white, orange], spots.length);
    mesh.name = 'Cones';

    spots.forEach(([x, z], index) => {
      const body = this.createDynamicBody({ x, y: 0.285, z }, 0.2, 0.3);
      const world = this.physics.world;
      const groups = collisionGroups(GROUP.DEBRIS);
      world.createCollider(RAPIER.ColliderDesc.cone(0.275, 0.18).setDensity(150).setFriction(0.8).setRestitution(0.2).setCollisionGroups(groups), body);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.19, 0.02, 0.19).setTranslation(0, -0.255, 0).setDensity(300).setFriction(0.8).setCollisionGroups(groups),
        body,
      );
      this.registerProp(body, mesh, index);
    });
    this.addDynamicMesh(mesh);
  }

  /** Мөргөж нураах хайрцгийн овоо (4-3-2-1 пирамид). */
  buildCrateStack(renderer) {
    const material = new THREE.MeshStandardMaterial({ map: createCrateTexture(renderer), roughness: 0.85 });
    const spots = [];
    const baseX = 126;
    const z = 26;
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4 - row; i++) spots.push({ x: baseX + row * 0.51 + i * 1.02, y: 0.5 + row * 1.001, z });
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, spots.length);
    mesh.name = 'CrateStack';
    spots.forEach((spot, index) => {
      const body = this.createDynamicBody(spot, 0.05, 0.1);
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(35).setFriction(0.7).setCollisionGroups(collisionGroups(GROUP.DEBRIS)),
        body,
      );
      this.registerProp(body, mesh, index);
    });
    this.addDynamicMesh(mesh);
  }

  /** Жинтэй биет (локал байрлалыг дэлхийн координат руу хөрвүүлнэ). */
  createDynamicBody(spot, linearDamping, angularDamping) {
    const p = this.builder.toWorld(spot.x, spot.y, spot.z);
    return this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setLinearDamping(linearDamping)
        .setAngularDamping(angularDamping),
    );
  }

  registerProp(body, mesh, index) {
    const t = body.translation();
    this.dynamicProps.push({ body, mesh, index, start: { x: t.x, y: t.y, z: t.z }, dirty: true });
  }

  addDynamicMesh(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // Биетүүд хөдөлдөг тул хүрээг дахин тооцоолохгүйн тулд
    this.scene.add(mesh);
  }

  /** Кадр бүр: хөдөлж буй (унтаагүй) биетүүдийн байрлалыг дүрсэнд хуулна. */
  update() {
    for (const prop of this.dynamicProps) {
      if (!prop.dirty && prop.body.isSleeping()) continue;
      const t = prop.body.translation();
      const r = prop.body.rotation();
      matrix.compose(position.set(t.x, t.y, t.z), quaternion.set(r.x, r.y, r.z, r.w), ONE);
      prop.mesh.setMatrixAt(prop.index, matrix);
      prop.mesh.instanceMatrix.needsUpdate = true;
      prop.dirty = false;
    }
  }

  /** Конус, хайрцгийг анхны байрлалд нь буцаана. */
  resetProps() {
    for (const prop of this.dynamicProps) {
      prop.body.setTranslation(prop.start, true);
      prop.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      prop.dirty = true;
    }
  }
}
