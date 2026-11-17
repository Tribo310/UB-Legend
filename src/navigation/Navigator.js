// GPS: зорих цэг ба түүн рүү хүрэх маршрут. Тоглогч хөдлөхөд маршрутыг тогтмол шинэчилж,
// зорих цэгт хүрмэгц автоматаар арилгана. (Үе шат 6-д даалгаврын зорилт ч ийм байдлаар тэмдэглэгдэнэ.)
import { CONFIG } from '../core/config.js';

const RECALCULATE_SECONDS = 0.8;

export class Navigator {
  /** @param {import('./RoadGraph.js').RoadGraph} graph */
  constructor(graph) {
    this.graph = graph;
    /** @type {{x:number, z:number}|null} */
    this.waypoint = null;
    /** @type {{x:number, z:number}[]|null} */
    this.route = null;
    this.timer = 0;
  }

  setWaypoint(point, from) {
    this.waypoint = { x: point.x, z: point.z };
    this.route = this.graph.route(from, this.waypoint);
    this.timer = RECALCULATE_SECONDS;
  }

  clear() {
    this.waypoint = null;
    this.route = null;
  }

  /**
   * @param {{x:number, z:number}} position Тоглогч (эсвэл машин)
   * @returns {boolean} Зорих цэгт яг одоо хүрсэн эсэх
   */
  update(dt, position) {
    if (!this.waypoint) return false;
    if (Math.hypot(position.x - this.waypoint.x, position.z - this.waypoint.z) < CONFIG.map.arriveDistance) {
      this.clear();
      return true;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.route = this.graph.route(position, this.waypoint);
      this.timer = RECALCULATE_SECONDS;
    } else if (this.route) {
      this.route[0] = { x: position.x, z: position.z }; // Эхлэлийн цэгийг тоглогчийн байрлалтай уях
    }
    return false;
  }
}
