// Тоглоомын гол класс: renderer, тоглоомын давталт (game loop), төлөв (цэс/тоглож буй/түр зогссон),
// бүх системийг холбоно.
//
// Давталт:  оролт → камер → [физик × N тогтмол алхам] → interpolation → анимаци → зураг
// Явган үед тоглогчийн character controller, машинд суусан үед машины физик удирдагдана.
// NPC (машин, явган хүн, гэрлэн дохио) физикийн алхам бүрт тоглогчийн дараа, world.step()-ээс өмнө.
import * as THREE from 'three';
import { districtAt } from '../city/cityLayout.js';
import { getLanguage, setLanguage as applyLanguage, t } from '../i18n/i18n.js';
import { Navigator } from '../navigation/Navigator.js';
import { NpcManager } from '../npc/NpcManager.js';
import { RoadGraph } from '../navigation/RoadGraph.js';
import { Player } from '../player/Player.js';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera.js';
import { UI } from '../ui/UI.js';
import { VehicleManager } from '../vehicles/VehicleManager.js';
import { World } from '../world/World.js';
import { CONFIG } from './config.js';
import { Input } from './Input.js';
import { Physics } from './Physics.js';
import { PhysicsDebug } from './PhysicsDebug.js';
import { Settings } from './Settings.js';

export const State = Object.freeze({
  LOADING: 'loading',
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  MAP: 'map', // Том газрын зураг нээлттэй (тоглоом түр зогсоно)
});

// Esc дарж pointer lock-ийг тайлахад зарим browser keydown-ыг бас илгээдэг —
// энэ хугацаанд ирсэн "pause" дарагдалтыг давхар тооцохгүй (мс)
const UNLOCK_DEBOUNCE_MS = 400;
// Ачаалсны дараа машин, хайрцаг тогтвортой суух хүртэл урьдчилан хийх физик алхам
const SETTLE_STEPS = 90;
// Тоглогчоос ийм хол орхигдсон түр машиныг (булаасан машин г.м.) устгана (м)
const ABANDONED_VEHICLE_DISTANCE = 420;

export class Game {
  constructor() {
    this.state = State.LOADING;
    this.accumulator = 0;
    this.lastTime = 0;
    this.lastUnlockAt = -Infinity;
    this.needsRender = true;
    /** @type {import('../vehicles/Vehicle.js').Vehicle|null} Тоглогчийн жолоодож буй машин */
    this.activeVehicle = null;
    /** @type {import('../vehicles/Vehicle.js').Vehicle|null} F дарвал суух боломжтой ойрын машин */
    this.enterCandidate = null;
    /** @type {object|null} F дарвал булааж болох NPC машин (замын хөдөлгөөнөөс) */
    this.carjackCandidate = null;
    this.cullTimer = 0;
    // NPC-ийн физик алхамд дамжуулах мэдээлэл (кадр бүр шинээр үүсгэхгүй)
    this.npcState = { player: null, onFoot: true, vehicles: null };
  }

  async init() {
    this.settings = new Settings();
    applyLanguage(this.settings.get('language'));
    this.ui = new UI(this);
    this.ui.onStateChange(this.state);

    try {
      this.createGraphics();
    } catch (error) {
      this.ui.showError(t('start.webglError'));
      throw error;
    }

    try {
      await this.createWorld();
    } catch (error) {
      // Ямар ч алдаа гарсан "Ачаалж байна…" дээр гацахгүй, хэрэглэгчид мэдэгдэнэ
      this.ui.showError(t('start.loadError'));
      throw error;
    }

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    this.resize();
    this.setState(State.MENU);
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  /** Физик, ертөнц, тоглогч, машин, камер, оролтыг үүсгэнэ. */
  async createWorld() {
    this.physics = await Physics.create();
    this.world = new World(this.scene, this.physics, this.renderer, this.camera);
    this.player = new Player(this.scene, this.physics);
    this.vehicles = new VehicleManager(this.scene, this.physics);
    for (const spawn of this.world.vehicleSpawns) this.spawnVehicle(spawn.type, spawn.position, spawn.yaw);
    // Хотын хүн ам: замын хөдөлгөөн, явган хүн, гэрлэн дохио
    this.npc = new NpcManager({
      scene: this.scene,
      physics: this.physics,
      camera: this.camera,
      city: this.world.city,
      speechLayer: document.getElementById('hud-speech'),
    });
    this.npcState.player = this.player;
    this.npcState.vehicles = this.vehicles.vehicles;
    this.npc.populate(this.player.position);
    this.cameraRig = new ThirdPersonCamera(this.camera, this.physics, this.settings);
    this.cameraRig.yaw = 0.9; // Цэсний үеийн эхлэх өнцөг
    this.physicsDebug = new PhysicsDebug(this.scene, this.physics);
    // GPS ба газрын зураг
    this.navigator = new Navigator(new RoadGraph(this.world.city.network));
    this.ui.initMap(this.world.mapData, this.navigator, (point) => this.setWaypoint(point));

    // Машины пүрш, хайрцгийн овоо тогтвортой суутал физикийг урьдчилан ажиллуулна
    // (мөн статик collider-уудыг цацраг/KCC query-д бэлэн болгоно)
    for (let i = 0; i < SETTLE_STEPS; i++) this.stepPhysics(CONFIG.physics.fixedStep, false);
    this.vehicles.updateVisual(0, 1);

    this.input = new Input(this.canvas);
    this.input.onPointerLockChange = (locked) => this.handlePointerLockChange(locked);
    this.input.onCanvasPointerDown = () => {
      if (this.state === State.PLAYING && !this.input.pointerLocked) this.input.requestPointerLock();
    };
    this.input.onGamepadChange = (connected) => this.ui.toast(t(connected ? 'hud.gamepadOn' : 'hud.gamepadOff'));
  }

  createGraphics() {
    this.canvas = document.getElementById('game-canvas');
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.graphics.maxPixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const c = CONFIG.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, window.innerWidth / window.innerHeight, c.near, c.far);
  }

