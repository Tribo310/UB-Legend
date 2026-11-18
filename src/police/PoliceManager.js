// Цагдаа (Үе шат 5): хайлтын түвшингөөр (WantedSystem) цагдаагийн машин гаргах / буцаах,
// тоглогчийг харж байгаа эсэх (барилгын цаана нуугдаж болно), явган цагдаа, баривчлах,
// улаан гэрэл зөрчих, цагдаагийн машин мөргөх зэрэг хэргийг илрүүлэх.
//
//   1★ — 1 машин, 2★ — 2, 3★ — 3 (мөргөж зогсооно), 4★ — 4 (жийп нэмэгдэнэ), 5★ — 6.
//   Тоглогч явган бол машин ойрхон зогсож, цагдаа буугаад хөөнө (гүйж зугтаж болно).
//   Машинтай тоглогч хүрээлэгдэж зогсвол баривчлагдана. Хоосон үлдсэн цагдаагийн машиныг
//   хулгайлж болно — гэхдээ хайлтын түвшин өснө.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { collisionGroups, GROUP } from '../core/Physics.js';
import { boxesOverlap } from '../npc/TrafficCars.js';
import { AiDriver } from '../vehicles/AiDriver.js';

const UNITS_BY_LEVEL = Object.freeze([0, 1, 2, 3, 4, 6]);
const SPEED_BY_LEVEL = Object.freeze([16, 22, 24, 26, 28, 30]); // Хөөцөлдөх дээд хурд (м/с)
const SIGHT_RANGE = 95; // Барилгаар хаагдаагүй бол үүнээс ойр харна
const CLOSE_RANGE = 16; // Үүнээс ойр бол заавал "мэднэ"
const DIRECT_RANGE = 45; // Үүнээс ойр, харагдаж байвал маршрутгүй шууд хөөнө
const PATROL_SIGHT = 70; // Замын хөдөлгөөн дэх эргүүлийн машин харах зай
const OFFICER_SPEED = 6.1; // Тоглогч гүйхэд (7 м/с) зугтаж чадна
const ARREST_TIME = Object.freeze({ onFoot: 1.3, inVehicle: 2.5 });
const OFFICER_COLORS = Object.freeze({ top: 0x22324f, legs: 0x1a1f2b, hair: 0x1c2740 });
const point = { x: 0, z: 0 };
const direction = { x: 0, z: 0 };

export class PoliceManager {
  /**
   * @param {{physics: import('../core/Physics.js').Physics, vehicles: import('../vehicles/VehicleManager.js').VehicleManager,
   *          npc: import('../npc/NpcManager.js').NpcManager, graph: import('../navigation/RoadGraph.js').RoadGraph,
   *          city: import('../city/CityBuilder.js').CityBuilder, wanted: import('./WantedSystem.js').WantedSystem}} options
   */
  constructor({ physics, vehicles, npc, graph, city, wanted }) {
    this.physics = physics;
    this.vehicles = vehicles;
    this.npc = npc;
    this.graph = graph;
    this.city = city;
    this.wanted = wanted;
    this.units = [];
    this.nextId = 1;
    this.spawnTimer = 0.6;
    this.sightTimer = 0;
    this.spotted = false;
    this.arrest = 0;
    this.arrestFraction = 0; // 0..1 — HUD-ийн "баривчилж байна" зурвас
    this.busted = false;
    this.playerVehicle = null;
    this.onFoot = true;
    this.playerPosition = new THREE.Vector3();
    this.playerVelocity = new THREE.Vector3();
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.sightGroups = collisionGroups(GROUP.CAMERA, GROUP.WORLD); // Зөвхөн барилга харааг хаана
    this.wallGroups = collisionGroups(GROUP.NPC, GROUP.WORLD | GROUP.PROP | GROUP.VEHICLE);
    this.signalNodes = [...npc.network.nodes.values()]
      .filter((node) => node.control === 'signal')
      .map((node) => ({ id: node.id, x: node.x, z: node.z, hx: node.net.widthNS / 2, hz: node.net.widthEW / 2 }));
    this.lastSignalNode = null;
    this.goal = { x: 0, z: 0, vx: 0, vz: 0, speed: 0, direct: false, stop: false, ignore: null };
    this.door = { x: 0, z: 0 };
    this.boxA = { x: 0, z: 0, hx: 0, hz: 1, halfLength: 1, halfWidth: 1 };
    this.boxB = { x: 0, z: 0, hx: 0, hz: 1, halfLength: 1, halfWidth: 1 };
    this.officerController = { step: (ped, dt) => this.stepOfficer(ped, dt) };
    /** Баривчлагдах үед */
    this.onBusted = null;
    /** (crime) — цагдаа илрүүлсэн хэрэг: 'policeRam', 'redLight' */
    this.onCrime = null;
  }

