// Барилгын фасадын материал: цонхнуудыг текстургүйгээр, shader дотор процедураар зурна.
//
// Барилга бүр нэг InstancedMesh-ийн instance (нэгж куб × масштаб). Цонхны тор нь дэлхийн
// координатаар (давхар ≈ 3 м, цонхны алхам ≈ 3.5 м) тооцогдох тул ямар ч хэмжээтэй барилга дээр
// цонх сунахгүй, жигд гарна. Instance бүр өөрийн фасадын хэв маягтай (aFacade, aGlass):
//   aFacade = (цонхны алхам м, давхрын өндөр м, цонхны өргөний хувь, цонхны өндрийн хувь)
//   aGlass  = шилний өнгө (шугаман RGB)
// Үе шат 7-д шөнө цонхнууд санамсаргүй асна (uNight).
import * as THREE from 'three';

const FACADE_VERTEX_PARS = /* glsl */ `
attribute vec4 aFacade;
attribute vec3 aGlass;
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
varying vec4 vFacade;
varying vec3 vGlass;
`;

const FACADE_VERTEX_MAIN = /* glsl */ `
vec4 facadeWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vFacadePos = facadeWorld.xyz;
vFacadeNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
vFacade = aFacade;
vGlass = aGlass;
`;

const FACADE_FRAGMENT_PARS = /* glsl */ `
uniform float uNight;
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
varying vec4 vFacade;
varying vec3 vGlass;
float facadeHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

const FACADE_FRAGMENT_COLOR = /* glsl */ `
float facadeWindow = 0.0;
float facadeLit = 0.0;
vec3 facadeNormal = normalize(vFacadeNormal);
if (abs(facadeNormal.y) > 0.5) {
  diffuseColor.rgb *= 0.72; // Дээвэр — бараан, цонхгүй
} else if (vFacade.x > 0.0) {
  vec2 tangent = vec2(facadeNormal.z, -facadeNormal.x);
  float along = dot(vFacadePos.xz, tangent) / vFacade.x;
  float level = (vFacadePos.y - 0.15) / vFacade.y;
  vec2 cell = vec2(floor(along), floor(level));
  vec2 f = fract(vec2(along, level));
  float marginX = (1.0 - vFacade.z) * 0.5;
  float marginY = (1.0 - vFacade.w) * 0.5;
  facadeWindow = step(marginX, f.x) * step(f.x, 1.0 - marginX) * step(marginY, f.y) * step(f.y, 1.0 - marginY);
  float seed = facadeHash(cell + floor(vFacadePos.xz * 0.05) * 17.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vGlass * (0.8 + seed * 0.45), facadeWindow);
  facadeLit = facadeWindow * step(0.55, seed) * uNight;
}
`;

/**
 * @param {{ shadows?: boolean }} [options]
 * @returns {THREE.MeshStandardMaterial}
 */
export function createBuildingMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
  const uniforms = { uNight: { value: 0 } };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${FACADE_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_FRAGMENT_COLOR}`)
      // Шил гөлгөр (бага roughness), шөнө асаалттай цонх гэрэлтэнэ
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, facadeWindow);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.82, 0.5) * facadeLit * 1.4;');
  };
  material.customProgramCacheKey = () => 'ub-building-facade';
  return material;
}

/** Холын LOD-д: цонхгүй, сүүдэргүй хямд материал (instance өнгө хэвээр). */
export function createDistantBuildingMaterial() {
  return new THREE.MeshLambertMaterial({ color: 0xffffff });
}
