// Даалгаврын систем (Үе шат 6).
//
//   • Нээлттэй даалгаврын эхлэх цэг дээр даалгавар өгөх дүр зогсож, газар дээр өлзий хээтэй гэрэлт
//     тэмдэг (мини газрын зурагт дүрийн үсэг) харагдана. Явганаар очоод E дарж эхлүүлнэ.
//     Цагдаа хөөж байхад даалгавар эхлэхгүй.
//   • Даалгавар нь алхмуудаас бүрдэнэ (missionData.js): яриа → машинд суух → жолоодох / дагах → төгсгөл.
//     Зорилт бүрт GPS маршрут, 3D тэмдэг, HUD-д зорилтын текст, цаг, хэмжүүр.
//   • Амжилт — ₮ шагнал, дараагийн даалгавар нээгдэнэ. Бүтэлгүйтвэл (цаг дуусах, алдах, баривчлагдах)
//     эхлэх цэг дээрээс дахин оролдоно.
import { formatMoney } from '../core/Progress.js';
import { t, tList } from '../i18n/i18n.js';
import { boxesOverlap } from '../npc/TrafficCars.js';
import { AiDriver } from '../vehicles/AiDriver.js';
import { Dialogue } from './Dialogue.js';
import { FloatingArrow, MissionMarker } from './MissionMarkers.js';
import { CHARACTERS, MISSIONS } from './missionData.js';

const START_RADIUS = 2.4; // Эхлэх цэгээс хэр ойр E дарж болох (м)
const CHARACTER_SPAWN = 140; // Дүрийг тоглогчоос ийм зайд гаргана (м)
const STOP_SPEED = 1.5; // "Зогссон" гэж үзэх хурд (м/с)
const OBJECTIVE_COLOR = '#f0cf82';

export class MissionManager {
  /**
   * @param {{scene: import('three').Scene, physics: import('../core/Physics.js').Physics, vehicles: import('../vehicles/VehicleManager.js').VehicleManager,
   *          npc: import('../npc/NpcManager.js').NpcManager, graph: import('../navigation/RoadGraph.js').RoadGraph,
   *          navigator: import('../navigation/Navigator.js').Navigator, ui: import('../ui/UI.js').UI,
   *          progress: import('../core/Progress.js').Progress}} options
   */
  constructor({ scene, physics, vehicles, npc, graph, navigator, ui, progress }) {
    this.physics = physics;
    this.vehicles = vehicles;
    this.npc = npc;
    this.graph = graph;
    this.navigator = navigator;
    this.ui = ui;
    this.progress = progress;
    this.dialogue = new Dialogue(ui);
    /** @type {Map<string, MissionMarker>} Эхлэх цэгийн тэмдэг */
    this.markers = new Map();
    for (const def of MISSIONS) {
      const character = CHARACTERS[def.giver];
      const marker = new MissionMarker(scene, { color: character.color, letter: character.letter });
      marker.setPosition(def.start.x, def.start.y, def.start.z);
      marker.visible = false;
      this.markers.set(def.id, marker);
    }
    this.goalMarker = new MissionMarker(scene, { color: OBJECTIVE_COLOR, radius: 3.2 });
    this.goalMarker.visible = false;
    this.arrow = new FloatingArrow(scene, OBJECTIVE_COLOR);
    /** @type {Map<string, {characterId: string, at: object, ped: object|null}>} Тоглогч ойртоход гарах дүрүүд */
    this.characters = new Map();
    this.characterController = { step: (ped) => this.faceTarget(ped) };
    this.active = null;
    /** @type {{def: object, blocked: boolean}|null} E дарж эхлүүлэх боломжтой даалгавар */
    this.prompt = null;
    this.time = 0;
    this.focus = { x: 0, z: 0 };
    this.playerVehicle = null;
    this.refreshAvailable();
  }

  isAvailable(def) {
    return !this.progress.isCompleted(def.id) && (!def.requires || this.progress.isCompleted(def.requires));
  }

  /** Нээлттэй даалгаврын эхлэх цэгүүд: тэмдэг ба даалгавар өгөх дүр. */
  refreshAvailable() {
    for (const def of MISSIONS) {
      const available = !this.active && this.isAvailable(def);
      this.markers.get(def.id).visible = available;
      const key = `start:${def.id}`;
      if (available) this.want(key, def.giver, def.start);
      else if (!this.active || this.active.def !== def) this.unwant(key);
    }
  }

  // ---------- Дүрүүд ----------