  // ---------- Тогтмол алхам ----------

  /**
   * world.step()-ээс өмнө (NPC-ээс өмнө): цагдаагийн машинуудын жолоодлого, баривчилгаа.
   * @param {import('../player/Player.js').Player} player
   * @param {import('../vehicles/Vehicle.js').Vehicle|null} playerVehicle
   */
  fixedUpdate(dt, player, playerVehicle) {
    this.playerVehicle = playerVehicle;
    this.onFoot = !playerVehicle;
    if (playerVehicle) {
      this.playerPosition.copy(playerVehicle.currPosition);
      const v = playerVehicle.body.linvel();
      this.playerVelocity.set(v.x, 0, v.z);
    } else {
      this.playerPosition.copy(player.position);
      this.playerVelocity.set(player.velocity.x, 0, player.velocity.z);
    }
    const level = this.wanted.level;
    for (const unit of this.units) this.stepUnit(unit, dt, level);
    if (playerVehicle) this.checkRams(dt, playerVehicle);
    this.updateArrest(dt, level);
  }

  stepUnit(unit, dt, level) {
    const vehicle = unit.vehicle;
    if (!vehicle || vehicle.disposed || !vehicle.ai) return;
    const driver = unit.driver;
    if (this.busted) {
      driver.hold();
      return;
    }
    const goal = this.goal;
    goal.vx = 0;
    goal.vz = 0;
    goal.speed = 0;
    goal.direct = false;
    goal.stop = false;
    goal.ignore = null;
    if (unit.mode === 'leave') {
      goal.x = unit.leavePoint.x;
      goal.z = unit.leavePoint.z;
      driver.maxSpeed = 14;
      driver.aggressive = false;
    } else if (this.wanted.seen) {
      goal.x = this.playerPosition.x;
      goal.z = this.playerPosition.z;
      goal.vx = this.playerVelocity.x;
      goal.vz = this.playerVelocity.z;
      goal.speed = Math.hypot(goal.vx, goal.vz);
      goal.direct = unit.seen && unit.distance < DIRECT_RANGE;
      goal.stop = this.onFoot; // Явган тоглогчийг дайрахгүй — хажууд нь зогсоно
      goal.ignore = this.playerVehicle; // Тоглогчийн машиныг тойрохгүй — мөргөж зогсооно
      driver.maxSpeed = SPEED_BY_LEVEL[level];
      driver.aggressive = level >= 3;
    } else {
      // Хайлт: эхлээд сүүлд харагдсан газар, дараа нь эргэн тойрны уулзваруудаар
      const p = vehicle.currPosition;
      if (!unit.searchPoint || Math.hypot(unit.searchPoint.x - p.x, unit.searchPoint.z - p.z) < 18) {
        unit.searchPoint = this.pickSearchPoint(unit);
      }
      goal.x = unit.searchPoint.x;
      goal.z = unit.searchPoint.z;
      driver.maxSpeed = SPEED_BY_LEVEL[level] * 0.7;
      driver.aggressive = false;
    }
    driver.drive(dt, goal);
  }

  pickSearchPoint(unit) {
    const center = this.wanted.lastKnown;
    if (!unit.searchedLastKnown) {
      unit.searchedLastKnown = true;
      return { x: center.x, z: center.z };
    }
    const radius = this.wanted.searchRadius;
    const nodes = this.graph.nodes.filter((node) => Math.hypot(node.x - center.x, node.z - center.z) < radius);
    const node = nodes.length > 0 ? nodes[Math.floor(Math.random() * nodes.length)] : center;
    return { x: node.x, z: node.z };
  }