  /** Нэг кадр. time — requestAnimationFrame-ийн хугацаа (мс). */
  frame(time) {
    const now = time * 0.001;
    // Таб сольж ирэх г.м. урт завсарлагааны дараа физик "үсрэхгүй" байхаар хязгаарлана
    const dt = this.lastTime > 0 ? Math.min(now - this.lastTime, 0.1) : 0;
    this.lastTime = now;

    this.input.poll();
    this.handleGlobalInput();

    if (this.state === State.PLAYING) this.updatePlaying(dt);
    else if (this.state === State.MENU) this.updateMenu(dt);

    this.input.endFrame();
    this.ui.update(dt);

    // Түр зогссон / газрын зураг нээлттэй үед дүрс өөрчлөгдөхгүй тул дахин зурахгүй (GPU, батарей хэмнэнэ)
    const frozen = this.state === State.PAUSED || this.state === State.MAP;
    if (!frozen || this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }

  /**
   * Нэг тогтмол физик алхам: тоглогч эсвэл машины удирдлага → бүх машин → world.step.
   * @param {boolean} includePlayer Явган тоглогчийн character controller-ийг ажиллуулах эсэх
   */
  stepPhysics(step, includePlayer) {
    if (includePlayer) this.player.fixedUpdate(step);
    this.npcState.onFoot = !this.activeVehicle;
    this.npc.fixedUpdate(step, this.npcState);
    this.vehicles.fixedUpdate(step);
    this.physics.step();
    this.vehicles.afterStep();
  }

  /**
   * Тогтмол алхмын физик (accumulator). Дэлгэц 30, 60, 144 Гц ч бай үр дүн ижил.
   * @returns {number} alpha — дараагийн алхам хүртэлх хувь (interpolation-д)
   */
  runPhysics(dt, includePlayer) {
    const step = CONFIG.physics.fixedStep;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step) {
      this.stepPhysics(step, includePlayer);
      this.accumulator -= step;
      if (++steps >= CONFIG.physics.maxSubSteps) {
        this.accumulator = 0; // Хэт удааширвал гүйцэхийг оролдохгүй ("spiral of death"-ээс сэргийлнэ)
        break;
      }
    }
    return this.accumulator / step;
  }

