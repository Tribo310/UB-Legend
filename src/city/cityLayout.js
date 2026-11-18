// Хотын зохион байгуулалт — Улаанбаатараас санаа авсан, хялбаршуулсан ОРИГИНАЛ хот.
// Энэ файл зөвхөн ӨГӨГДӨЛ агуулна: гудамжны тор, өргөн чөлөө, хороолол, гол, гүүр, тойрог.
// 3D хот (CityBuilder), газрын зураг (Minimap), GPS (RoadGraph) бүгд эндээс уншдаг тул
// нэг газар өөрчлөхөд бүгд зэрэг шинэчлэгдэнэ.
//
// Чиглэл: −Z = хойд, +Z = өмнөд, +X = зүүн, −X = баруун. Нэгж: метр.
//
//            Хойд толгой (гэр хороолол, шороон зам)
//   ┌──────────────┬──────────────────┬──────────────┐
//   │   Их зах     │  Төв (шилэн      │    Зүүн      │
//   │  (лангуу)    │  барилга, талбай)│  хороолол    │
//   └──────────────┴──────────────────┴──────────────┘
//   ═══════════════  Гол  (3 гүүр) ════════════════════
//                   Цагаан толгой        Сургалтын талбай

/** Хойдоос урагш (−Z → +Z) хөндлөн (зүүн-баруун) гудамжууд. 300 ба 480 нь голын хоёр эргийн зам. */
export const Z_LINES = [-780, -660, -540, -420, -300, -180, -60, 60, 180, 300, 480, 600, 720];
/** Баруунаас зүүн (−X → +X) босоо (хойд-өмнө) гудамжууд. */
export const X_LINES = [-780, -660, -540, -420, -300, -180, -60, 60, 180, 300, 420, 540, 660, 780];

export const AVENUE_Z = 60; // Төв өргөн чөлөө (зүүн-баруун) — троллейбус явдаг
export const AVENUE_X = 60; // Хойд-өмнө чиглэлийн өргөн чөлөө — төв гүүрээр голыг гатална
export const GER_EDGE_Z = -300; // Үүнээс хойш гэр хороолол (шороон зам)
export const SOUTH_EDGE = 300; // Цагаан толгойн гудамжууд |x| ≤ 300

/** Замын төрөл → өргөн (м). */
export const ROAD_WIDTH = Object.freeze({ avenue: 22, street: 14, dirt: 9 });
/** Явган хүний зам (блокийн ирмэгээс) ба хашлагын өндөр. */
export const SIDEWALK = Object.freeze({ width: 4, height: 0.15 });

/** Гол: усны хоёр эрэг (z). Хоёр эргийн хооронд гүүрээр л гарна. */
export const RIVER = Object.freeze({ north: 350, south: 420, waterY: -0.7 });
/** Голыг гатлах гүүрүүд (x). */
export const BRIDGES = Object.freeze([-300, AVENUE_X, 420]);
/** Төв өргөн чөлөөн дээрх тойрог. */
export const ROUNDABOUT = Object.freeze({ x: 420, z: AVENUE_Z, radius: 24, island: 11 });

/** Сургалтын талбай (Үе шат 1–2-ын туршилтын талбай) — хотын зах, голын урд. */
export const TRAINING_ORIGIN = Object.freeze({ x: 560, z: 560 });

/** Хорооллууд — газрын зураг дээрх нэр, өнгө. */
export const DISTRICTS = Object.freeze([
  { id: 'center', labelKey: 'districts.center', rect: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, tint: '#d9d3c7' },
  { id: 'market', labelKey: 'districts.market', rect: { minX: -780, maxX: -300, minZ: -300, maxZ: 300 }, tint: '#e3cfb2' },
  { id: 'khoroolol', labelKey: 'districts.khoroolol', rect: { minX: 300, maxX: 780, minZ: -300, maxZ: 300 }, tint: '#cdd3d9' },
  { id: 'gerNorth', labelKey: 'districts.gerNorth', rect: { minX: -780, maxX: 780, minZ: -780, maxZ: -300 }, tint: '#d6c9a8' },
  { id: 'zaisan', labelKey: 'districts.zaisan', rect: { minX: -300, maxX: 300, minZ: 420, maxZ: 720 }, tint: '#dfe3d6' },
  { id: 'riverside', labelKey: 'districts.riverside', rect: { minX: -780, maxX: 780, minZ: 300, maxZ: 480 }, tint: '#c9dcb8' },
]);

