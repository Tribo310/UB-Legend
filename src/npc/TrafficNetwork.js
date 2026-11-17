// Замын хөдөлгөөний сүлжээ (cityLayout-ийн замаас гаргана):
//  • Эгнээ (lane): замын хэсэг бүрт чиглэл тус бүр 1–2 эгнээ. Баруун гар талын хөдөлгөөн.
//  • Холбогч (connector): уулзвар дотуур эгнээнээс эгнээ рүү шулуун / баруун / зүүн эргэлтийн муруй,
//    тойрогт цагийн зүүний эсрэг (газрын зураг дээрээс харахад) тойрох нум.
//  • Уулзварын удирдлага: 'signal' (гэрлэн дохио), 'yield' (ээлжээр), 'roundabout', 'free'.
//  • Явган хүний сүлжээ: блок бүрийн явган замын 4 булан, тэдгээрийн хоорондох зам, гарц.
import { ROUNDABOUT, SIDEWALK, X_LINES, Z_LINES } from '../city/cityLayout.js';

/** Замын төвөөс эгнээний төв хүртэлх зай (явах чиглэлийн баруун тал руу). */
const LANE_OFFSETS = Object.freeze({ avenue: [2.75, 8.25], street: [3.0], dirt: [2.2] });
/** Хурдны хязгаар (м/с): өргөн чөлөө ≈ 54, гудамж ≈ 40, шороон зам ≈ 25 км/ц. */
const LANE_SPEED = Object.freeze({ avenue: 15, street: 11, dirt: 7 });
const TURN_SPEED = Object.freeze({ right: 5.5, left: 7.5, uturn: 4 });
const RING_RADIUS = (ROUNDABOUT.island + ROUNDABOUT.radius) / 2;
const RING_SPEED = 7;
const STOP_BEFORE_CROSSWALK = 4.8; // Гарцын өмнө зогсох зай (м)
const STOP_PLAIN = 1.2;
const WALK_INSET = Object.freeze({ paved: 2.2, dirt: 0.75 }); // Явган хүний зам хашлагаас хэр дотор
/** Хорооллоор явган хүний нягтрал (зах, төвд олон). */
const WALK_WEIGHT = Object.freeze({ market: 2.2, center: 1.5, square: 1.6, khoroolol: 1.0, park: 0.8, zaisan: 0.6, gerNorth: 0.5 });

/** Олон цэгт шугам: уртын дагуух байрлал, чиглэлийг авна. Цэг нь {x, z}. */
export class Path {
  constructor(points) {
    this.points = points;
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
  }

  /**
   * @param {number} s Эхнээс хэдэн метрт
   * @param {{x:number, z:number}} outPosition
   * @param {{x:number, z:number}} [outDirection] Нэгж вектор
   */
  sample(s, outPosition, outDirection) {
    const points = this.points;
    const distance = Math.min(Math.max(s, 0), this.length);
    let i = 1;
    while (i < points.length - 1 && this.cumulative[i] < distance) i++;
    const a = points[i - 1];
    const b = points[i];
    const segment = this.cumulative[i] - this.cumulative[i - 1] || 1;
    const t = (distance - this.cumulative[i - 1]) / segment;
    outPosition.x = a.x + (b.x - a.x) * t;
    outPosition.z = a.z + (b.z - a.z) * t;
    if (outDirection) {
      outDirection.x = (b.x - a.x) / segment;
      outDirection.z = (b.z - a.z) / segment;
    }
    return outPosition;
  }
}

/** Квадрат Безье муруйг цэгүүдээр дээжилнэ. */
function bezier(p0, p1, p2, steps = 10) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z });
  }
  return points;
}

function cubic(p0, p1, p2, p3, steps = 12) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z });
  }
  return points;
}

/** Уулзварын удирдлагын төрөл. */
function controlOf(node) {
  if (node.roundabout) return 'roundabout';
  if (node.edges.length <= 2) return 'free';
  if (node.widthNS > 0 && node.widthEW > 0 && node.edges.some((e) => e.type === 'avenue')) return 'signal';
  return 'yield';
}

export class TrafficNetwork {
  /** @param {ReturnType<import('../city/cityLayout.js').buildRoadNetwork>} network */
  constructor(network) {
    /** @type {Map<string, object>} */
    this.nodes = new Map();
    for (const node of network.nodes.values()) {
      const paved = node.edges.some((e) => e.type !== 'dirt');
      this.nodes.set(node.id, {
        id: node.id,
        x: node.x,
        z: node.z,
        net: node,
        control: controlOf(node),
        crosswalk: paved && node.edges.length >= 3 && !node.roundabout,
        reservedBy: null,
        reservedTime: 0,
        inside: new Set(), // Яг одоо уулзвар дотор (холбогч дээр) яваа машинууд
        lanesIn: [],
        lanesOut: [],
      });
    }
    this.lanes = [];
    this.connectors = [];
    this.buildLanes(network);
    this.buildConnectors();
    this.buildSidewalks(network.blocks);
  }