  updatePlaying(dt) {
    const { input, player, cameraRig } = this;
    cameraRig.handleInput(input, dt);
    if (this.activeVehicle) this.activeVehicle.setDriverInput(input.getDriveInput());
    else player.handleInput(input, cameraRig.yaw);

    // F / Y: машинд суух, буух эсвэл замын хөдөлгөөний машиныг булаах
    if (input.wasPressed('vehicle')) {
      if (this.activeVehicle) this.exitVehicle();
      else if (this.enterCandidate) this.enterVehicle(this.enterCandidate);
      else if (this.carjackCandidate) this.carjack(this.carjackCandidate);
    }

    const alpha = this.runPhysics(dt, !this.activeVehicle);
    this.vehicles.updateVisual(dt, alpha);
    let focus;
    const vehicle = this.activeVehicle;
    if (vehicle) {
      player.followVehicle(vehicle.renderPosition);
      player.updateSeatedVisual(dt);
      cameraRig.update(dt, vehicle.renderPosition, vehicle.speed, vehicle.yaw + Math.PI);
      this.ui.updateVehicleHud(vehicle);
      focus = vehicle.renderPosition;
    } else {
      player.updateVisual(dt, alpha);
      cameraRig.update(dt, player.renderPosition, player.horizontalSpeed);
      player.setVisible(cameraRig.distance > CONFIG.camera.hidePlayerDistance);
      this.updateEnterPrompt();
      focus = player.renderPosition;
    }
    this.npc.update(dt, alpha, focus);
    this.world.update(focus);
    this.updateNavigation(dt, focus);
    this.physicsDebug.update();

    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 2;
      this.vehicles.cullAbandoned(focus, ABANDONED_VEHICLE_DISTANCE);
    }
  }

  /** GPS маршрут ба мини газрын зураг. */
  updateNavigation(dt, focus) {
    if (this.navigator.update(dt, focus)) this.ui.toast(t('hud.arrived'));
    const vehicle = this.activeVehicle;
    this.ui.map.updateMinimap(dt, {
      position: focus,
      facing: vehicle ? vehicle.yaw : this.player.facing,
      cameraYaw: this.cameraRig.yaw,
      speed: vehicle ? vehicle.speed : this.player.horizontalSpeed,
      driving: Boolean(vehicle),
      vehicles: this.vehicles.vehicles
        .filter((v) => v !== vehicle)
        .map((v) => ({ x: v.renderPosition.x, z: v.renderPosition.z, yaw: v.yaw })),
      district: t(`districts.${this.districtKeyAt(focus)}`),
    });
  }

  /** Байрлал аль хороолол вэ (мини газрын зургийн дээрх нэр). */
  districtKeyAt(position) {
    const training = this.world.mapData.training;
    const { x, z } = position;
    if (x > training.minX && x < training.maxX && z > training.minZ && z < training.maxZ) return 'training';
    if (Math.abs(x) > 790 || z < -790 || z > 730) return 'outskirts';
    if (Math.abs(x) < 55 && Math.abs(z) < 55) return 'square';
    return districtAt(x, z);
  }

  /** Том газрын зураг дээр дарж зорих цэг тавих (null — арилгах). */
  setWaypoint(point) {
    const focus = this.activeVehicle ? this.activeVehicle.currPosition : this.player.position;
    if (point) {
      this.navigator.setWaypoint(point, focus);
      this.ui.toast(t('hud.waypointSet'));
    } else if (this.navigator.waypoint) {
      this.navigator.clear();
      this.ui.toast(t('hud.waypointCleared'));
    }
  }

  /** Эхлэлийн цэс: камер дүрийг аажуухан тойрно, дүр амьсгалж зогсоно, ар талд хот амьдарна. */
  updateMenu(dt) {
    this.cameraRig.orbit(dt);
    const alpha = this.runPhysics(dt, false);
    this.player.updateVisual(dt, 1);
    this.vehicles.updateVisual(dt, alpha);
    this.cameraRig.update(dt, this.player.renderPosition, 0);
    this.npc.update(dt, alpha, this.player.renderPosition);
    this.world.update(this.player.renderPosition);
  }

  handleGlobalInput() {
    const { input } = this;
    if (input.wasPressed('map')) {
      if (this.state === State.PLAYING) this.openMap();
      else if (this.state === State.MAP) this.closeMap();
    }
    if (input.wasPressed('pause')) {
      const recentlyUnlocked = performance.now() - this.lastUnlockAt < UNLOCK_DEBOUNCE_MS;
      if (this.state === State.MAP) this.closeMap();
      else if (!recentlyUnlocked) {
        if (this.state === State.PLAYING) this.pause();
        else if (this.state === State.PAUSED) this.resume();
      }
    }
    if (input.wasPressed('debugInfo')) this.ui.toggleDebug();
    if (input.wasPressed('debugPhysics') && this.state !== State.LOADING) {
      const enabled = this.physicsDebug.toggle();
      this.ui.toast(t(enabled ? 'hud.physicsOn' : 'hud.physicsOff'));
      this.needsRender = true;
    }
  }

  // ---------- Машин ----------

  /** Ойролцоо машин байвал "F — Машинд суух" эсвэл "F — Машин булаах" сануулга харуулна. */
  updateEnterPrompt() {
    const { enterDistance, maxEnterSpeed } = CONFIG.vehicle;
    this.enterCandidate = this.vehicles.findEnterable(this.player.position, enterDistance, maxEnterSpeed);
    this.carjackCandidate = this.enterCandidate ? null : this.npc.cars.findCarjackTarget(this.player.position);
    this.ui.setEnterPrompt(this.enterCandidate ? 'enter' : this.carjackCandidate ? 'carjack' : null);
  }

  /** Физик машин үүсгэнэ (хөмөрснөөс эргүүлэхэд мэдэгдэл харуулна). */
  spawnVehicle(type, position, yaw, options) {
    const vehicle = this.vehicles.spawn(type, position, yaw, options);
    vehicle.onRecovered = (recovered) => {
      if (recovered === this.activeVehicle) this.ui.toast(t('hud.vehicleRecovered'));
    };
    return vehicle;
  }

  /**
   * F: замын хөдөлгөөний (NPC) машиныг булаана. NPC машин яг тэр байрлалд жинхэнэ физик машин
   * болж хувирна, жолооч нь буугаад зугтана, тоглогч сууна. Хол орхивол машин устана.
   */
  carjack(car) {
    if (!this.npc.cars.cars.includes(car)) return;
    const info = this.npc.takeCar(car);
    const position = { x: info.position.x, y: 0.05, z: info.position.z };
    const vehicle = this.spawnVehicle(info.type, position, info.yaw, { color: info.color, persistent: false });
    this.carjackCandidate = null;
    this.enterVehicle(vehicle);
  }

  enterVehicle(vehicle) {
    this.activeVehicle = vehicle;
    this.enterCandidate = null;
    this.ui.setEnterPrompt(false);
    this.player.setPhysicsEnabled(false); // Машинтай мөргөлдөхгүй
    this.player.setVisible(true);
    vehicle.attachDriver(this.player.model);
    this.cameraRig.setProfile('vehicle');
    this.cameraRig.requestRecenter(); // Камер машины ард зөөлөн эргэж ирнэ
    this.ui.setDriving(vehicle);
  }

  /**
   * Машинаас буух. Хаалганы гадна зай байхгүй бол буухгүй (force үед заавал буулгана).
   * @returns {boolean} Буусан эсэх
   */
  exitVehicle({ force = false } = {}) {
    const vehicle = this.activeVehicle;
    if (!vehicle) return true;
    let spot = vehicle.findExitPosition((feet) => this.player.canStandAt(feet));
    if (!spot) {
      if (!force) {
        this.ui.toast(t('hud.cannotExit'));
        return false;
      }
      spot = vehicle.currPosition.clone().setY(vehicle.currPosition.y + 2);
    }
    vehicle.detachDriver(this.scene);
    this.activeVehicle = null;
    this.player.teleport(spot, vehicle.yaw);
    this.player.setPhysicsEnabled(true);
    this.cameraRig.setProfile('onFoot');
    this.ui.setDriving(null);
    return true;
  }

  /** Түр зогсоох цэснээс: бүх машин, конус, хайрцгийг анхны байранд нь буцаана. */
  resetVehicles() {
    for (const vehicle of this.vehicles.vehicles) vehicle.resetToSpawn();
    this.world.resetProps();
    if (this.activeVehicle) this.cameraRig.resetBehind(this.activeVehicle.yaw);
    this.ui.toast(t('hud.vehicleReset'));
    this.resume();
  }

  // ---------- Төлөв солих ----------

  start() {
    if (this.state !== State.MENU) return;
    this.cameraRig.resetBehind(this.player.facing);
    this.setState(State.PLAYING);
    this.input.requestPointerLock();
  }

  pause() {
    if (this.state !== State.PLAYING) return;
    this.setState(State.PAUSED);
    this.input.exitPointerLock();
  }

  resume() {
    if (this.state !== State.PAUSED) return;
    this.setState(State.PLAYING);
    this.input.requestPointerLock();
  }

  /** M: том газрын зураг (тоглоом түр зогсоно, хулгана чөлөөлөгдөнө). */
  openMap() {
    if (this.state !== State.PLAYING) return;
    this.setState(State.MAP); // Эхлээд төлөв — pointer lock тайлагдахад "pause" болохгүй
    this.input.exitPointerLock();
  }

  closeMap() {
    if (this.state !== State.MAP) return;
    this.setState(State.PLAYING);
    this.input.requestPointerLock();
  }

  respawn() {
    if (this.activeVehicle) this.exitVehicle({ force: true });
    this.player.respawn();
    this.cameraRig.resetBehind(this.player.facing);
    this.ui.toast(t('hud.respawned'));
    this.resume();
  }

  setLanguage(code) {
    applyLanguage(code);
    this.settings.set('language', getLanguage());
    this.needsRender = true;
  }

  setState(state) {
    this.state = state;
    this.accumulator = 0;
    this.input.setGameplayActive(state === State.PLAYING);
    this.ui.onStateChange(state);
    this.ui.setLookHint(state === State.PLAYING && !this.input.pointerLocked);
    this.needsRender = true;
  }

  handlePointerLockChange(locked) {
    if (!locked) {
      this.lastUnlockAt = performance.now();
      // Esc дарж хулганаа суллавал (browser-ийн стандарт) тоглоом түр зогсоно
      if (this.state === State.PLAYING) this.pause();
    }
    this.ui.setLookHint(this.state === State.PLAYING && !locked);
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }
}