  /** Дүр хэрэгтэй гэж бүртгэнэ — тоглогч ойртоход явган зам дээр гарч ирнэ. */
  want(key, characterId, at) {
    if (!this.characters.has(key)) this.characters.set(key, { characterId, at, ped: null });
  }

  /** @param {boolean} release true — олны дунд алхаж явна, false — шууд алга болно */
  unwant(key, release = false) {
    const entry = this.characters.get(key);
    if (!entry) return;
    if (entry.ped && !entry.ped.removed) {
      if (release) this.npc.peds.release(entry.ped);
      else this.npc.peds.remove(entry.ped);
    }
    this.characters.delete(key);
  }

  updateCharacters() {
    for (const entry of this.characters.values()) {
      if (entry.ped && !entry.ped.removed) continue;
      if (Math.hypot(entry.at.x - this.focus.x, entry.at.z - this.focus.z) > CHARACTER_SPAWN) continue;
      const character = CHARACTERS[entry.characterId];
      entry.ped = this.npc.peds.spawnControlled({ x: entry.at.x, y: entry.at.y ?? 0, z: entry.at.z }, character.look, this.characterController, {
        ...character.options,
        facing: entry.at.facing,
      });
    }
  }

  /** Дүр ойрхон тоглогч руу харж зогсоно. */
  faceTarget(ped) {
    const dx = this.focus.x - ped.position.x;
    const dz = this.focus.z - ped.position.z;
    if (dx * dx + dz * dz < 15 * 15) ped.yaw = Math.atan2(dx, dz);
  }

  // ---------- Эхлүүлэх ----------

  /** E товч: яриаг алгасах эсвэл даалгавар эхлүүлэх. @returns {boolean} ашигласан эсэх */
  interact() {
    if (this.dialogue.active) {
      this.dialogue.skip();
      return true;
    }
    if (!this.active && this.prompt) {
      if (this.prompt.blocked) this.ui.toast(t('missions.wantedBlocked'));
      else this.start(this.prompt.def);
      return true;
    }
    return false;
  }

  start(def) {
    const vehicles = new Map();
    for (const [tag, spec] of Object.entries(def.vehicles ?? {})) {
      if (spec.traffic) {
        // Замын хөдөлгөөний (скрипттэй) машин
        const car = this.npc.cars.spawnScripted(spec);
        if (car) vehicles.set(tag, trafficAdapter(car, this.npc.cars));
        continue;
      }
      const position = this.clearSpawnArea(spec);
      const vehicle = this.vehicles.spawn(spec.type, position, spec.yaw, { color: spec.color, persistent: true });
      vehicle.missionTag = tag;
      vehicles.set(tag, vehicle);
    }
    // Эхлэх цэгийн дүр даалгаврын "өгсөн хүн" болно
    const startKey = `start:${def.id}`;
    const giver = this.characters.get(startKey) ?? { characterId: def.giver, at: def.start, ped: null };
    this.characters.delete(startKey);
    this.characters.set('giver', giver);
    this.active = { def, index: -1, step: null, vehicles, stepTime: 0, timer: 0, lost: 0, suspicion: 0, hold: 0, distance: 0 };
    this.prompt = null;
    for (const marker of this.markers.values()) marker.visible = false;
    this.ui.showMissionCard(t('missions.label', { number: def.number }), t(`missions.${def.id}.title`), t(CHARACTERS[def.giver].nameKey));
    this.next();
  }

  /** Даалгаврын машин гарах газар орхигдсон түр машин байвал арилгана; тоглогчийн машин бол урагш шилжүүлнэ. */
  clearSpawnArea(spec) {
    const p = { ...spec.position };
    for (const vehicle of [...this.vehicles.vehicles]) {
      if (Math.hypot(vehicle.currPosition.x - p.x, vehicle.currPosition.z - p.z) > 5) continue;
      if (!vehicle.persistent && !vehicle.hasDriver) this.vehicles.remove(vehicle);
      else {
        p.x += Math.sin(spec.yaw) * 7;
        p.z += Math.cos(spec.yaw) * 7;
      }
    }
    return p;
  }

  // ---------- Алхам ----------

  lines(key) {
    return tList(`missions.${this.active.def.id}.lines.${key}`);
  }

