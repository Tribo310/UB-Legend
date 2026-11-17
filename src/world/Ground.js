// Хавтгай газар (тал хээр). Голын хэсгийг хасаж (тэнд ус, далан харагдана) хоёр хавтгайгаар зурна.
import * as THREE from 'three';
import { RIVER } from '../city/cityLayout.js';
import { CONFIG } from '../core/config.js';
import { createSteppeTexture } from './textures.js';

const TEXTURE_TILE_METERS = 14;
const COLLIDER_TILE = 320; // Collider-ийн хавтангийн хэмжээ (м)

/** Хэвтээ тэгш өнцөгт, UV нь дэлхийн координатаар давтагдана. */
function groundRect(minX, maxX, minZ, maxZ) {
  const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const uv = geometry.attributes.uv;
  const position = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, position.getX(i) / TEXTURE_TILE_METERS, -position.getZ(i) / TEXTURE_TILE_METERS);
  }
  return geometry;
}

export function createGround(scene, physics, renderer) {
  const half = CONFIG.world.size / 2;
  const material = new THREE.MeshStandardMaterial({ map: createSteppeTexture(renderer), roughness: 1 });
  for (const [minZ, maxZ] of [
    [-half, RIVER.north],
    [RIVER.south, half],
  ]) {
    const mesh = new THREE.Mesh(groundRect(-half, half, minZ, maxZ), material);
    mesh.name = 'Ground';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
  }

  // Collider: тоглох талбайг хамарсан хавтангууд (дээд гадаргуу y = 0).
  // Нэг том cuboid биш — хэт том хэлбэр дээр Rapier-ийн shape cast-ийн нарийвчлал алдагддаг.
  const extent = CONFIG.world.boundary + 60;
  const count = Math.ceil((extent * 2) / COLLIDER_TILE);
  const start = -(count * COLLIDER_TILE) / 2;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      physics.addStaticBox(
        { x: start + (i + 0.5) * COLLIDER_TILE, y: -1, z: start + (j + 0.5) * COLLIDER_TILE },
        { x: COLLIDER_TILE / 2, y: 1, z: COLLIDER_TILE / 2 },
      );
    }
  }
}