  buildLanes(network) {
    for (const edge of network.edges) {
      const offsets = LANE_OFFSETS[edge.type];
      const r = edge.rect;
      if (r.maxX - r.minX < 0.5 || r.maxZ - r.minZ < 0.5) continue;
      const alongX = edge.axis === 'x';
      const [low, high] = alongX ? (edge.a.x < edge.b.x ? [edge.a, edge.b] : [edge.b, edge.a]) : edge.a.z < edge.b.z ? [edge.a, edge.b] : [edge.b, edge.a];
      for (const dir of [1, -1]) {
        const fromNet = dir > 0 ? low : high;
        const toNet = dir > 0 ? high : low;
        const heading = alongX ? { x: dir, z: 0 } : { x: 0, z: dir };
        const right = { x: -heading.z, z: heading.x };
        const start = alongX ? { x: dir > 0 ? r.minX : r.maxX, z: low.z } : { x: low.x, z: dir > 0 ? r.minZ : r.maxZ };
        const end = alongX ? { x: dir > 0 ? r.maxX : r.minX, z: low.z } : { x: low.x, z: dir > 0 ? r.maxZ : r.minZ };
        const from = this.nodes.get(fromNet.id);
        const to = this.nodes.get(toNet.id);
        offsets.forEach((offset, index) => {
          const path = new Path([
            { x: start.x + right.x * offset, z: start.z + right.z * offset },
            { x: end.x + right.x * offset, z: end.z + right.z * offset },
          ]);
          let stop = 0;
          if (to.control === 'roundabout') stop = 1;
          else if (to.control !== 'free') stop = to.crosswalk ? STOP_BEFORE_CROSSWALK : STOP_PLAIN;
          const lane = {
            kind: 'lane',
            id: this.lanes.length,
            edge,
            type: edge.type,
            axis: edge.axis,
            from,
            to,
            index,
            laneCount: offsets.length,
            heading,
            right,
            path,
            length: path.length,
            speed: LANE_SPEED[edge.type],
            stopS: Math.max(0, path.length - stop),
            cars: [],
            connectors: [],
            midpoint: { x: (path.points[0].x + path.points[1].x) / 2, z: (path.points[0].z + path.points[1].z) / 2 },
          };
          this.lanes.push(lane);
          from.lanesOut.push(lane);
          to.lanesIn.push(lane);
        });
      }
    }
  }

  buildConnectors() {
    for (const lane of this.lanes) {
      const node = lane.to;
      if (node.control === 'roundabout') this.buildRingConnectors(lane, node);
      else this.buildTurnConnectors(lane, node);
      if (lane.connectors.length === 0) this.buildUTurn(lane, node);
    }
  }

  addConnector(from, to, node, turn, points, speed, ring = null) {
    const path = new Path(points);
    const connector = { kind: 'connector', id: this.connectors.length, from, to, node, turn, path, length: path.length, speed, ring };
    this.connectors.push(connector);
    from.connectors.push(connector);
    return connector;
  }

  /** Энгийн уулзвар: шулуун, баруун (давчуу), зүүн (өргөн) эргэлт. Олон эгнээтэй замд эгнээний дүрэмтэй. */
  buildTurnConnectors(lane, node) {
    for (const out of node.lanesOut) {
      if (out.edge === lane.edge) continue; // Уулзвар дээр эргэж буцахгүй
      const dot = out.heading.x * lane.right.x + out.heading.z * lane.right.z;
      const turn = dot > 0.5 ? 'right' : dot < -0.5 ? 'left' : 'straight';
      if (lane.laneCount > 1) {
        // Баруун эргэлт — зөвхөн баруун (гадна) эгнээнээс, зүүн эргэлт — зөвхөн зүүн (дотор) эгнээнээс
        if (turn === 'right' && lane.index !== lane.laneCount - 1) continue;
        if (turn === 'left' && lane.index !== 0) continue;
      }
      const target = turn === 'right' ? out.laneCount - 1 : turn === 'left' ? 0 : Math.min(lane.index, out.laneCount - 1);
      if (out.index !== target) continue;
      const p0 = lane.path.points[1];
      const p2 = out.path.points[0];
      let points;
      if (turn === 'straight') points = [p0, p2];
      else {
        const p1 = lane.heading.x !== 0 ? { x: p2.x, z: p0.z } : { x: p0.x, z: p2.z };
        points = bezier(p0, p1, p2, 10);
      }
      this.addConnector(lane, out, node, turn, points, turn === 'straight' ? Math.min(lane.speed, out.speed) : TURN_SPEED[turn]);
    }
  }

