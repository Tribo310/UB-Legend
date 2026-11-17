// Газрын зураг: хотын статик зургийг нэг удаа canvas-д зурж (1 px = 1 м), түүнийгээ
//  • мини газрын зураг (доод зүүн буланд, камерын хамт эргэнэ, GPS маршрут) болон
//  • том газрын зураг (M) — томруулах, чирж хөдөлгөх, дарж зорих цэг тавих
// хоёуланд ашиглана. Хотын өгөгдөл өөрчлөгдөхөд зураг автоматаар шинэчлэгдэнэ.
import { DISTRICTS } from '../city/cityLayout.js';
import { CONFIG } from '../core/config.js';
import { damp } from '../core/utils.js';
import { t } from '../i18n/i18n.js';

const MAP_SIZE = 2048; // px — x, z ∈ [−1024, 1024] м
const OFFSET = MAP_SIZE / 2;
const COLORS = {
  background: '#1d2734',
  water: '#2c6489',
  block: '#2c3847',
  lawn: '#2f4936',
  square: '#3d4a5a',
  gerPlot: '#373226',
  building: '#4b5b6f',
  tall: '#5d708a',
  ger: '#d9d0b7',
  tree: '#4f7a45',
  road: '#8b97a7',
  dirt: '#76664f',
  avenue: '#d9a441',
  bridge: '#a3afbf',
  training: '#33424f',
  route: '#4fd1ff',
  waypoint: '#ff5d7a',
  vehicle: '#e9eef4',
};