  next() {
    const a = this.active;
    this.arrow.hide();
    this.goalMarker.visible = false;
    a.index++;
    if (a.index >= a.def.steps.length) {
      this.complete();
      return;
    }
    const step = a.def.steps[a.index];
    a.step = step;
    a.stepTime = 0;
    a.timer = step.time ?? 0;
    a.lost = 0;
    a.suspicion = 0;
    a.hold = 0;
    a.linesStarted = false;
    a.returning = false;
    switch (step.type) {
      case 'talk':
        this.dialogue.play(this.lines(step.lines), () => this.next());
        break;
      case 'drive':
        for (const [id, at] of Object.entries(step.spawn ?? {})) this.want(`mission:${id}`, id, at);
        break;
      case 'tail':
        this.startTail(step);
        break;
      case 'outro':
        this.startOutro(step);
        break;
      default:
        break;
    }
    this.updateObjective();
  }

  /**
   * Тогтмол алхам (physics-ийн өмнө): дагах машины AI жолооч.
   */
  fixedUpdate(dt) {
    const a = this.active;
    if (!a?.driver || a.driver.vehicle.disposed) return;
    if (a.arrived) a.driver.hold();
    else a.driver.drive(dt, a.goal);
  }

  /**
   * Кадр бүр.
   * @param {{player: import('../player/Player.js').Player, vehicle: import('../vehicles/Vehicle.js').Vehicle|null, wantedLevel: number}} context
   */
  update(dt, { player, vehicle, wantedLevel }) {
    this.time += dt;
    this.playerVehicle = vehicle;
    const position = vehicle ? vehicle.currPosition : player.position;
    this.focus.x = position.x;
    this.focus.z = position.z;
    this.dialogue.update(dt);
    this.updateCharacters();
    if (this.active) this.updateStep(dt, vehicle);
    else this.updatePrompt(vehicle, wantedLevel);
    for (const marker of this.markers.values()) if (marker.visible) marker.update(this.time);
    if (this.goalMarker.visible) this.goalMarker.update(this.time);
  }

  updatePrompt(vehicle, wantedLevel) {
    this.prompt = null;
    if (vehicle) return;
    for (const def of MISSIONS) {
      if (!this.isAvailable(def)) continue;
      if (Math.hypot(def.start.x - this.focus.x, def.start.z - this.focus.z) > START_RADIUS) continue;
      this.prompt = { def, blocked: wantedLevel > 0 };
      return;
    }
  }

  /** Даалгаврын GPS (тоглогч өөр цэг тавьсан ч зорилт руу буцаана). */
  setGps(point) {
    const w = this.navigator.waypoint;
    if (this.navigator.mission && w && Math.hypot(w.x - point.x, w.z - point.z) < 3) return;
    this.navigator.setWaypoint(point, this.focus, true);
  }

  updateStep(dt, vehicle) {
    const a = this.active;
    const step = a.step;
    a.stepTime += dt;
    switch (step.type) {
      case 'enter': {
        const target = a.vehicles.get(step.vehicle);
        if (!target || target.disposed) return this.fail('vehicleLost');
        if (vehicle === target) {
          if (step.companion) this.unwant('giver'); // Хамт явах хүн машинд суулаа
          return this.next();
        }
        this.arrow.show(target.renderPosition, target.def.size.height + 1.4, this.time);
        this.setGps(target.currPosition);
        break;
      }
      case 'drive':
        this.updateDrive(dt, step, vehicle);
        break;
      case 'tail':
        this.updateTail(dt, step, vehicle);
        break;
      case 'observe':
        this.updateObserve(dt, step, vehicle);
        break;
      default:
        break;
    }
  }

  updateDrive(dt, step, vehicle) {
    const a = this.active;
    const required = step.vehicle ? a.vehicles.get(step.vehicle) : null;
    if (required?.disposed) return this.fail('vehicleLost');
    if (step.time) {
      a.timer -= dt;
      if (a.timer <= 0) return this.fail('timeout');
    }
    a.returning = Boolean(required && vehicle !== required);
    if (a.returning) {
      // Даалгаврын машинаас буусан — буцаж суух хүртэл зорилт хүлээнэ
      this.goalMarker.visible = false;
      this.arrow.show(required.renderPosition, required.def.size.height + 1.4, this.time);
      this.setGps(required.currPosition);
    } else {
      this.arrow.hide();
      this.goalMarker.setPosition(step.to.x, 0, step.to.z);
      this.goalMarker.visible = true;
      this.setGps(step.to);
      if (step.lines && !a.linesStarted && a.stepTime > 2.5 && !this.dialogue.active) {
        a.linesStarted = true;
        this.dialogue.play(this.lines(step.lines));
      }
      const distance = Math.hypot(this.focus.x - step.to.x, this.focus.z - step.to.z);
      const speed = vehicle ? Math.abs(vehicle.speed) : 0;
      if (distance < step.radius && (!step.stop || speed < STOP_SPEED)) return this.next();
    }
    this.updateObjective();
  }