/** Цэг аль хороололд хамаарах вэ (барилгын хэв маягийг сонгоход). */
export function districtAt(x, z) {
  if (z > RIVER.south) return Math.abs(x) <= SOUTH_EDGE ? 'zaisan' : 'riverside';
  if (z >= SOUTH_EDGE) return 'riverside';
  if (z < GER_EDGE_Z) return 'gerNorth';
  if (x < -300) return 'market';
  if (x > 300) return 'khoroolol';
  return 'center';
}

/** Замын хэсгийн төрөл: өргөн чөлөө, гудамж эсвэл (гэр хороололд) шороон зам. */
function roadType(x1, z1, x2, z2) {
  if (z1 === z2 && z1 === AVENUE_Z) return 'avenue';
  if (x1 === x2 && x1 === AVENUE_X) return 'avenue';
  if ((z1 + z2) / 2 < GER_EDGE_Z) return 'dirt';
  return 'street';
}

const nodeKey = (x, z) => `${x},${z}`;

/**
 * Замын сүлжээ ба блокуудыг үүсгэнэ.
 * @returns {{
 *   nodes: Map<string, {id:string, x:number, z:number, widthNS:number, widthEW:number, roundabout:boolean, edges:object[]}>,
 *   edges: {a:object, b:object, type:string, width:number, length:number, axis:'x'|'z', bridge:boolean, rect:{minX:number,maxX:number,minZ:number,maxZ:number}}[],
 *   blocks: {rect:{minX:number,maxX:number,minZ:number,maxZ:number}, cx:number, cz:number, district:string, kind:string, paved:boolean}[]
 * }}
 */
