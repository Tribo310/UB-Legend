// Физикийн collider-уудыг утсан хүрээгээр харуулна (F4). Харагдах дүрс ба
// мөргөлдөөний хэлбэр таарч байгаа эсэхийг шалгахад хэрэгтэй.
import * as THREE from 'three';

export class PhysicsDebug {
  constructor(scene, physics) {
    this.physics = physics;
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 999;
    scene.add(this.lines);
  }

  /** @returns {boolean} шинэ төлөв (асаалттай эсэх) */
  toggle() {
    this.lines.visible = !this.lines.visible;
    if (this.lines.visible) this.update();
    return this.lines.visible;
  }

  update() {
    if (!this.lines.visible) return;
    const { vertices, colors } = this.physics.world.debugRender();
    const geometry = this.lines.geometry;
    const position = geometry.getAttribute('position');

    if (!position || position.array.length !== vertices.length) {
      // Хэмжээ өөрчлөгдсөн үед л шинэ GPU буфер үүсгэнэ
      geometry.dispose();
      const fresh = new THREE.BufferGeometry();
      fresh.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      fresh.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      this.lines.geometry = fresh;
      return;
    }

    position.array.set(vertices);
    position.needsUpdate = true;
    const color = geometry.getAttribute('color');
    color.array.set(colors);
    color.needsUpdate = true;
  }
}
