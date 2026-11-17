// NPC-ийн бүх системийг холбоно: замын сүлжээ, гэрлэн дохио, машин, явган хүн, яриа.
//
// Тогтмол алхам бүрт (world.step()-ээс өмнө):
//   гэрлэн дохио → орон зайн хэш (машин, хүн, тоглогч, тоглогчийн машин) → машин → явган хүн
// Кадр бүрт: гаргах / устгах, InstancedMesh-ийн матриц, гэрлэн дохионы чийдэн, яриан хөөс.
import * as THREE from 'three';
import { tList } from '../i18n/i18n.js';
import { Pedestrians } from './Pedestrians.js';
import { SpatialHash } from './SpatialHash.js';
import { SpeechBubbles } from './SpeechBubbles.js';
import { TrafficCars } from './TrafficCars.js';
import { TrafficNetwork } from './TrafficNetwork.js';
import { TrafficSignals } from './TrafficSignals.js';

// Тоглогч нэг кадрт ийм зай "үсэрвэл" (эхлэлийн цэг рүү буцах г.м.) ойр орчныг дахин дүүргэнэ
const REPOPULATE_JUMP = 120;

export class NpcManager {
  /**
   * @param {{scene: THREE.Scene, physics: import('../core/Physics.js').Physics, camera: THREE.Camera,
   *          city: import('../city/CityBuilder.js').CityBuilder, speechLayer: HTMLElement|null}} options
   */
  constructor({ scene, physics, camera, city, speechLayer }) {
    this.camera = camera;
    this.network = new TrafficNetwork(city.network);
    this.signals = new TrafficSignals(scene, this.network, city.trafficLights);
    this.hash = new SpatialHash(16);
    this.bubbles = new SpeechBubbles(speechLayer, camera);
    const shared = { scene, physics, network: this.network, signals: this.signals, hash: this.hash };
    this.cars = new TrafficCars(shared);
    this.peds = new Pedestrians(shared);
    this.cars.onEvent = (car, kind) => this.say(car.renderPosition, car.height + 0.55, kind === 'honk' ? 'honk' : 'carBump');
    this.peds.onSpeak = (ped, key) => this.say(ped.renderPosition, 1.95 * ped.scale + 0.25, key);
    this.peds.onKnocked = (ped, vehicle) => this.handleKnock(ped, vehicle);
    /** (ped, vehicle) — тоглогч явган хүн мөргөсөн (Үе шат 5: эрэн сурвалжлалт) */
    this.onPedestrianHit = null;

    this.playerEntry = { kind: 'player', ref: null, x: 0, z: 0, hx: 0, hz: 1, vx: 0, vz: 0, halfLength: 0.35, halfWidth: 0.35 };
    this.vehicleEntries = new WeakMap();
    this.context = { onFoot: true, playerEntry: this.playerEntry, vehicles: [] };
    this.cameraForward = new THREE.Vector3(0, 0, -1);
    this.lastFocus = new THREE.Vector3();
    this.populated = false;
  }

  /** Ойр орчныг машин, хүнээр шууд дүүргэнэ (эхлэх үед, хол үсэрсний дараа). */
  populate(focus) {
    this.populated = true;
    this.lastFocus.copy(focus);
    this.cars.populate(focus);
    this.peds.populate(focus);
  }

