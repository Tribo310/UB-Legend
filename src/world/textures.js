// Процедурын (кодоор зурсан) текстурууд. Гаднаас зураг татахгүй тул ачаалал хурдан,
// лицензийн асуудалгүй. Дараа нь жинхэнэ зургаар солиход зөвхөн энэ файлыг өөрчилнө.
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

/**
 * Монгол "алхан хээ" маягийн давтагдах хээ (30×16 нэгжийн нэг хэсэг).
 * UI-ийн хүрээ (CSS) болон 3D ертөнцийн самбар/хананд ижил хээ ашиглана.
 */
export const MEANDER_PATH = 'M0 1H30M0 15H30M2.5 15V4H12.5V12H7.5V8M27.5 1V12H17.5V4H22.5V8';
const MEANDER_TILE = { width: 30, height: 16 };

function createCanvas(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')];
}

function toTexture(canvas, renderer) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Налуу өнцгөөс харахад газар бүдгэрэхгүй байх (anisotropic filtering)
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

/** Ирмэгээр давтагдах (tileable) байхаар дүрсийг 3×3 байрлалд зурна. */
function drawWrapped(size, x, y, radius, draw) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const dx = x + ox;
      const dy = y + oy;
      if (dx + radius < 0 || dx - radius > size || dy + radius < 0 || dy - radius > size) continue;
      draw(dx, dy);
    }
  }
}

/** Хээг өгөгдсөн тэгш өнцөгт дотор хэвтээ чиглэлд давтан зурна. */
export function drawMeander(ctx, x, y, width, height, color) {
  const scale = height / MEANDER_TILE.height;
  const tileWidth = MEANDER_TILE.width * scale;
  const path = new Path2D(MEANDER_PATH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineCap = 'square';
  for (let tx = x; tx < x + width; tx += tileWidth) {
    ctx.save();
    ctx.translate(tx, y);
    ctx.scale(scale, scale);
    ctx.lineWidth = 1.6;
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.restore();
}

/** Зуны тал хээрийн өвс. Нэг давталт ≈ 14 м. */
export function createSteppeTexture(renderer) {
  const size = 512;
  const [canvas, ctx] = createCanvas(size);
  const random = mulberry32(1337);

  ctx.fillStyle = '#8c9f58';
  ctx.fillRect(0, 0, size, size);

  // Том, бүдэг толбо — өнгөний жигд бус байдал
  for (let i = 0; i < 46; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 30 + random() * 90;
    const color = random() < 0.5 ? 'rgba(168, 168, 98, 0.22)' : 'rgba(104, 134, 66, 0.22)';
    drawWrapped(size, x, y, radius, (dx, dy) => {
      const gradient = ctx.createRadialGradient(dx, dy, 0, dx, dy, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(dx - radius, dy - radius, radius * 2, radius * 2);
    });
  }

  // Жижиг өвсний ширхэгүүд
  const blades = ['#7d9150', '#9db068', '#6c8445', '#b3b072', '#889b55', '#a7a565'];
  for (let i = 0; i < 9000; i++) {
    ctx.globalAlpha = 0.3 + random() * 0.45;
    ctx.fillStyle = blades[Math.floor(random() * blades.length)];
    ctx.fillRect(random() * size, random() * size, 1 + random() * 1.5, 2 + random() * 3);
  }
  ctx.globalAlpha = 1;
  return toTexture(canvas, renderer);
}

/** Бетон хавтан (4×4 хавтан, нэг нь 1 м) — талбайн хучилт. */
export function createPavingTexture(renderer) {
  const size = 512;
  const tiles = 4;
  const tile = size / tiles;
  const [canvas, ctx] = createCanvas(size);
  const random = mulberry32(42);

  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const shade = 172 + Math.floor((random() - 0.5) * 18);
      ctx.fillStyle = `rgb(${shade + 6}, ${shade + 2}, ${shade - 6})`;
      ctx.fillRect(tx * tile, ty * tile, tile, tile);
    }
  }
  // Цэгэн бүтэц (бетоны ширхэг)
  for (let i = 0; i < 7000; i++) {
    ctx.fillStyle = random() < 0.5 ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }
  // Хавтан хоорондын зураас (ирмэг дээр хагасаар нь зурж давталтыг жигд болгоно)
  ctx.strokeStyle = 'rgba(78, 72, 64, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= tiles; i++) {
    ctx.moveTo(i * tile, 0);
    ctx.lineTo(i * tile, size);
    ctx.moveTo(0, i * tile);
    ctx.lineTo(size, i * tile);
  }
  ctx.stroke();
  return toTexture(canvas, renderer);
}