/** Хотын статик зураг (нэг удаа зурна). */
function renderStaticMap(data) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_SIZE;
  const ctx = canvas.getContext('2d');
  const rect = (r, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(r.minX + OFFSET, r.minZ + OFFSET, r.maxX - r.minX, r.maxZ - r.minZ);
  };
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  ctx.globalAlpha = 0.07;
  for (const district of DISTRICTS) rect(district.rect, district.tint);
  ctx.globalAlpha = 1;
  if (data.water) rect(data.water, COLORS.water);
  if (data.training) rect(data.training, COLORS.training);

  for (const block of data.blocks) {
    let color = COLORS.block;
    if (!block.paved) color = COLORS.gerPlot;
    else if (block.kind === 'park' || block.kind === 'khoroolol' || block.kind === 'zaisan') color = COLORS.lawn;
    else if (block.kind === 'square') color = COLORS.square;
    rect(block.rect, color);
  }
  for (const b of data.buildings) {
    ctx.fillStyle = b.h > 40 ? COLORS.tall : COLORS.building;
    ctx.fillRect(b.x - b.w / 2 + OFFSET, b.z - b.d / 2 + OFFSET, b.w, b.d);
  }
  ctx.fillStyle = COLORS.tree;
  for (const tree of data.trees) ctx.fillRect(tree.x + OFFSET - 1.2, tree.z + OFFSET - 1.2, 2.4, 2.4);
  ctx.fillStyle = COLORS.ger;
  for (const ger of data.gers) {
    ctx.beginPath();
    ctx.arc(ger.x + OFFSET, ger.z + OFFSET, 3.3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const bridge of data.bridges) rect(bridge, COLORS.bridge);
  for (const road of data.roads) rect(road.rect, road.type === 'avenue' ? COLORS.avenue : road.type === 'dirt' ? COLORS.dirt : COLORS.road);
  for (const crossing of data.intersections) rect(crossing.rect, crossing.paved ? COLORS.road : COLORS.dirt);
  if (data.roundabout) {
    const { x, z, radius, island } = data.roundabout;
    ctx.strokeStyle = COLORS.avenue;
    ctx.lineWidth = radius - island;
    ctx.beginPath();
    ctx.arc(x + OFFSET, z + OFFSET, (radius + island) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

/** Тоглогчийн сум (хамар нь дээш чиглэсэн), өгөгдсөн цэг ба өнцгөөр. */
function drawArrow(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.72, size * 0.8);
  ctx.lineTo(0, size * 0.42);
  ctx.lineTo(-size * 0.72, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0d141f';
  ctx.lineWidth = size * 0.22;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPin(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = COLORS.waypoint;
  ctx.strokeStyle = '#0d141f';
  ctx.lineWidth = size * 0.2;
  ctx.beginPath();
  ctx.arc(0, -size, size * 0.75, Math.PI, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -size, size * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export class MapUI {
  /**
   * @param {object} mapData World.mapData
   * @param {import('../navigation/Navigator.js').Navigator} navigator
   * @param {{onWaypointChange?: (set: boolean) => void}} [callbacks]
   */
  constructor(mapData, navigator, callbacks = {}) {
    this.mapData = mapData;
    this.navigator = navigator;
    this.callbacks = callbacks;
    this.mapCanvas = renderStaticMap(mapData);

    this.minimap = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimap.getContext('2d');
    this.districtLabel = document.getElementById('minimap-district');
    this.zoom = CONFIG.map.footZoom;
    this.currentDistrict = '';

    this.screenCanvas = document.getElementById('map-canvas');
    this.screenCtx = this.screenCanvas.getContext('2d');
    this.view = { x: 0, z: 0, scale: 1 };
    this.lastState = null;
    this.bindMapScreen();
    this.resizeMinimap();
  }

  resizeMinimap() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = CONFIG.map.minimapSize;
    this.minimap.width = this.minimap.height = Math.round(size * dpr);
    this.minimap.style.width = this.minimap.style.height = `${size}px`;
    this.dpr = dpr;
  }

  /**
   * Кадр бүр (тоглож байх үед).
   * @param {{position:{x:number,z:number}, facing:number, cameraYaw:number, speed:number, driving:boolean, vehicles:{x:number,z:number,yaw:number}[], district:string}} state
   */
  updateMinimap(dt, state) {
    this.lastState = state;
    const { footZoom, driveZoom } = CONFIG.map;
    const target = state.driving ? footZoom - (footZoom - driveZoom) * Math.min(1, Math.abs(state.speed) / 25) : footZoom;
    this.zoom = damp(this.zoom, target, 2.5, dt);
    if (state.district !== this.currentDistrict) {
      this.currentDistrict = state.district;
      this.districtLabel.textContent = state.district;
    }

    const ctx = this.minimapCtx;
    const size = this.minimap.width;
    const r = size / 2;
    const zoom = this.zoom * this.dpr;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, size, size);
    // Камерын харж буй зүг дээш харагдахаар газрын зургийг эргүүлнэ
    ctx.translate(r, r);
    ctx.rotate(state.cameraYaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-(state.position.x + OFFSET), -(state.position.z + OFFSET));
    ctx.drawImage(this.mapCanvas, 0, 0);
    this.drawRoute(ctx, 5 / zoom);
    for (const vehicle of state.vehicles) {
      ctx.save();
      ctx.translate(vehicle.x + OFFSET, vehicle.z + OFFSET);
      ctx.rotate(-vehicle.yaw);
      ctx.fillStyle = COLORS.vehicle;
      ctx.fillRect(-0.9, -2.25, 1.8, 4.5);
      ctx.restore();
    }
    ctx.restore();

    // Зорих цэг: харагдах хүрээнээс гадуур бол хүрээний ирмэг дээр
    const waypoint = this.navigator.waypoint;
    if (waypoint) {
      const dx = waypoint.x - state.position.x;
      const dz = waypoint.z - state.position.z;
      const cos = Math.cos(state.cameraYaw);
      const sin = Math.sin(state.cameraYaw);
      let sx = (dx * cos - dz * sin) * zoom;
      let sy = (dx * sin + dz * cos) * zoom;
      const limit = r - 14 * this.dpr;
      const length = Math.hypot(sx, sy);
      if (length > limit) {
        sx = (sx / length) * limit;
        sy = (sy / length) * limit;
      }
      drawPin(ctx, r + sx, r + sy + 6 * this.dpr, 9 * this.dpr);
    }

    // Тоглогчийн сум (төвд) ба хойд зүгийн тэмдэг
    drawArrow(ctx, r, r, state.cameraYaw + Math.PI - state.facing, 8 * this.dpr);
    const northX = r + Math.sin(state.cameraYaw) * (r - 12 * this.dpr);
    const northY = r - Math.cos(state.cameraYaw) * (r - 12 * this.dpr);
    ctx.fillStyle = '#0d141f';
    ctx.beginPath();
    ctx.arc(northX, northY, 9 * this.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9a441';
    ctx.font = `800 ${11 * this.dpr}px "Montserrat Variable", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('map.north'), northX, northY + 0.5 * this.dpr);
  }

  drawRoute(ctx, lineWidth) {
    const route = this.navigator.route;
    if (!route || route.length < 2) return;
    ctx.strokeStyle = COLORS.route;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    route.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x + OFFSET, p.z + OFFSET) : ctx.lineTo(p.x + OFFSET, p.z + OFFSET)));
    ctx.stroke();
  }

  // ---------- Том газрын зураг (M) ----------

  /** Том газрын зургийг нээх үед: тоглогч төвд, хотыг бүтнээр нь харуулна. */
  openScreen() {
    const state = this.lastState;
    const dpr = this.dpr;
    this.screenCanvas.width = Math.round(window.innerWidth * dpr);
    this.screenCanvas.height = Math.round(window.innerHeight * dpr);
    this.view.scale = (Math.min(this.screenCanvas.width, this.screenCanvas.height) / 1700) * 1.1;
    this.view.x = state ? state.position.x * 0.5 : 0;
    this.view.z = state ? state.position.z * 0.5 : 0;
    this.drawScreen();
  }

  /** Дэлгэцийн цэг → дэлхийн координат. */
  screenToWorld(px, py) {
    const { width, height } = this.screenCanvas;
    return { x: (px - width / 2) / this.view.scale + this.view.x, z: (py - height / 2) / this.view.scale + this.view.z };
  }

  worldToScreen(x, z) {
    const { width, height } = this.screenCanvas;
    return { x: (x - this.view.x) * this.view.scale + width / 2, y: (z - this.view.z) * this.view.scale + height / 2 };
  }

  drawScreen() {
    const ctx = this.screenCtx;
    const { width, height } = this.screenCanvas;
    const { scale } = this.view;
    const dpr = this.dpr;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(this.view.x + OFFSET), -(this.view.z + OFFSET));
    ctx.imageSmoothingEnabled = scale < 1.5;
    ctx.drawImage(this.mapCanvas, 0, 0);
    this.drawRoute(ctx, (4 * dpr) / scale);
    ctx.restore();

    // Хорооллын нэр (дэлгэцийн координатаар — томруулахад үсэг томрохгүй)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${13 * dpr}px "Montserrat Variable", Arial, sans-serif`;
    const labels = DISTRICTS.map((d) => ({
      text: t(d.labelKey),
      x: (d.rect.minX + d.rect.maxX) / 2,
      z: d.id === 'riverside' ? 385 : (d.rect.minZ + d.rect.maxZ) / 2 - (d.id === 'center' ? 110 : 0),
    }));
    labels.push({ text: t('districts.square'), x: 0, z: -2 });
    const training = this.mapData.training;
    if (training) labels.push({ text: t('districts.training'), x: (training.minX + training.maxX) / 2, z: training.maxZ + 18 });
    for (const label of labels) {
      const p = this.worldToScreen(label.x, label.z);
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(13, 20, 31, 0.85)';
      ctx.strokeText(label.text.toUpperCase(), p.x, p.y);
      ctx.fillStyle = '#f2d48a';
      ctx.fillText(label.text.toUpperCase(), p.x, p.y);
    }

    const state = this.lastState;
    if (state) {
      for (const vehicle of state.vehicles) {
        const p = this.worldToScreen(vehicle.x, vehicle.z);
        ctx.fillStyle = COLORS.vehicle;
        ctx.fillRect(p.x - 3 * dpr, p.y - 3 * dpr, 6 * dpr, 6 * dpr);
      }
      const player = this.worldToScreen(state.position.x, state.position.z);
      drawArrow(ctx, player.x, player.y, Math.PI - state.facing, 10 * dpr);
    }
    const waypoint = this.navigator.waypoint;
    if (waypoint) {
      const p = this.worldToScreen(waypoint.x, waypoint.z);
      drawPin(ctx, p.x, p.y, 12 * dpr);
    }
  }

  bindMapScreen() {
    const canvas = this.screenCanvas;
    let drag = null;
    const toCanvas = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * this.dpr, y: (event.clientY - rect.top) * this.dpr };
    };
    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const p = toCanvas(event);
      drag = { startX: p.x, startY: p.y, viewX: this.view.x, viewZ: this.view.z, moved: false };
    });
    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      const p = toCanvas(event);
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (Math.hypot(dx, dy) > 4 * this.dpr) drag.moved = true;
      this.view.x = drag.viewX - dx / this.view.scale;
      this.view.z = drag.viewZ - dy / this.view.scale;
      this.drawScreen();
    });
    window.addEventListener('mouseup', (event) => {
      if (!drag) return;
      const wasClick = !drag.moved;
      drag = null;
      if (wasClick && event.target === canvas) {
        const p = toCanvas(event);
        const world = this.screenToWorld(p.x, p.y);
        this.callbacks.onWaypoint?.(world);
        this.drawScreen();
      }
    });
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.callbacks.onWaypoint?.(null);
      this.drawScreen();
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const p = toCanvas(event);
        const before = this.screenToWorld(p.x, p.y);
        const factor = Math.pow(1.15, -Math.sign(event.deltaY));
        const baseScale = Math.min(this.screenCanvas.width, this.screenCanvas.height) / 1700;
        this.view.scale = Math.min(baseScale * 12, Math.max(baseScale * 0.8, this.view.scale * factor));
        // Курсорын доорх цэг хөдлөхгүй байхаар
        const after = this.screenToWorld(p.x, p.y);
        this.view.x += before.x - after.x;
        this.view.z += before.z - after.z;
        this.drawScreen();
      },
      { passive: false },
    );
  }
}