  /** Тоглогчийн машин цагдаагийн машиныг мөргөсөн үү (тоглогч мөргөсөн тохиолдолд л хэрэг). */
  checkRams(dt, playerVehicle) {
    const a = boxOf(playerVehicle, this.boxA);
    for (const unit of this.units) {
      unit.ramCooldown = Math.max(0, unit.ramCooldown - dt);
      const vehicle = unit.vehicle;
      if (!vehicle || vehicle.disposed || vehicle === playerVehicle || unit.ramCooldown > 0) continue;
      const p = vehicle.currPosition;
      if (Math.abs(p.x - a.x) > 8 || Math.abs(p.z - a.z) > 8) continue;
      const b = boxOf(vehicle, this.boxB);
      if (!boxesOverlap(a, b, 0.15)) continue;
      // Хэн хэнийгээ мөргөв: тоглогч цагдаа руу чиглэн илүү хурдтай явж байсан бол л хэрэг
      const v = vehicle.body.linvel();
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ux = (b.x - a.x) / d;
      const uz = (b.z - a.z) / d;
      const playerApproach = this.playerVelocity.x * ux + this.playerVelocity.z * uz;
      const policeApproach = -(v.x * ux + v.z * uz);
      if (playerApproach < 3 || playerApproach < policeApproach) continue;
      unit.ramCooldown = 2.5;
      this.onCrime?.('policeRam');
    }
  }

  updateArrest(dt, level) {
    let close = false;
    let limit = ARREST_TIME.onFoot;
    if (level > 0 && !this.busted) {
      const p = this.playerPosition;
      const near = (position, range) => Math.hypot(position.x - p.x, position.z - p.z) < range;
      if (this.onFoot) {
        for (const unit of this.units) {
          for (const officer of unit.officers) if (officer.state === 'controlled' && near(officer.position, 1.25)) close = true;
        }
      } else if (Math.abs(this.playerVehicle.speed) < 1.5) {
        // Машинтай тоглогч зогсоход ойрхон цагдаагийн машин эсвэл цагдаа байвал
        limit = ARREST_TIME.inVehicle;
        for (const unit of this.units) {
          const v = unit.vehicle;
          if (unit.mode === 'pursue' && v && !v.disposed && v !== this.playerVehicle && near(v.currPosition, 7)) close = true;
          for (const officer of unit.officers) if (officer.state === 'controlled' && near(officer.position, 3)) close = true;
        }
      } else {
        limit = ARREST_TIME.inVehicle;
      }
    }
    this.arrest = close ? this.arrest + dt : Math.max(0, this.arrest - dt * 0.8);
    this.arrestFraction = Math.min(1, this.arrest / limit);
    if (this.arrest >= limit) {
      this.arrest = 0;
      this.arrestFraction = 0;
      this.onBusted?.();
    }
  }

  // ---------- Явган цагдаа ----------

  /** Pedestrians-ийн алхам бүрт (гаднаас удирддаг хүн). */
  stepOfficer(ped, dt) {
    const unit = ped.unit;
    const car = unit.vehicle && !unit.vehicle.disposed && unit.vehicle !== this.playerVehicle ? unit.vehicle : null;
    ped.speakTimer -= dt;
    if (this.wanted.level > 0 && this.reachableOnFoot() && !this.busted && unit.mode === 'pursue') {
      ped.officerState = 'chase';
      const p = this.playerPosition;
      // Машинтай тоглогчийн хаалганы дэргэд, явган тоглогчийн яг хажууд очно
      const stop = this.onFoot ? 0.85 : this.playerVehicle.def.size.width / 2 + 0.9;
      const distance = this.moveOfficer(ped, p.x, p.z, OFFICER_SPEED, stop, dt);
      if (distance < 4 && ped.speakTimer <= 0) {
        ped.speakTimer = 4;
        this.npc.say(ped.renderPosition, 1.95 * ped.scale + 0.25, 'officer');
      }
    } else if (car) {
      // Тоглогч машинд суусан эсвэл хайлт дууссан — машин руугаа буцна
      ped.officerState = 'return';
      const door = this.doorPosition(car, ped.door);
      if (this.moveOfficer(ped, door.x, door.z, 4.2, 0.5, dt) < 0.9) ped.returned = true;
    } else {
      ped.officerState = 'idle'; // Машингүй үлдсэн (хулгайлагдсан) — холдоход алга болно
      ped.stranded += dt;
    }
  }