/** Модон хайрцаг (ящик). */
export function createCrateTexture(renderer) {
  const size = 256;
  const [canvas, ctx] = createCanvas(size);
  const random = mulberry32(7);
  const planks = 5;
  const plank = size / planks;

  for (let i = 0; i < planks; i++) {
    const shade = (random() - 0.5) * 22;
    ctx.fillStyle = `rgb(${170 + shade}, ${118 + shade}, ${64 + shade * 0.6})`;
    ctx.fillRect(0, i * plank, size, plank);
    // Модны судал
    ctx.strokeStyle = 'rgba(80, 48, 20, 0.25)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 4; g++) {
      const y = i * plank + 6 + random() * (plank - 12);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + 3, size * 0.6, y - 3, size, y + 1);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60, 36, 16, 0.5)';
    ctx.fillRect(0, i * plank, size, 2);
  }
  // Хүрээ ба хөндлөн мод
  ctx.strokeStyle = '#5e3b1c';
  ctx.lineWidth = 24;
  ctx.strokeRect(12, 12, size - 24, size - 24);
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(24, size - 24);
  ctx.lineTo(size - 24, 24);
  ctx.stroke();
  // Хадаас
  ctx.fillStyle = '#2a1a0c';
  for (const [x, y] of [[12, 12], [size - 12, 12], [12, size - 12], [size - 12, size - 12]]) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas, renderer);
}

/** Асфальт. Нэг давталт ≈ 6 м. */
export function createAsphaltTexture(renderer) {
  const size = 512;
  const [canvas, ctx] = createCanvas(size);
  const random = mulberry32(99);
  ctx.fillStyle = '#45494d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 22; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 25 + random() * 70;
    const color = random() < 0.5 ? 'rgba(30, 32, 35, 0.18)' : 'rgba(95, 98, 100, 0.14)';
    drawWrapped(size, x, y, radius, (dx, dy) => {
      const gradient = ctx.createRadialGradient(dx, dy, 0, dx, dy, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(dx - radius, dy - radius, radius * 2, radius * 2);
    });
  }
  // Хайрга, ширхэг
  for (let i = 0; i < 14000; i++) {
    const shade = random() < 0.5 ? 20 + random() * 30 : 110 + random() * 60;
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade + 4}, ${0.25 + random() * 0.35})`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 1.6, 1 + random() * 1.6);
  }
  return toTexture(canvas, renderer);
}

/**
 * Монгол улсын дугаарын маягийн хавтан (зохиомол дугаар): зүүн талд хөх зурвас "MNG".
 * @param {string} text Жишээ нь "0028 БАТ"
 */
export function createPlateTexture(text) {
  const [canvas, ctx] = createCanvas(256, 64);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#1f4f9c';
  ctx.fillRect(4, 4, 34, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "Montserrat Variable", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MNG', 21, 44);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);
  ctx.fillStyle = '#111111';
  ctx.font = '800 38px "Montserrat Variable", Arial, sans-serif';
  ctx.fillText(text, 147, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Хөх дэвсгэр дээрх алтан хээтэй тууз (ханын чимэглэл). Өргөн нь хээний 2 давталт. */
export function createOrnamentTexture(renderer) {
  const height = 64;
  const width = (MEANDER_TILE.width / MEANDER_TILE.height) * height * 2;
  const [canvas, ctx] = createCanvas(width, height);
  ctx.fillStyle = '#1d3b63';
  ctx.fillRect(0, 0, width, height);
  drawMeander(ctx, 0, 0, width, height, '#d9a441');
  return toTexture(canvas, renderer);
}
