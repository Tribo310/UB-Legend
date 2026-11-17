// Rapier (WASM) физик хөдөлгүүрийг бүрхсэн жижиг давхарга.
// Бусад модуль Rapier-ийн дэлгэрэнгүйг мэдэхгүйгээр collider нэмж, цацраг (ray) шидэж чадна.
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';

/**
 * Мөргөлдөөний бүлгүүд (16 битийн маск).
 * Камер зөвхөн WORLD-той мөргөлдөнө — мод, шон зэрэг жижиг саад (PROP) камерыг
 * огцом ойртуулахгүй, харин дүр бүгдтэй нь мөргөлдөнө.
 */
export const GROUP = Object.freeze({
  WORLD: 0x0001, // Газар, барилга, хана — камер мөргөлдөнө
  PROP: 0x0002, // Мод, шон, үл харагдах хил — камер нэвт харна
  PLAYER: 0x0004,
  VEHICLE: 0x0008, // Машины их бие
  NPC: 0x0010, // Үе шат 4
  CAMERA: 0x0020, // Камерын цацрагийн query-д л хэрэглэнэ
  DEBRIS: 0x0040, // Хөдлөх жижиг биет (конус, хайрцаг) — машин мөргөж унагаана, дугуй дээгүүр нь гарахгүй
});

export const ALL_GROUPS = 0xffff;

/** Rapier-ийн InteractionGroups: дээд 16 бит = гишүүнчлэл, доод 16 бит = шүүлтүүр. */
export function collisionGroups(membership, filter = ALL_GROUPS) {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

export class Physics {
  /** WASM модулийг ачаалаад физик ертөнц үүсгэнэ. */
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.fixedStep;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  /** Физикийг нэг тогтмол алхмаар урагшлуулна. */
  step() {
    this.world.step();
  }

  /**
   * Хөдөлгөөнгүй хайрцаг collider.
   * @param {{x:number,y:number,z:number}} center Төв цэг
   * @param {{x:number,y:number,z:number}} half Хагас хэмжээ
   * @param {{rotation?: {x:number,y:number,z:number,w:number}|null, group?: number, friction?: number}} [options]
   */
  addStaticBox(center, half, { rotation = null, group = GROUP.WORLD, friction = 0.7 } = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(friction)
      .setCollisionGroups(collisionGroups(group));
    if (rotation) desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    return this.world.createCollider(desc);
  }

  /**
   * Хавтгай газар: дээд гадаргуу нь y = 0, хэмжээ нь ±halfSize метр.
   *
   * Анхааруулга (Rapier 0.21-ээр шалгасан):
   *  • Хэт том cuboid (±2000 м) — shape cast-ийн нарийвчлал алдагдаж, дүр газарт ~15 см "шингэдэг".
   *  • HalfSpace (хязгааргүй хавтгай) — KCC хөдөлгөөнгүй зогсоход дүрийг огцом дээш түлхдэг.
   * Иймээс тоглох талбайн хэмжээтэй (хэдэн зуун метр) cuboid хамгийн найдвартай.
   * (Үе шат 3/9-д дүүрэг бүр өөрийн газар/heightfield collider-тэй болно.)
   */
  addGround(halfSize, { group = GROUP.WORLD, friction = 0.8 } = {}) {
    return this.addStaticBox({ x: 0, y: -1, z: 0 }, { x: halfSize, y: 1, z: halfSize }, { group, friction });
  }

  /**
   * Хөдөлгөөнгүй гүдгэр (convex) хэлбэр — цэгүүдийг бүрхсэн хамгийн бага хэлбэр (жишээ нь трамплин).
   * @param {Float32Array} points [x0,y0,z0, x1,y1,z1, ...] — position-оос харьцангуй
   */
  addStaticConvexHull(points, position, { group = GROUP.WORLD, friction = 0.8 } = {}) {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (!desc) throw new Error('Convex hull үүсгэж чадсангүй');
    desc
      .setTranslation(position.x, position.y, position.z)
      .setFriction(friction)
      .setCollisionGroups(collisionGroups(group));
    return this.world.createCollider(desc);
  }

  /** Хөдөлгөөнгүй босоо цилиндр collider (багана, мод, гэр). */
  addStaticCylinder(center, halfHeight, radius, { group = GROUP.WORLD, friction = 0.7 } = {}) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(friction)
      .setCollisionGroups(collisionGroups(group));
    return this.world.createCollider(desc);
  }

  /**
   * Цацраг шидэж, хамгийн ойрын саад хүртэлх зайг буцаана (саад байхгүй бол null).
   * @param {{x:number,y:number,z:number}} origin
   * @param {{x:number,y:number,z:number}} direction Нэгж вектор
   * @param {number} maxDistance
   * @param {number} filterGroups collisionGroups(...)-ийн үр дүн
   */
  castRay(origin, direction, maxDistance, filterGroups) {
    const ray = this.ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = direction.x;
    ray.dir.y = direction.y;
    ray.dir.z = direction.z;
    const hit = this.world.castRay(ray, maxDistance, true, undefined, filterGroups);
    return hit ? hit.timeOfImpact : null;
  }
}
