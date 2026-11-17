// Хэрэглэгчийн интерфэйс (DOM): эхлэлийн дэлгэц, түр зогсоох цэс, HUD, мэдэгдэл (toast),
// машины хурд хэмжигч ба үзүүлэлтийн карт.
// Бүх текст i18n-ээс ирнэ — хэл солиход renderTexts() дахин зурна.
import { getLanguage, getLanguageName, LANGUAGES, onLanguageChange, t } from '../i18n/i18n.js';
import { MapUI } from './MapUI.js';

/** Удирдлагын жагсаалт. "@" тэмдэгтэй түлхүүрийг орчуулна (жишээ нь "Хулгана"). */
const FOOT_CONTROLS = [
  { keys: ['W', 'A', 'S', 'D'], label: 'controls.move' },
  { keys: ['Shift'], label: 'controls.run' },
  { keys: ['Space'], label: 'controls.jump' },
  { keys: ['F'], label: 'controls.vehicle' },
  { keys: ['M'], label: 'controls.map' },
  { keys: ['@keys.mouse'], label: 'controls.look' },
  { keys: ['@keys.wheel'], label: 'controls.zoom' },
  { keys: ['Esc'], label: 'controls.pause' },
];

const DRIVE_CONTROLS = [
  { keys: ['W'], label: 'controls.accelerate' },
  { keys: ['S'], label: 'controls.brakeReverse' },
  { keys: ['A', 'D'], label: 'controls.steer' },
  { keys: ['Space'], label: 'controls.handbrake' },
  { keys: ['F'], label: 'controls.exitVehicle' },
];

const DEBUG_CONTROLS = [
  { keys: ['F3'], label: 'controls.debug' },
  { keys: ['F4'], label: 'controls.physics' },
];

const UPCOMING_CONTROLS = [
  { keys: ['E'], label: 'controls.interact' },
  { keys: ['Tab'], label: 'controls.phone' },
];

const HUD_HINT_FOOT = [
  { keys: ['W', 'A', 'S', 'D'], label: 'controls.move' },
  { keys: ['Shift'], label: 'controls.run' },
  { keys: ['Space'], label: 'controls.jump' },
  { keys: ['M'], label: 'controls.map' },
  { keys: ['Esc'], label: 'controls.menu' },
];

const HUD_HINT_DRIVE = [
  { keys: ['W', 'S'], label: 'controls.accelerate' },
  { keys: ['A', 'D'], label: 'controls.steer' },
  { keys: ['Space'], label: 'controls.handbrake' },
  { keys: ['F'], label: 'controls.exitVehicle' },
  { keys: ['M'], label: 'controls.map' },
];

const STAT_KEYS = ['speed', 'handling', 'durability'];
const TOAST_SECONDS = 2.4;
const VEHICLE_CARD_SECONDS = 4;

