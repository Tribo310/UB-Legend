// Хөдөлгөөнгүй (статик) объектыг харагдах mesh + физик collider хосоор үүсгэнэ.
// Хоёуланг нэг дор үүсгэдэг тул дүрс ба мөргөлдөөний хэмжээ үргэлж таарна.
//
// origin: бүх байрлал энэ цэгээс харьцангуй (локал) өгөгдөнө. Жишээ нь туршилтын талбайг
// хотын зах руу кодоо өөрчлөхгүйгээр шилжүүлэхэд ашиглана.
import * as THREE from 'three';
import { GROUP } from '../core/Physics.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const euler = new THREE.Euler();

/**
 * Статик объектын тохиргоо: сүүдэр, матрицыг нэг удаа тооцоолох.
 * matrixAutoUpdate = false нь кадр бүр матриц дахин бодохгүй тул CPU хэмнэнэ.
 */
export function makeStatic(object, castShadow = true, receiveShadow = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
    child.matrixAutoUpdate = false;
    child.updateMatrix();
  });
  return object;
}

export class StaticBuilder {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/Physics.js').Physics} physics
   * @param {{x:number, z:number}} [origin] Локал координатын эх цэг (дэлхийн координатаар)
   */
  constructor(scene, physics, origin = { x: 0, z: 0 }) {
    this.scene = scene;
    this.physics = physics;
    this.origin = new THREE.Vector3(origin.x, 0, origin.z);
  }

  /** Локал цэгийг дэлхийн координат руу хөрвүүлнэ. */
  toWorld(x, y, z) {
    return new THREE.Vector3(x + this.origin.x, y, z + this.origin.z);
  }

  /**
   * Хайрцаг хэлбэрийн объект.
   * @param {object} options
   * @param {number[]} options.size [өргөн (x), өндөр (y), гүн (z)] метрээр
   * @param {number[]} options.position Төв цэг [x, y, z] (локал)
   * @param {number[]} [options.rotation] Эйлерийн өнцөг [x, y, z] (радиан)
   * @param {THREE.Material|THREE.Material[]} options.material
   * @param {THREE.BufferGeometry} [options.geometry] Тусгай geometry (өгөхгүй бол нэгж кубыг масштаблана)
   * @param {number} [options.group] Мөргөлдөөний бүлэг (GROUP.WORLD г.м.)
   */
  box({ size, position, rotation, material, geometry, group = GROUP.WORLD, castShadow = true, receiveShadow = true }) {
    const [width, height, depth] = size;
    const mesh = new THREE.Mesh(geometry ?? UNIT_BOX, material);
    if (!geometry) mesh.scale.set(width, height, depth);
    mesh.position.fromArray(position).add(this.origin);
    if (rotation) mesh.quaternion.setFromEuler(euler.set(rotation[0], rotation[1], rotation[2]));
    this.addWorld(mesh, castShadow, receiveShadow);
    this.physics.addStaticBox(
      mesh.position,
      { x: width / 2, y: height / 2, z: depth / 2 },
      { rotation: rotation ? mesh.quaternion : null, group },
    );
    return mesh;
  }

  /** Босоо цилиндр (багана, шон). */
  cylinder({ radius, height, position, material, segments = 12, group = GROUP.WORLD, castShadow = true, receiveShadow = true }) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.fromArray(position).add(this.origin);
    this.addWorld(mesh, castShadow, receiveShadow);
    this.physics.addStaticCylinder(mesh.position, height / 2, radius, { group });
    return mesh;
  }

  /** Collider-гүй, зөвхөн харагдах статик объект нэмнэ (байрлал нь локал). */
  add(object, castShadow = true, receiveShadow = true) {
    object.position.add(this.origin);
    return this.addWorld(object, castShadow, receiveShadow);
  }

  /** Байрлал нь аль хэдийн дэлхийн координатаар өгөгдсөн объект нэмнэ. */
  addWorld(object, castShadow = true, receiveShadow = true) {
    makeStatic(object, castShadow, receiveShadow);
    this.scene.add(object);
    return object;
  }

  // ---------- Зөвхөн collider (локал координатаар) ----------

  boxCollider(center, half, options) {
    return this.physics.addStaticBox(this.toWorld(center.x, center.y, center.z), half, options);
  }

  cylinderCollider(center, halfHeight, radius, options) {
    return this.physics.addStaticCylinder(this.toWorld(center.x, center.y, center.z), halfHeight, radius, options);
  }

  convexHullCollider(points, position, options) {
    return this.physics.addStaticConvexHull(points, this.toWorld(position.x, position.y, position.z), options);
  }
}