  /** Цагдааг зорилт руу хөдөлгөнө: хана, машинд тулбал дагуу нь гулсана. Зорилт хүртэлх зайг буцаана. */
  moveOfficer(ped, tx, tz, speed, stopDistance, dt) {
    const p = ped.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-3) ped.yaw = Math.atan2(dx, dz);
    if (distance <= stopDistance) return distance;
    let mx = dx / distance;
    let mz = dz / distance;
    let step = Math.min(speed * dt, distance - stopDistance);
    const normal = this.castWall(p, mx, mz, step + 0.4);
    if (normal) {
      const dot = mx * normal.x + mz * normal.z;
      mx -= normal.x * dot;
      mz -= normal.z * dot;
      const length = Math.hypot(mx, mz);
      if (length < 0.2 || this.castWall(p, mx / length, mz / length, step + 0.4)) step = 0;
      else {
        mx /= length;
        mz /= length;
      }
    }
    p.x += mx * step;
    p.z += mz * step;
    p.y = this.city.surfaceY(p.x, p.z);
    return distance;
  }

  castWall(p, dx, dz, distance) {
    const ray = this.ray;
    ray.origin.x = p.x;
    ray.origin.y = p.y + 0.6;
    ray.origin.z = p.z;
    ray.dir.x = dx;
    ray.dir.y = 0;
    ray.dir.z = dz;
    const hit = this.physics.world.castRayAndGetNormal(ray, distance, true, undefined, this.wallGroups);
    return hit ? hit.normal : null;
  }

  /** Машины хаалганы дэргэдэх цэг: side 1 — зүүн (жолоочийн), −1 — баруун. */
  doorPosition(car, side) {
    const yaw = car.yaw;
    const offset = car.def.size.width / 2 + 0.7;
    // Машины зүүн тал = (cos yaw, −sin yaw)
    this.door.x = car.currPosition.x + Math.cos(yaw) * offset * side;
    this.door.z = car.currPosition.z - Math.sin(yaw) * offset * side;
    return this.door;
  }

  /** Явган тоглогчийн ойролцоо зогссон машинаас цагдаа бууж хөөнө. */
  /** Цагдаа явганаар хүрч болох уу: тоглогч явган, эсвэл машин нь бараг зогссон (гацсан, хашаанд г.м.). */
  reachableOnFoot() {
    return this.onFoot || Math.abs(this.playerVehicle.speed) < 3;
  }

  deployOfficers(level) {
    if (level === 0 || this.busted || !this.reachableOnFoot()) return;
    // Машинтай тоглогч хөдлөхгүй байвал — цагдаагийн машин ойртож чадаагүй үед л (хашаа, явган зам)
    const range = this.onFoot ? 26 : 32;
    for (const unit of this.units) {
      const vehicle = unit.vehicle;
      if (unit.mode !== 'pursue' || unit.deployed || !vehicle || vehicle.disposed || !vehicle.ai) continue;
      if (Math.abs(vehicle.speed) > 2 || unit.distance > range) continue;
      if (!this.onFoot && (unit.distance < 7.5 || Math.abs(this.playerVehicle.speed) > 1.5)) continue;
      // Машин хоосон үлдэнэ — тоглогч хулгайлж болно
      vehicle.hasDriver = false;
      vehicle.ai = false;
      unit.deployed = true;
      const count = level >= 3 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const side = i === 0 ? 1 : -1;
        const door = this.doorPosition(vehicle, side);
        const at = { x: door.x, y: this.city.surfaceY(door.x, door.z), z: door.z };
        const ped = this.npc.peds.spawnControlled(at, OFFICER_COLORS, this.officerController);
        ped.officer = true;
        ped.unit = unit;
        ped.door = side;
        ped.officerState = 'chase';
        ped.speakTimer = i * 1.5;
        ped.returned = false;
        ped.stranded = 0;
        unit.officers.push(ped);
      }
    }
  }

  /** Машиндаа буцаж суусан цагдааг арилгаж, машиныг дахин хөдөлгөнө. */
  collectOfficers() {
    for (const unit of this.units) {
      for (const officer of unit.officers) if (officer.returned && !officer.removed) this.npc.peds.remove(officer);
      if (unit.officers.some((officer) => officer.removed)) unit.officers = unit.officers.filter((officer) => !officer.removed);
      const vehicle = unit.vehicle;
      if (unit.deployed && unit.officers.length === 0 && vehicle && !vehicle.disposed) {
        unit.deployed = false;
        vehicle.hasDriver = true;
        vehicle.ai = true;
      }
    }
  }

  // ---------- Кадр бүр ----------

  /** @param {THREE.Vector3} cameraForward */
  update(dt, cameraForward) {
    const level = this.wanted.level;
    this.pruneUnits(cameraForward);
    this.updateSight(dt, level);
    this.wanted.update(dt, this.spotted, this.playerPosition);
    this.manageUnits(dt, this.wanted.level, cameraForward);
    this.deployOfficers(this.wanted.level);
    this.collectOfficers();
    this.detectRedLight();
    for (const unit of this.units) {
      const vehicle = unit.vehicle;
      if (vehicle && !vehicle.disposed && vehicle !== this.playerVehicle) vehicle.siren = unit.mode === 'pursue' && this.wanted.level > 0;
    }
  }

  pruneUnits(cameraForward) {
    const p = this.playerPosition;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const unit = this.units[i];
      if (unit.officers.some((officer) => officer.removed)) unit.officers = unit.officers.filter((officer) => !officer.removed);
      if (unit.vehicle?.disposed) unit.vehicle = null;
      const anchor = unit.vehicle?.currPosition ?? unit.officers[0]?.position;
      if (!anchor) {
        this.units.splice(i, 1);
        continue;
      }
      const dx = anchor.x - p.x;
      const dz = anchor.z - p.z;
      const distance = Math.hypot(dx, dz);
      const inView = distance > 1 && (dx * cameraForward.x + dz * cameraForward.z) / distance > 0.35;
      // Хайлтын үед сүүлд харагдсан газраас хэт холдсон машин л илүүдэл
      const reference = this.wanted.seen ? p : this.wanted.lastKnown;
      const fromReference = Math.hypot(anchor.x - reference.x, anchor.z - reference.z);
      const gone = unit.mode === 'leave' ? distance > 140 || (distance > 60 && !inView) : fromReference > 400;
      const stranded = !unit.vehicle && !inView && unit.officers.every((officer) => officer.stranded > 20 || distance > 60);
      if (gone || stranded) this.removeUnit(unit);
    }
  }

  removeUnit(unit) {
    for (const officer of unit.officers) if (!officer.removed) this.npc.peds.remove(officer);
    unit.officers.length = 0;
    const vehicle = unit.vehicle;
    if (vehicle && !vehicle.disposed && vehicle !== this.playerVehicle) this.vehicles.remove(vehicle);
    unit.vehicle = null;
    const index = this.units.indexOf(unit);
    if (index >= 0) this.units.splice(index, 1);
  }

  /** 5 удаа/сек: цагдаа тоглогчийг харж байна уу (барилгаар хаагдсан эсэхийг цацрагаар). */
  updateSight(dt, level) {
    this.sightTimer -= dt;
    if (this.sightTimer > 0) return;
    this.sightTimer = 0.2;
    const p = this.playerPosition;
    let spotted = false;
    for (const unit of this.units) {
      const anchor = unit.vehicle?.currPosition ?? unit.officers[0]?.position;
      if (!anchor) continue;
      unit.distance = Math.hypot(anchor.x - p.x, anchor.z - p.z);
      unit.seen = unit.distance < CLOSE_RANGE || (unit.distance < SIGHT_RANGE && this.lineOfSight(anchor, p));
      if (unit.seen && unit.mode === 'pursue') spotted = true;
    }
    // Замын хөдөлгөөн дэх эргүүл тоглогчийг харвал хөөцөлдөөнд нэгдэнэ
    if (level > 0) {
      for (const car of this.npc.cars.cars) {
        if (car.type !== 'police') continue;
        if (Math.hypot(car.position.x - p.x, car.position.z - p.z) > PATROL_SIGHT || !this.lineOfSight(car.position, p)) continue;
        spotted = true;
        if (this.pursuing() < UNITS_BY_LEVEL[level] + 1) this.convertPatrol(car);
        break;
      }
    }
    if (spotted) {
      for (const unit of this.units) {
        unit.searchPoint = null;
        unit.searchedLastKnown = false;
      }
    }
    this.spotted = spotted;
  }

  lineOfSight(from, to) {
    const ox = from.x;
    const oy = (from.y ?? 0) + 1.5;
    const oz = from.z;
    const dx = to.x - ox;
    const dy = to.y + 1.2 - oy;
    const dz = to.z - oz;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1) return true;
    const hit = this.physics.castRay({ x: ox, y: oy, z: oz }, { x: dx / distance, y: dy / distance, z: dz / distance }, distance, this.sightGroups);
    return hit === null || hit > distance - 0.6;
  }

  pursuing() {
    let count = 0;
    for (const unit of this.units) if (unit.mode === 'pursue') count++;
    return count;
  }

  /** Түвшинд тохирох тооны машин: дутвал нэмнэ, илүү бол хамгийн холыг буцаана. */
  manageUnits(dt, level, cameraForward) {
    if (level === 0) {
      for (const unit of this.units) if (unit.mode === 'pursue') this.sendAway(unit);
      this.spawnTimer = 0.6;
      return;
    }
    const desired = UNITS_BY_LEVEL[level];
    const active = this.units.filter((unit) => unit.mode === 'pursue');
    if (active.length > desired) {
      active.sort((a, b) => b.distance - a.distance);
      for (let i = 0; i < active.length - desired; i++) this.sendAway(active[i]);
    } else if (active.length < desired && !this.busted) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 2.2;
        this.spawnUnit(level, cameraForward);
      }
    }
  }

  /** Хайлт дууссан / илүүдэл машин: дуут дохиогоо унтрааж, тоглогчоос холдоно. */
  sendAway(unit) {
    unit.mode = 'leave';
    const anchor = unit.vehicle?.currPosition ?? unit.officers[0]?.position ?? this.playerPosition;
    const p = this.playerPosition;
    const dx = anchor.x - p.x;
    const dz = anchor.z - p.z;
    const length = Math.hypot(dx, dz) || 1;
    const node = this.graph.nodes[this.graph.nearestNode(anchor.x + (dx / length) * 250, anchor.z + (dz / length) * 250)];
    unit.leavePoint = { x: node.x, z: node.z };
  }

  spawnUnit(level, cameraForward) {
    const p = this.playerPosition;
    // Харагдаж байвал тоглогчийн ойролцоо; хайлтын үед сүүлд харагдсан газрын орчимд
    // (цагдаа тоглогчийн жинхэнэ байрлалыг "мэдэхгүй" — нуугдаж зугтах боломжтой)
    const seen = this.wanted.seen;
    const anchor = seen ? p : this.wanted.lastKnown;
    // 1) Ойрын эргүүл (замын хөдөлгөөнд явж буй) шууд хөөцөлдөнө
    let patrol = null;
    let best = 160;
    for (const car of this.npc.cars.cars) {
      if (car.type !== 'police') continue;
      const d = Math.hypot(car.position.x - anchor.x, car.position.z - anchor.z);
      if (d < best) {
        best = d;
        patrol = car;
      }
    }
    if (patrol) return this.convertPatrol(patrol);

    // 2) Камерт харагдахгүй, зорилт руу чиглэсэн эгнээнд
    const [min, max] = !seen ? [20, 120] : level >= 3 ? [60, 130] : [70, 140];
    const candidates = this.npc.network.lanes.filter((lane) => {
      const d = Math.hypot(lane.midpoint.x - anchor.x, lane.midpoint.z - anchor.z);
      return lane.length > 30 && d > min && d < max && Math.hypot(lane.midpoint.x - p.x, lane.midpoint.z - p.z) > 60;
    });
    for (let attempt = 0; attempt < 14 && candidates.length > 0; attempt++) {
      const lane = candidates[Math.floor(Math.random() * candidates.length)];
      lane.path.sample(lane.length * (0.3 + Math.random() * 0.4), point, direction);
      const dx = point.x - p.x;
      const dz = point.z - p.z;
      const d = Math.hypot(dx, dz);
      if (attempt < 8 && (dx * cameraForward.x + dz * cameraForward.z) / d > 0.3) continue;
      // Зорилтоос холдох чиглэлтэй эгнээг алгасна
      if (attempt < 10 && direction.x * (point.x - anchor.x) + direction.z * (point.z - anchor.z) > 0) continue;
      if (this.occupied(point.x, point.z, 7)) continue;
      const type = level >= 4 && Math.random() < 0.5 ? 'policeSuv' : 'police';
      return this.createUnit(type, point, Math.atan2(direction.x, direction.z));
    }
    return null;
  }

  occupied(x, z, radius) {
    let found = false;
    this.npc.hash.query(x, z, radius, (e) => {
      if (!found && Math.hypot(e.x - x, e.z - z) < radius) found = true;
    });
    return found;
  }

  /** Замын хөдөлгөөн дэх эргүүлийн машиныг физик цагдаагийн машин болгоно. */
  convertPatrol(car) {
    const speed = car.speed;
    const info = this.npc.cars.extract(car);
    const unit = this.createUnit('police', info.position, info.yaw);
    unit.vehicle.body.setLinvel({ x: info.heading.x * speed, y: 0, z: info.heading.z * speed }, true);
    return unit;
  }

  createUnit(type, position, yaw) {
    const vehicle = this.vehicles.spawn(type, { x: position.x, y: 0.05, z: position.z }, yaw, { persistent: false });
    vehicle.hasDriver = true;
    vehicle.ai = true;
    vehicle.siren = true;
    const unit = {
      id: this.nextId++,
      vehicle,
      driver: new AiDriver(vehicle, { graph: this.graph, hash: this.npc.hash, physics: this.physics }),
      officers: [],
      deployed: false,
      mode: 'pursue',
      seen: false,
      distance: Infinity,
      searchPoint: null,
      searchedLastKnown: false,
      leavePoint: null,
      ramCooldown: 0,
    };
    this.units.push(unit);
    return unit;
  }

  /** Тоглогч цагдаагийн нүдэн дээр улаан гэрлээр уулзварт орвол хэрэг болно. */
  detectRedLight() {
    const vehicle = this.playerVehicle;
    if (!vehicle) {
      this.lastSignalNode = null;
      return;
    }
    const p = vehicle.currPosition;
    let inside = null;
    for (const node of this.signalNodes) {
      if (Math.abs(p.x - node.x) < node.hx && Math.abs(p.z - node.z) < node.hz) {
        inside = node;
        break;
      }
    }
    const v = this.playerVelocity;
    if (inside && inside !== this.lastSignalNode && Math.hypot(v.x, v.z) > 4) {
      const axis = Math.abs(v.x) > Math.abs(v.z) ? 'x' : 'z';
      const signals = this.npc.signals;
      if (signals.state(inside.id, axis) === 'red' && !signals.isClearing(inside.id, axis) && this.policeWatching(p)) {
        this.onCrime?.('redLight');
      }
    }
    this.lastSignalNode = inside;
  }

  policeWatching(p) {
    const watching = (position) => Math.hypot(position.x - p.x, position.z - p.z) < PATROL_SIGHT && this.lineOfSight(position, p);
    for (const unit of this.units) {
      const v = unit.vehicle;
      if (v && !v.disposed && v !== this.playerVehicle && watching(v.currPosition)) return true;
    }
    for (const car of this.npc.cars.cars) if (car.type === 'police' && watching(car.position)) return true;
    return false;
  }

  // ---------- Game-ээс ----------

  /** Тоглогч цагдаагийн машинд суусан (хулгайлсан): нэгжээс салгана. */
  releaseVehicle(vehicle) {
    for (const unit of this.units) {
      if (unit.vehicle !== vehicle) continue;
      unit.vehicle = null;
      vehicle.siren = false;
      vehicle.ai = false;
    }
  }

  owns(vehicle) {
    return this.units.some((unit) => unit.vehicle === vehicle);
  }

  /** @param {boolean} immediate true — бүгдийг шууд арилгана (баривчлагдсаны дараа) */
  standDown(immediate) {
    if (immediate) while (this.units.length > 0) this.removeUnit(this.units[this.units.length - 1]);
    else for (const unit of this.units) this.sendAway(unit);
    this.arrest = 0;
    this.arrestFraction = 0;
  }

  /** Мини газрын зурагт: цагдаагийн машин, явган цагдаа. */
  blips() {
    const list = [];
    for (const unit of this.units) {
      const v = unit.vehicle;
      if (v && !v.disposed && v !== this.playerVehicle) list.push({ x: v.currPosition.x, z: v.currPosition.z, officer: false });
      for (const officer of unit.officers) list.push({ x: officer.position.x, z: officer.position.z, officer: true });
    }
    return list;
  }
}

/** Машины дээрээс харсан тэгш өнцөгт (boxesOverlap-д). */
function boxOf(vehicle, out) {
  const yaw = vehicle.yaw;
  out.x = vehicle.currPosition.x;
  out.z = vehicle.currPosition.z;
  out.hx = Math.sin(yaw);
  out.hz = Math.cos(yaw);
  out.halfLength = vehicle.def.size.length / 2;
  out.halfWidth = vehicle.def.size.width / 2;
  return out;
}