export class UI {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      start: $('screen-start'),
      pause: $('screen-pause'),
      map: $('screen-map'),
      hud: $('hud'),
      play: $('btn-play'),
      playLabel: $('btn-play-label'),
      startError: $('start-error'),
      resume: $('btn-resume'),
      respawn: $('btn-respawn'),
      resetVehicles: $('btn-reset-vehicles'),
      startControls: $('start-controls'),
      pauseControls: $('pause-controls'),
      hudHint: $('hud-hint'),
      lookHint: $('hud-look-hint'),
      prompt: $('hud-prompt'),
      debug: $('hud-debug'),
      toast: $('toast'),
      speedo: $('hud-speedo'),
      speedoValue: $('speedo-value'),
      speedoGear: $('speedo-gear'),
      speedoName: $('speedo-name'),
      speedoFill: $('speedo-fill'),
      vehicleCard: $('hud-vehicle-card'),
      vehicleCardName: $('vehicle-card-name'),
      vehicleCardDescription: $('vehicle-card-description'),
      vehicleCardStats: $('vehicle-card-stats'),
      sensitivity: $('set-sensitivity'),
      sensitivityValue: $('set-sensitivity-value'),
      invertY: $('set-invert'),
      showDebug: $('set-debug'),
    };
    this.state = 'loading';
    this.toastTimer = 0;
    this.vehicleCardTimer = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.debugVisible = Boolean(game.settings.get('showDebug'));
    /** @type {import('../vehicles/Vehicle.js').Vehicle|null} */
    this.vehicle = null;
    this.shownSpeed = -1;
    this.shownGear = '';

    this.bindEvents();
    this.renderTexts();
    onLanguageChange(() => this.renderTexts());
  }

  bindEvents() {
    const { el, game } = this;
    el.play.addEventListener('click', () => game.start());
    el.resume.addEventListener('click', () => game.resume());
    el.respawn.addEventListener('click', () => game.respawn());
    el.resetVehicles.addEventListener('click', () => game.resetVehicles());

    el.sensitivity.addEventListener('input', () => {
      const value = Number(el.sensitivity.value);
      game.settings.set('mouseSensitivity', value);
      el.sensitivityValue.textContent = value.toFixed(1);
    });
    el.invertY.addEventListener('change', () => game.settings.set('invertY', el.invertY.checked));
    el.showDebug.addEventListener('change', () => this.setDebugVisible(el.showDebug.checked));

    // Хэл сонгох товчлуурууд дахин зурагддаг тул эцэг элемент дээр нь сонсоно
    document.querySelectorAll('[data-lang-switch]').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-lang]');
        if (button) game.setLanguage(button.dataset.lang);
      });
    });
  }

  /** Хэлнээс хамаарах бүх динамик текстийг дахин зурна. */
  renderTexts() {
    document.title = `UB: ${t('game.title')}`;
    renderControlList(this.el.startControls, false);
    renderControlList(this.el.pauseControls, true);
    this.renderHint();
    document.querySelectorAll('[data-lang-switch]').forEach((group) => {
      group.replaceChildren(
        ...LANGUAGES.map((code) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.lang = code;
          button.lang = code;
          button.textContent = getLanguageName(code);
          button.setAttribute('aria-pressed', String(code === getLanguage()));
          return button;
        }),
      );
    });
    if (this.vehicle) {
      this.el.speedoName.textContent = t(this.vehicle.def.nameKey);
      this.fillVehicleCard(this.vehicle);
    }
    this.updatePlayButton();
    this.renderDebug();
  }

  /** Доод талын товч сануулга (явган / машин горимоор). */
  renderHint() {
    const items = this.vehicle ? HUD_HINT_DRIVE : HUD_HINT_FOOT;
    this.el.hudHint.replaceChildren(
      ...items.map((item) => {
        const span = document.createElement('span');
        span.className = 'hud-hint-item';
        span.append(...item.keys.map(createKey), document.createTextNode(t(item.label)));
        return span;
      }),
    );
  }

  updatePlayButton() {
    const ready = this.state === 'menu';
    this.el.play.disabled = !ready;
    this.el.playLabel.textContent = ready ? t('start.play') : t('start.loading');
  }

  /**
   * Газрын зураг (мини + том) — ертөнц үүссэний дараа Game дуудна.
   * @param {object} mapData World.mapData
   * @param {import('../navigation/Navigator.js').Navigator} navigator
   * @param {(point: {x:number, z:number}|null) => void} onWaypoint
   */
  initMap(mapData, navigator, onWaypoint) {
    this.map = new MapUI(mapData, navigator, { onWaypoint });
  }

  onStateChange(state) {
    this.state = state;
    const { el } = this;
    el.start.hidden = !(state === 'loading' || state === 'menu');
    el.pause.hidden = state !== 'paused';
    el.map.hidden = state !== 'map';
    el.hud.hidden = !(state === 'playing' || state === 'paused');
    if (state === 'map') this.map?.openScreen();
    this.updatePlayButton();
    if (state === 'menu') el.play.focus({ preventScroll: true });
    if (state === 'paused') {
      this.syncSettings();
      el.resume.focus({ preventScroll: true });
    }
    this.renderDebug();
  }

  syncSettings() {
    const { el } = this;
    const settings = this.game.settings;
    const sensitivity = Number(settings.get('mouseSensitivity'));
    el.sensitivity.value = String(sensitivity);
    el.sensitivityValue.textContent = sensitivity.toFixed(1);
    el.invertY.checked = Boolean(settings.get('invertY'));
    el.showDebug.checked = this.debugVisible;
  }

  showError(message) {
    this.el.startError.textContent = message;
    this.el.startError.hidden = false;
    this.el.play.hidden = true;
  }

  /** "Камер удирдахын тулд дарна уу" сануулга (pointer lock байхгүй үед). */
  setLookHint(visible) {
    this.el.lookHint.hidden = !visible;
  }

  /** "F — Машинд суух" сануулга. */
  setEnterPrompt(visible) {
    if (this.el.prompt.hidden === !visible) return;
    this.el.prompt.hidden = !visible;
  }

  toast(message) {
    this.el.toast.textContent = message;
    this.el.toast.classList.add('is-visible');
    this.toastTimer = TOAST_SECONDS;
  }

  // ---------- Машин ----------

  /**
   * Жолоодох горимд шилжих (vehicle) эсвэл явган буцах (null).
   * @param {import('../vehicles/Vehicle.js').Vehicle|null} vehicle
   */
  setDriving(vehicle) {
    this.vehicle = vehicle;
    this.el.speedo.hidden = !vehicle;
    this.shownSpeed = -1;
    this.shownGear = '';
    this.renderHint();
    if (vehicle) {
      this.el.speedoName.textContent = t(vehicle.def.nameKey);
      this.fillVehicleCard(vehicle);
      this.el.vehicleCard.hidden = false;
      this.vehicleCardTimer = VEHICLE_CARD_SECONDS;
    } else {
      this.el.vehicleCard.hidden = true;
      this.vehicleCardTimer = 0;
    }
  }

  /** Машины нэр, тайлбар, үзүүлэлт (хурд / удирдлага / бат бэх — 5 онооны шкал). */
  fillVehicleCard(vehicle) {
    const { def } = vehicle;
    this.el.vehicleCardName.textContent = t(def.nameKey);
    this.el.vehicleCardDescription.textContent = t(def.descriptionKey);
    this.el.vehicleCardStats.replaceChildren(
      ...STAT_KEYS.map((key) => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        const label = document.createElement('span');
        label.textContent = t(`vehicles.stats.${key}`);
        const pips = document.createElement('span');
        pips.className = 'stat-pips';
        pips.setAttribute('aria-label', `${def.stats[key]} / 5`);
        for (let i = 1; i <= 5; i++) {
          const pip = document.createElement('i');
          if (i <= def.stats[key]) pip.className = 'is-on';
          pips.append(pip);
        }
        row.append(label, pips);
        return row;
      }),
    );
  }

  /** Кадр бүр (жолоодох үед): хурд, араа, хурдны шугам. DOM-ийг зөвхөн өөрчлөгдөхөд шинэчилнэ. */
  updateVehicleHud(vehicle) {
    const kmh = Math.round(Math.abs(vehicle.speedKmh));
    if (kmh !== this.shownSpeed) {
      this.shownSpeed = kmh;
      this.el.speedoValue.textContent = String(kmh);
      const ratio = Math.min(1, kmh / vehicle.def.maxSpeedKmh);
      this.el.speedoFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
    }
    let gear = 'D';
    if (vehicle.speed < -0.3) gear = 'R';
    else if (Math.abs(vehicle.speed) < 0.3 && vehicle.input.throttle < 0.01) gear = 'N';
    if (gear !== this.shownGear) {
      this.shownGear = gear;
      this.el.speedoGear.textContent = gear;
      this.el.speedoGear.dataset.gear = gear;
    }
  }

  // ---------- Debug ----------

  toggleDebug() {
    this.setDebugVisible(!this.debugVisible);
  }

  setDebugVisible(visible) {
    this.debugVisible = visible;
    this.game.settings.set('showDebug', visible);
    this.el.showDebug.checked = visible;
    this.renderDebug();
  }

  update(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('is-visible');
    }
    if (this.vehicleCardTimer > 0) {
      this.vehicleCardTimer -= dt;
      if (this.vehicleCardTimer <= 0) this.el.vehicleCard.hidden = true;
    }
    // FPS-ийг 0.5 сек тутамд тооцоолж, DOM-ийг цөөн шинэчилнэ
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.renderDebug();
    }
  }

  renderDebug() {
    const element = this.el.debug;
    const visible = this.debugVisible && (this.state === 'playing' || this.state === 'paused');
    element.hidden = !visible;
    const { player, renderer } = this.game;
    if (!visible || !player || !renderer) return;
    const p = player.position;
    const info = renderer.info.render;
    const lines = [
      `${t('debug.fps')}: ${this.fps}`,
      `${t('debug.position')}: ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`,
    ];
    if (this.vehicle) {
      const kmh = Math.abs(this.vehicle.speedKmh).toFixed(0);
      lines.push(`${t('debug.vehicle')}: ${kmh} ${t('units.kmh')} · ${this.vehicle.wheelsInContact()}/4 ${t('debug.wheels')}`);
    } else {
      lines.push(`${t('debug.speed')}: ${player.horizontalSpeed.toFixed(1)} ${t('debug.mps')}`);
      lines.push(player.grounded ? t('debug.grounded') : t('debug.airborne'));
    }
    lines.push(`${t('debug.drawCalls')}: ${info.calls} · ${t('debug.triangles')}: ${info.triangles}`);
    element.textContent = lines.join('\n');
  }
}

