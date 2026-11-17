// NPC машины дүрслэл: тоглогчийн машины загвараас (VehicleModel) нэг удаа geometry гаргаж аваад,
// бүх NPC машиныг төрөл бүрээр 2 InstancedMesh-ээр зурна:
//   • "paint" — их биеийн өнгөт хэсэг (instance бүр өөр өнгөтэй)
//   • "details" — шил, дугуй, гэрэл, бампер (өнгө нь тогтмол)
// 40 машин × 30 хэсэг = 1200 draw call байхын оронд нийт 8 draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { VehicleModel } from '../vehicles/VehicleModel.js';
import { VEHICLE_TYPES } from '../vehicles/vehicleTypes.js';

const paintMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
const detailMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
const WHITE = new THREE.Color(1, 1, 1);

/** Geometry-г зөвхөн position + normal + color атрибуттай болгоно (нэгтгэхэд бүгд ижил байх ёстой). */
function bake(mesh, colorValue) {
  let geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = colorValue.r;
    colors[i * 3 + 1] = colorValue.g;
    colors[i * 3 + 2] = colorValue.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * @param {THREE.Scene} scene
 * @param {string} typeId
 * @param {number} capacity Хамгийн ихдээ хэдэн машин
 */
export function createCarVisual(scene, typeId, capacity) {
  const def = VEHICLE_TYPES[typeId];
  const model = new VehicleModel(def, Vehicle.connectionHeight(def));
  for (const wheel of model.wheels) wheel.position.y = def.wheels.radius; // Тайван зогсож буй байрлал
  model.root.updateMatrixWorld(true);

  const paint = [];
  const details = [];
  model.root.traverse((object) => {
    if (!object.isMesh || object.userData.interior) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (material === model.paintMaterial) {
      paint.push(bake(object, WHITE));
    } else {
      // Гэрэл (emissive) тод харагдахын тулд гэрэлтэлтийн өнгийг нь авна
      const glowing = material.emissive && material.emissiveIntensity > 0.3;
      details.push(bake(object, glowing ? material.emissive : material.color));
    }
  });
  model.root.traverse((object) => object.isMesh && object.geometry.dispose());
  model.dispose();

  const make = (parts, material, name) => {
    const geometry = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // Машинууд хөдөлдөг — хүрээг дахин тооцоолохгүй
    scene.add(mesh);
    return mesh;
  };
  return {
    typeId,
    def,
    capacity,
    paint: make(paint, paintMaterial, `Npc-${typeId}-paint`),
    details: make(details, detailMaterial, `Npc-${typeId}-details`),
    halfLength: def.size.length / 2,
    halfWidth: def.size.width / 2,
  };
}