  /**
   * Тогтмол алхам (world.step()-ээс өмнө).
   * @param {{player: import('../player/Player.js').Player, onFoot: boolean, vehicles: import('../vehicles/Vehicle.js').Vehicle[]}} state
   */
  fixedUpdate(dt, { player, onFoot, vehicles }) {
    this.signals.update(dt);

    const ctx = this.context;
    ctx.onFoot = onFoot;
    const p = this.playerEntry;
    p.x = player.position.x;
    p.z = player.position.z;
    p.vx = player.velocity.x;
    p.vz = player.velocity.z;
    p.hx = Math.sin(player.facing);
    p.hz = Math.cos(player.facing);
    ctx.vehicles.length = 0;
    for (const vehicle of vehicles) ctx.vehicles.push(this.vehicleEntry(vehicle));

    const hash = this.hash;
    hash.clear();
    for (const car of this.cars.cars) hash.insert(car.entry);
    for (const ped of this.peds.peds) hash.insert(ped.entry);
    if (onFoot) hash.insert(p);
    for (const entry of ctx.vehicles) hash.insert(entry);

    this.cars.fixedUpdate(dt, ctx);
    this.peds.fixedUpdate(dt, ctx);
  }

  /** Тоглогчийн (физик) машины байрлал, чиглэл, хурд — NPC-д ойлгомжтой хэлбэрээр. */
  vehicleEntry(vehicle) {
    let entry = this.vehicleEntries.get(vehicle);
    if (!entry) {
      const { length, width } = vehicle.def.size;
      entry = { kind: 'playerCar', ref: vehicle, x: 0, z: 0, hx: 0, hz: 1, vx: 0, vz: 0, driven: false, halfLength: length / 2, halfWidth: width / 2 };
      this.vehicleEntries.set(vehicle, entry);
    }
    const position = vehicle.currPosition;
    const yaw = vehicle.yaw;
    const velocity = vehicle.body.linvel();
    entry.x = position.x;
    entry.z = position.z;
    entry.hx = Math.sin(yaw);
    entry.hz = Math.cos(yaw);
    entry.vx = velocity.x;
    entry.vz = velocity.z;
    entry.driven = vehicle.hasDriver;
    return entry;
  }

  /**
   * Кадр бүр (физикийн дараа, камер шинэчлэгдсэний дараа).
   * @param {THREE.Vector3} focus Тоглогч эсвэл түүний машин
   */
  update(dt, alpha, focus) {
    this.camera.getWorldDirection(this.cameraForward);
    if (!this.populated || this.lastFocus.distanceTo(focus) > REPOPULATE_JUMP) this.populate(focus);
    this.lastFocus.copy(focus);
    this.cars.update(dt, alpha, focus, this.cameraForward);
    this.peds.update(dt, alpha, focus, this.cameraForward);
    this.signals.updateVisuals();
    this.bubbles.update(dt);
  }

  /** Санамсаргүй нэг мөр (mn.json / en.json-ийн npc.* жагсаалтаас). */
  say(anchor, height, key) {
    const lines = tList(`npc.${key}`);
    if (lines.length > 0) this.bubbles.say(anchor, height, lines[Math.floor(Math.random() * lines.length)]);
  }

  handleKnock(ped, vehicle) {
    // Машин хүнийг "мэдэрч" бага зэрэг удаашрна
    const body = vehicle.ref.body;
    const mass = body.mass();
    body.applyImpulse({ x: -vehicle.vx * mass * 0.06, y: 0, z: -vehicle.vz * mass * 0.06 }, true);
    this.onPedestrianHit?.(ped, vehicle.ref);
  }

  /**
   * F: NPC машиныг булаана — жолооч нь хаалгаар гарч зугтана.
   * @returns {{type:string, color:number, position:THREE.Vector3, yaw:number}} Физик машин үүсгэх мэдээлэл
   */
  takeCar(car) {
    const info = this.cars.extract(car);
    const h = info.heading;
    // Баруун жолоотой машин — жолооч баруун хаалгаар (явган замын талд) бууна
    const side = info.halfWidth + 0.75;
    const door = { x: info.position.x - h.z * side, z: info.position.z + h.x * side };
    const driver = this.peds.spawnFleeing(door, info.position);
    if (driver) this.say(driver.renderPosition, 1.95 * driver.scale + 0.25, 'jacked');
    return info;
  }

  get stats() {
    return { cars: this.cars.cars.length, peds: this.peds.peds.length };
  }
}