function createKey(label) {
  const kbd = document.createElement('kbd');
  kbd.textContent = label.startsWith('@') ? t(label.slice(1)) : label;
  return kbd;
}

/**
 * Удирдлагын хэсэг: гарчиг + 2 баганатай grid (товчлуур | тайлбар).
 * @param {string} titleKey
 * @param {{keys:string[], label:string}[]} items
 */
function controlGroup(titleKey, items, muted = false) {
  const group = document.createElement('div');
  group.className = 'controls-group';
  const heading = document.createElement('span');
  heading.className = 'controls-subheading';
  heading.textContent = t(titleKey);
  const grid = document.createElement('div');
  grid.className = 'controls';
  for (const item of items) {
    const keys = document.createElement('span');
    keys.className = muted ? 'controls-keys is-muted' : 'controls-keys';
    keys.append(...item.keys.map(createKey));
    const label = document.createElement('span');
    label.className = muted ? 'controls-label is-muted' : 'controls-label';
    label.textContent = t(item.label);
    grid.append(keys, label);
  }
  group.append(heading, grid);
  return group;
}

/** Удирдлагын жагсаалт: "Явган" ба "Машин" хэсэг (цэсэнд debug, удахгүй нэмэгдэх, жойстик). */
function renderControlList(container, detailed) {
  const nodes = [
    controlGroup('controls.onFoot', FOOT_CONTROLS),
    controlGroup('controls.driving', detailed ? [...DRIVE_CONTROLS, ...DEBUG_CONTROLS] : DRIVE_CONTROLS),
  ];
  if (detailed) {
    nodes.push(controlGroup('controls.upcoming', UPCOMING_CONTROLS, true));
    for (const key of ['controls.gamepad', 'controls.gamepadDrive']) {
      const note = document.createElement('p');
      note.className = 'controls-note';
      note.textContent = t(key);
      nodes.push(note);
    }
  }
  container.replaceChildren(...nodes);
}