  startTail(step) {
    const a = this.active;
    const target = a.vehicles.get(step.target);
    a.arrived = false;
    if (step.lines) this.dialogue.play(this.lines(step.lines));
    if (target.traffic) {
      // Замын дүрмээр явна (гэрлэн дохио, эгнээ)
      if (!this.npc.cars.driveScripted(target.traffic, step.to, step.speed)) this.fail('lost');
      return;
    }
    target.hasDriver = true;
    target.ai = true;
    a.driver = new AiDriver(target, { graph: this.graph, hash: this.npc.hash, physics: this.physics });
    a.driver.maxSpeed = step.speed;
    a.goal = { x: step.to.x, z: step.to.z, vx: 0, vz: 0, speed: 0, direct: false, stop: false, ignore: null };
  }

  /** Анзааргүй дагах: хэт хол бол алдана, хэт ойр (эсвэл мөргөвөл) — сэжиглэнэ. */
  updateTail(dt, step, vehicle) {
    const a = this.active;
    const target = a.vehicles.get(step.target);
    if (!target || target.disposed) return this.fail('lost');
    const distance = Math.hypot(this.focus.x - target.currPosition.x, this.focus.z - target.currPosition.z);
    a.distance = distance;
    this.arrow.show(target.renderPosition, target.def.size.height + 1.6, this.time);
    if (distance > step.maxDistance) {
      a.lost += dt;
      if (a.lost > step.lostTime) return this.fail('lost');
    } else {
      a.lost = 0;
    }
    // Эхний секундэд (жийп хөдөлж эхлэх үед) сэжиглэхгүй
    if (distance < step.minDistance && a.stepTime > 6) a.suspicion += dt;
    else a.suspicion = Math.max(0, a.suspicion - dt * 0.4);
    if (vehicle && distance < 8 && boxesOverlap(boxOf(vehicle), boxOf(target), 0.1)) a.suspicion = step.suspicionLimit;
    if (a.suspicion >= step.suspicionLimit) return this.fail('spotted');
    const arrived = target.traffic ? target.traffic.arrived : Math.hypot(target.currPosition.x - step.to.x, target.currPosition.z - step.to.z) < 14;
    if (arrived) {
      a.arrived = true; // Жийп зорьсон газартаа зогсоно
      return this.next();
    }
    this.updateObjective();
  }

  /** Ажиглах: дагасан машинаас тодорхой зайд зогсож хэдэн секунд харна. */
  updateObserve(dt, step, vehicle) {
    const a = this.active;
    const target = a.vehicles.get(step.target);
    if (!target || target.disposed) return this.fail('lost');
    const distance = Math.hypot(this.focus.x - target.currPosition.x, this.focus.z - target.currPosition.z);
    a.distance = distance;
    this.arrow.show(target.renderPosition, target.def.size.height + 1.6, this.time);
    if (distance < step.minRange) return this.fail('spotted');
    const speed = vehicle ? Math.abs(vehicle.speed) : 0;
    if (distance <= step.range && speed < STOP_SPEED) a.hold += dt;
    else a.hold = Math.max(0, a.hold - dt);
    if (a.hold >= step.time) return this.next();
    this.updateObjective();
  }

  startOutro(step) {
    const a = this.active;
    if (step.companionExit) {
      // Хамт явсан хүн зорчигчийн (зүүн) хаалгаар бууна
      const car = this.playerVehicle ?? a.vehicles.values().next().value;
      const yaw = car.yaw;
      const offset = car.def.size.width / 2 + 0.8;
      const at = { x: car.currPosition.x + Math.cos(yaw) * offset, y: 0, z: car.currPosition.z - Math.sin(yaw) * offset, facing: yaw };
      this.characters.set('giver', { characterId: a.def.giver, at, ped: null });
      this.updateCharacters();
    }
    this.dialogue.play(this.lines(step.lines), () => this.complete());
  }

  // ---------- HUD ----------

