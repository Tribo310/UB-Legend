// Жижиг туслах математик функцууд.

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export const lerp = (a, b, t) => a + (b - a) * t;

export const degToRad = (degrees) => (degrees * Math.PI) / 180;

/**
 * Кадрын хурдаас (FPS) үл хамаарах зөөлөн ойртолт (exponential damping).
 * sharpness их байх тусам target руу хурдан хүрнэ.
 */
export function damp(current, target, sharpness, dt) {
  return lerp(current, target, 1 - Math.exp(-sharpness * dt));
}

/** Өнцгийг хамгийн богино замаар (±π) зөөлөн эргүүлнэ. */
export function dampAngle(current, target, sharpness, dt) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-sharpness * dt));
}

/**
 * Тогтмол үртэй (seed) санамсаргүй тоо үүсгэгч (mulberry32).
 * Ижил seed өгвөл газар, текстур бүр ачаалах болгонд яг ижил гарна.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
