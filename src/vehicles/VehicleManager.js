// Тоглогчийн жолоодож болох (физиктэй) машинуудыг удирдана: үүсгэх, физик алхам, дүрслэл,
// ойрын машин хайх, орхигдсон машиныг устгах. (Замын хөдөлгөөний NPC машинууд — npc/TrafficCars.js.)
import { Vehicle } from './Vehicle.js';

export class VehicleManager {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    /** @type {Vehicle[]} */
    this.vehicles = [];
  }

  /**
   * @param {string} typeId
   * @param {{x:number,y:number,z:number}} position Зогсоолын цэг (газрын түвшин)
   * @param {number} yaw Харах чиглэл (радиан)
   * @param {{color?: number, persistent?: boolean}} [options]
   */
  spawn(typeId, position, yaw, options) {
    const vehicle = new Vehicle(this.scene, this.physics, typeId, { position, yaw }, options);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  remove(vehicle) {
    const index = this.vehicles.indexOf(vehicle);
    if (index < 0) return;
    this.vehicles.splice(index, 1);
    vehicle.dispose();
  }

  /** Тоглогчоос хол орхигдсон түр машинуудыг (persistent = false) устгана. */
  cullAbandoned(focus, maxDistance) {
    for (const vehicle of [...this.vehicles]) {
      if (vehicle.persistent || vehicle.hasDriver) continue;
      const p = vehicle.currPosition;
      if (Math.hypot(p.x - focus.x, p.z - focus.z) > maxDistance) this.remove(vehicle);
    }
  }

  /** world.step()-ээс өмнө. */
  fixedUpdate(dt) {
    for (const vehicle of this.vehicles) vehicle.fixedUpdate(dt);
  }

  /** world.step()-ийн дараа. */
  afterStep() {
    for (const vehicle of this.vehicles) vehicle.captureState();
  }

  updateVisual(dt, alpha) {
    for (const vehicle of this.vehicles) vehicle.updateVisual(dt, alpha);
  }

  /**
   * Тоглогчийн ойролцоо, суугаад явж болох машиныг олно.
   * @param {{x:number,y:number,z:number}} position Тоглогчийн хөлийн байрлал
   */
  findEnterable(position, maxDistance, maxSpeed) {
    let best = null;
    let bestDistance = maxDistance;
    for (const vehicle of this.vehicles) {
      if (vehicle.hasDriver || Math.abs(vehicle.speed) > maxSpeed) continue;
      const p = vehicle.currPosition;
      if (Math.abs(p.y - position.y) > 2.5) continue;
      const distance = Math.hypot(p.x - position.x, p.z - position.z);
      if (distance < bestDistance) {
        best = vehicle;
        bestDistance = distance;
      }
    }
    return best;
  }
}