  updateObjective() {
    const a = this.active;
    const step = a?.step;
    if (!step?.objective) {
      this.ui.hideObjective();
      return;
    }
    const title = t(`missions.${a.def.id}.title`);
    const key = a.returning ? 'missions.returnToVehicle' : `missions.${a.def.id}.objectives.${step.objective}`;
    const extra = {};
    if (step.time) extra.timer = a.timer;
    if (step.type === 'tail') {
      extra.meter = Math.min(1, a.suspicion / step.suspicionLimit);
      extra.danger = a.suspicion > 0.05;
      if (a.lost > 0) extra.warning = t('missions.tooFar', { seconds: Math.ceil(step.lostTime - a.lost) });
      else if (a.distance < step.minDistance) extra.warning = t('missions.tooClose');
      else extra.info = t('missions.distance', { meters: Math.round(a.distance) });
    } else if (step.type === 'observe') {
      extra.meter = Math.min(1, a.hold / step.time);
      extra.info = t('missions.distance', { meters: Math.round(a.distance) });
    }
    this.ui.setObjective(title, t(key), extra);
  }

  // ---------- Төгсгөл ----------

  complete() {
    const a = this.active;
    if (!a) return;
    this.progress.addMoney(a.def.reward);
    this.progress.complete(a.def.id);
    this.ui.showMissionResult('complete', t('missions.complete'), `${t(`missions.${a.def.id}.title`)} · +${formatMoney(a.def.reward)}`);
    this.finish(true);
    const next = MISSIONS.find((def) => this.isAvailable(def));
    if (next) this.ui.toast(t('missions.unlocked', { name: t(CHARACTERS[next.giver].nameKey) }));
    else this.ui.toast(t('missions.chapterContinues'));
  }

  /** @param {'timeout'|'lost'|'spotted'|'vehicleLost'|'busted'|'abandoned'} reason */
  fail(reason) {
    if (!this.active) return;
    this.dialogue.stop();
    this.ui.showMissionResult('failed', t('missions.failed'), t(`missions.fail.${reason}`));
    this.finish(false);
  }

  finish(success) {
    const a = this.active;
    this.active = null;
    this.arrow.hide();
    this.goalMarker.visible = false;
    if (this.navigator.mission) this.navigator.clear();
    this.ui.hideObjective();
    // Машин: амжилттай бол хотод үлдэнэ (холдоход устна); бүтэлгүйтвэл тоглогч суугаагүйг арилгана
    for (const vehicle of a.vehicles.values()) {
      if (vehicle.disposed) continue;
      if (vehicle.traffic) {
        // Скрипттэй машин: амжилттай бол энгийн замын машин болно, бүтэлгүйтвэл алга болно
        if (success) this.npc.cars.releaseScripted(vehicle.traffic);
        else this.npc.cars.remove(vehicle.traffic);
        continue;
      }
      vehicle.persistent = false;
      vehicle.ai = false;
      if (vehicle !== this.playerVehicle) vehicle.hasDriver = false;
      if (!success && vehicle !== this.playerVehicle) this.vehicles.remove(vehicle);
    }
    // Дүрүүд: амжилттай бол олны дунд алхаж явна; бүтэлгүйтвэл алга болж, эхлэх цэг дээр дахин гарна
    for (const key of [...this.characters.keys()]) if (!key.startsWith('start:')) this.unwant(key, success);
    this.refreshAvailable();
  }

  /** Мини газрын зурагт: нээлттэй даалгаврын эхлэх цэг (дүрийн өнгө, үсэг). */
  blips() {
    if (this.active) return [];
    return MISSIONS.filter((def) => this.isAvailable(def)).map((def) => {
      const character = CHARACTERS[def.giver];
      return { x: def.start.x, z: def.start.z, color: character.color, letter: character.letter };
    });
  }
}

/** Замын хөдөлгөөний машиныг даалгаварт физик машинтай ижил интерфэйсээр харуулна. */
function trafficAdapter(car, cars) {
  return {
    traffic: car,
    get currPosition() {
      return car.position;
    },
    get renderPosition() {
      return car.renderPosition;
    },
    get speed() {
      return car.speed;
    },
    get yaw() {
      return car.yaw;
    },
    def: { size: { length: car.halfLength * 2, width: car.halfWidth * 2, height: car.height } },
    get disposed() {
      return !cars.cars.includes(car);
    },
  };
}

/** Машины дээрээс харсан тэгш өнцөгт (boxesOverlap-д). */
function boxOf(vehicle) {
  const yaw = vehicle.yaw;
  return {
    x: vehicle.currPosition.x,
    z: vehicle.currPosition.z,
    hx: Math.sin(yaw),
    hz: Math.cos(yaw),
    halfLength: vehicle.def.size.length / 2,
    halfWidth: vehicle.def.size.width / 2,
  };
}
