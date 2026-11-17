// Low-poly материалын сан. Нэг өнгөнд нэг л материал үүсгэж дахин ашиглана —
// ингэснээр GPU-д shader/material солих (state change) цөөрч, гүйцэтгэл сайжирна.
import * as THREE from 'three';

const cache = new Map();

/**
 * Хавтгай сүүдэртэй (flat shading) стильжүүлсэн материал.
 * @param {number} color hex өнгө
 * @param {Partial<THREE.MeshStandardMaterialParameters>} [overrides]
 */
export function lowPolyMaterial(color, overrides = {}) {
  const key = `${color}|${JSON.stringify(overrides)}`;
  let material = cache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
      ...overrides,
    });
    cache.set(key, material);
  }
  return material;
}