export function buildRoadNetwork() {
  const nodes = new Map();
  const edges = [];
  const getNode = (x, z) => {
    const key = nodeKey(x, z);
    let node = nodes.get(key);
    if (!node) {
      node = { id: key, x, z, widthNS: 0, widthEW: 0, roundabout: x === ROUNDABOUT.x && z === ROUNDABOUT.z, edges: [] };
      nodes.set(key, node);
    }
    return node;
  };
  const connect = (x1, z1, x2, z2) => {
    const type = roadType(x1, z1, x2, z2);
    const a = getNode(x1, z1);
    const b = getNode(x2, z2);
    const axis = z1 === z2 ? 'x' : 'z'; // Аль тэнхлэгийн дагуу явах вэ
    const edge = {
      a,
      b,
      type,
      width: ROAD_WIDTH[type],
      length: Math.hypot(x2 - x1, z2 - z1),
      axis,
      bridge: axis === 'z' && Math.min(z1, z2) < RIVER.north && Math.max(z1, z2) > RIVER.south,
      rect: null,
    };
    edges.push(edge);
    a.edges.push(edge);
    b.edges.push(edge);
    if (axis === 'x') {
      a.widthEW = Math.max(a.widthEW, edge.width);
      b.widthEW = Math.max(b.widthEW, edge.width);
    } else {
      a.widthNS = Math.max(a.widthNS, edge.width);
      b.widthNS = Math.max(b.widthNS, edge.width);
    }
  };

  // Зүүн-баруун гудамжууд
  for (const z of Z_LINES) {
    const inSouth = z > RIVER.south && z !== 480;
    const xs = X_LINES.filter((x) => !inSouth || Math.abs(x) <= SOUTH_EDGE);
    for (let i = 0; i + 1 < xs.length; i++) connect(xs[i], z, xs[i + 1], z);
  }
  // Хойд-өмнө гудамжууд
  for (const x of X_LINES) {
    const zs = Z_LINES.filter((z) => {
      if (z <= SOUTH_EDGE) return true; // Голын хойд тал — бүх гудамж
      if (!BRIDGES.includes(x) && Math.abs(x) > SOUTH_EDGE) return false;
      return true;
    });
    for (let i = 0; i + 1 < zs.length; i++) {
      const z1 = zs[i];
      const z2 = zs[i + 1];
      const crossesRiver = z1 <= SOUTH_EDGE && z2 > RIVER.south;
      if (crossesRiver && !BRIDGES.includes(x)) continue; // Гүүргүй бол голоор таслагдана
      if (z1 > RIVER.south && Math.abs(x) > SOUTH_EDGE) continue;
      connect(x, z1, x, z2);
    }
  }

  // Замын тэгш өнцөгт: уулзварын талбайгаас уулзвар хүртэл (давхцахгүй — z-fighting үгүй)
  const endInset = (node, axis) => {
    if (node.roundabout) return ROUNDABOUT.radius;
    return (axis === 'x' ? node.widthNS : node.widthEW) / 2;
  };
  for (const edge of edges) {
    const { a, b, width } = edge;
    if (edge.axis === 'x') {
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      edge.rect = { minX: left.x + endInset(left, 'x'), maxX: right.x - endInset(right, 'x'), minZ: a.z - width / 2, maxZ: a.z + width / 2 };
    } else {
      const [top, bottom] = a.z < b.z ? [a, b] : [b, a];
      edge.rect = { minX: a.x - width / 2, maxX: a.x + width / 2, minZ: top.z + endInset(top, 'z'), maxZ: bottom.z - endInset(bottom, 'z') };
    }
  }

  // Блокууд: дөрвөн талаараа замаар хүрээлэгдсэн нүд
  const edgeBetween = (x1, z1, x2, z2) => {
    const a = nodes.get(nodeKey(x1, z1));
    return a?.edges.find((e) => (e.a === a ? e.b : e.a) === nodes.get(nodeKey(x2, z2))) ?? null;
  };
  const blocks = [];
  for (let i = 0; i + 1 < X_LINES.length; i++) {
    for (let j = 0; j + 1 < Z_LINES.length; j++) {
      const [x1, x2, z1, z2] = [X_LINES[i], X_LINES[i + 1], Z_LINES[j], Z_LINES[j + 1]];
      const north = edgeBetween(x1, z1, x2, z1);
      const south = edgeBetween(x1, z2, x2, z2);
      const west = edgeBetween(x1, z1, x1, z2);
      const east = edgeBetween(x2, z1, x2, z2);
      if (!north || !south || !west || !east || west.bridge) continue;
      const rect = {
        minX: x1 + west.width / 2,
        maxX: x2 - east.width / 2,
        minZ: z1 + north.width / 2,
        maxZ: z2 - south.width / 2,
      };
      // Тойргийн дэргэдэх блокийн буланг тойргоос холдуулна (булан нь цагираг замд орохгүй)
      const clearance = ROUNDABOUT.radius * 0.75;
      for (const [nx, nz] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
        if (nx !== ROUNDABOUT.x || nz !== ROUNDABOUT.z) continue;
        if (nx === x1) rect.minX = Math.max(rect.minX, nx + clearance);
        else rect.maxX = Math.min(rect.maxX, nx - clearance);
        if (nz === z1) rect.minZ = Math.max(rect.minZ, nz + clearance);
        else rect.maxZ = Math.min(rect.maxZ, nz - clearance);
      }
      const cx = (x1 + x2) / 2;
      const cz = (z1 + z2) / 2;
      const district = districtAt(cx, cz);
      blocks.push({ rect, cx, cz, district, kind: blockKind(district, cx, cz), paved: district !== 'gerNorth' });
    }
  }
  return { nodes, edges, blocks };
}

/** Блокийн зориулалт: хороололоос гадна тусгай блокууд (төв талбай, голын эргийн цэцэрлэг). */
function blockKind(district, cx, cz) {
  if (cx === 0 && cz === 0) return 'square';
  if (district === 'center' && cz > 180) return 'park';
  return district;
}

/** Тоглогч эхлэх цэг — төв талбайн өмнөд хэсэг, Засгийн газрын ордон руу (хойд зүг) харсан. */
export const PLAYER_SPAWN = Object.freeze({ position: { x: 0, y: 0.35, z: 32 }, facing: Math.PI });

/**
 * Цагдаагийн хэлтэс — баривчлагдсаны дараа тоглогч энд суллагдана (Үе шат 5).
 * Төв өргөн чөлөөний урд талын явган зам, өргөн чөлөө рүү (хойд зүг) харсан.
 */
export const POLICE_STATION = Object.freeze({ position: { x: -120, y: 0.35, z: 73.5 }, facing: Math.PI });

/**
 * Хот дахь машины зогсоол: төв талбайн баруун гудамжны хашлагын дэргэд (хөдөлгөөний эгнээг
 * хаахгүй — эгнээний төв нь −57, машин −54.4), хойд зүг рүү харсан.
 */
export const CITY_VEHICLE_SPAWNS = Object.freeze([
  { type: 'hybrid', position: { x: -54.4, y: 0.05, z: 34 }, yaw: Math.PI },
]);