  /** Тойрог: орох → цагираг дагуу (φ буурах чиглэлд, газрын зураг дээр цагийн зүүний эсрэг) → гарах. */
  buildRingConnectors(lane, node) {
    const { x: cx, z: cz } = node;
    const p0 = lane.path.points[1];
    const phiIn = Math.atan2(p0.z - cz, p0.x - cx) - 0.32;
    for (const out of node.lanesOut) {
      if (out.edge === lane.edge) continue;
      if (out.index !== Math.min(lane.index, out.laneCount - 1)) continue;
      const p2 = out.path.points[0];
      let phiOut = Math.atan2(p2.z - cz, p2.x - cx) + 0.32;
      while (phiOut > phiIn - 0.3) phiOut -= Math.PI * 2;
      const points = [p0];
      for (let phi = phiIn; phi > phiOut; phi -= 0.14) points.push({ x: cx + Math.cos(phi) * RING_RADIUS, z: cz + Math.sin(phi) * RING_RADIUS });
      points.push({ x: cx + Math.cos(phiOut) * RING_RADIUS, z: cz + Math.sin(phiOut) * RING_RADIUS }, p2);
      this.addConnector(lane, out, node, 'ring', points, RING_SPEED, { phiIn, phiOut, cx, cz });
    }
  }

  /** Мухар зам (эсвэл өөр сонголтгүй) үед эсрэг эгнээ рүү эргэж буцна. */
  buildUTurn(lane, node) {
    const out = node.lanesOut.find((candidate) => candidate.edge === lane.edge && candidate.index === 0);
    if (!out) return;
    const p0 = lane.path.points[1];
    const p3 = out.path.points[0];
    const h = lane.heading;
    const points = cubic(p0, { x: p0.x + h.x * 7, z: p0.z + h.z * 7 }, { x: p3.x + h.x * 7, z: p3.z + h.z * 7 }, p3);
    this.addConnector(lane, out, node, 'uturn', points, TURN_SPEED.uturn);
  }

  // ---------- Явган хүний сүлжээ ----------

  buildSidewalks(blocks) {
    /** @type {{id:number, x:number, z:number, y:number, edges:object[]}[]} */
    this.walkNodes = [];
    /** @type {object[]} */
    this.walkEdges = [];
    const cells = new Map();
    const cellIndex = (lines, value) => lines.findIndex((line, k) => k + 1 < lines.length && value > line && value < lines[k + 1]);
    const addNode = (x, z, y) => {
      const node = { id: this.walkNodes.length, x, z, y, edges: [] };
      this.walkNodes.push(node);
      return node;
    };
    const addEdge = (a, b, props) => {
      const edge = { a, b, length: Math.hypot(b.x - a.x, b.z - a.z), ...props };
      a.edges.push(edge);
      b.edges.push(edge);
      this.walkEdges.push(edge);
      return edge;
    };

    for (const block of blocks) {
      const r = block.rect;
      const inset = block.paved ? WALK_INSET.paved : WALK_INSET.dirt;
      const y = block.paved ? SIDEWALK.height : 0;
      const corners = {
        nw: addNode(r.minX + inset, r.minZ + inset, y),
        ne: addNode(r.maxX - inset, r.minZ + inset, y),
        se: addNode(r.maxX - inset, r.maxZ - inset, y),
        sw: addNode(r.minX + inset, r.maxZ - inset, y),
      };
      const weight = WALK_WEIGHT[block.kind] ?? 1;
      const lateral = block.paved ? 0.8 : 0.25;
      for (const [a, b] of [['nw', 'ne'], ['ne', 'se'], ['se', 'sw'], ['sw', 'nw']]) {
        addEdge(corners[a], corners[b], { kind: 'walk', y, weight, lateral, block });
      }
      cells.set(`${cellIndex(X_LINES, block.cx)},${cellIndex(Z_LINES, block.cz)}`, { block, corners, inset, y });
    }

    // Гарц: хөрш хоёр блокийн булангуудыг замын дээгүүр холбоно (уулзварын дэргэдэх гарцаар)
    const crossing = (a, b, nodeX, nodeZ, roadAxis, insetA, insetB, yA, yB) => {
      addEdge(a.node, b.node, { kind: 'cross', nodeId: `${nodeX},${nodeZ}`, roadAxis, insetA, insetB, yA, yB, weight: 1, lateral: 0.35 });
    };
    for (const [key, cell] of cells) {
      const [i, j] = key.split(',').map(Number);
      const east = cells.get(`${i + 1},${j}`);
      if (east) {
        const x = X_LINES[i + 1];
        crossing({ node: cell.corners.ne }, { node: east.corners.nw }, x, Z_LINES[j], 'z', cell.inset, east.inset, cell.y, east.y);
        crossing({ node: cell.corners.se }, { node: east.corners.sw }, x, Z_LINES[j + 1], 'z', cell.inset, east.inset, cell.y, east.y);
      }
      const south = cells.get(`${i},${j + 1}`);
      if (south) {
        const z = Z_LINES[j + 1];
        crossing({ node: cell.corners.sw }, { node: south.corners.nw }, X_LINES[i], z, 'x', cell.inset, south.inset, cell.y, south.y);
        crossing({ node: cell.corners.se }, { node: south.corners.ne }, X_LINES[i + 1], z, 'x', cell.inset, south.inset, cell.y, south.y);
      }
    }
  }
}
