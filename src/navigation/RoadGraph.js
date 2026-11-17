// Замын граф ба маршрут хайлт (GPS). Уулзвар = зангилаа, замын хэсэг = ирмэг.
// A* алгоритмаар хамгийн богино (жинлэсэн) замыг олно: өргөн чөлөөг илүүд үзэж,
// шороон замаас аль болох зайлсхийнэ.

const WEIGHT = Object.freeze({ avenue: 0.85, street: 1, dirt: 1.35 });

export class RoadGraph {
  /** @param {ReturnType<import('../city/cityLayout.js').buildRoadNetwork>} network */
  constructor(network) {
    this.nodes = [];
    const indexOf = new Map();
    for (const node of network.nodes.values()) {
      indexOf.set(node, this.nodes.length);
      this.nodes.push({ x: node.x, z: node.z, neighbors: [] });
    }
    for (const edge of network.edges) {
      const a = indexOf.get(edge.a);
      const b = indexOf.get(edge.b);
      const cost = edge.length * (WEIGHT[edge.type] ?? 1);
      this.nodes[a].neighbors.push({ index: b, cost });
      this.nodes[b].neighbors.push({ index: a, cost });
    }
  }

  /** Цэгт хамгийн ойр уулзварын индекс. */
  nearestNode(x, z) {
    let best = -1;
    let bestDistance = Infinity;
    this.nodes.forEach((node, i) => {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * A* хайлт. Олдохгүй бол null.
   * @returns {number[]|null} Зангилааны индексүүд (эхлэлээс төгсгөл хүртэл)
   */
  findPath(start, goal) {
    const count = this.nodes.length;
    const cost = new Float64Array(count).fill(Infinity);
    const estimate = new Float64Array(count).fill(Infinity);
    const previous = new Int32Array(count).fill(-1);
    const closed = new Uint8Array(count);
    const open = new Set([start]);
    const heuristic = (i) => Math.hypot(this.nodes[i].x - this.nodes[goal].x, this.nodes[i].z - this.nodes[goal].z) * WEIGHT.avenue;
    cost[start] = 0;
    estimate[start] = heuristic(start);

    while (open.size > 0) {
      // ~170 зангилаа — энгийн шугаман хайлт хангалттай хурдан
      let current = -1;
      for (const i of open) if (current < 0 || estimate[i] < estimate[current]) current = i;
      if (current === goal) break;
      open.delete(current);
      closed[current] = 1;
      for (const { index, cost: step } of this.nodes[current].neighbors) {
        if (closed[index]) continue;
        const candidate = cost[current] + step;
        if (candidate < cost[index]) {
          cost[index] = candidate;
          estimate[index] = candidate + heuristic(index);
          previous[index] = current;
          open.add(index);
        }
      }
    }
    if (start !== goal && previous[goal] < 0) return null;
    const path = [goal];
    while (path[0] !== start) path.unshift(previous[path[0]]);
    return path;
  }

  /**
   * Хоёр цэгийн хоорондох маршрут (дэлхийн координатын цэгүүд).
   * @returns {{x:number, z:number}[]|null}
   */
  route(from, to) {
    const start = this.nearestNode(from.x, from.z);
    const goal = this.nearestNode(to.x, to.z);
    const path = this.findPath(start, goal);
    if (!path) return null;
    return [{ x: from.x, z: from.z }, ...path.map((i) => ({ x: this.nodes[i].x, z: this.nodes[i].z })), { x: to.x, z: to.z }];
  }
}
