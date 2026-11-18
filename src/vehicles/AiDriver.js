// Компьютер жолооч (AI) — цагдаа, даалгаврын машин: физиктэй машиныг (Vehicle) тоглогчийн адил оролтоор
// (хурдасгуур, тоормос, жолоо) удирдана:
//   • Хол эсвэл барилгын цаана бол замын графаар (A*) маршрут гаргаж, "pure pursuit" аргаар
//     (маршрутын урд талын цэг рүү) жолоодно; эргэлтийн өмнө хурдаа хасна.
//   • Ойрхон бөгөөд харагдаж байвал тоглогч руу шууд (хөдөлгөөнийг нь урьдчилан тооцож) явна —
//     машинтай бол мөргөж зогсооно, явган бол хажууд нь зогсоно.
//   • Маршрутаар явахдаа замын баруун талаар (эгнээгээр) явна.
//   • Урд нь машин, хүн байвал зүүн талаар нь гүйцэж түрүүлнэ; боломжгүй бол араас нь удаашрна.
//   • Хана, хашаа, шон зэргийг "сахал" цацрагаар (урагш, хоёр тийш) мэдэрч холдоно; гацвал ухарна.
import { collisionGroups, GROUP } from '../core/Physics.js';
import { clamp, damp } from '../core/utils.js';

const ROUTE_REFRESH = 1.2; // Маршрутыг хэдэн секунд тутамд шинэчлэх
const CORNER_DECEL = 6; // Эргэлтийн өмнө тоормослох хурдатгал (м/с²)
const RIGHT_LANE = 2.2; // Замын төвөөс баруун тийш (эсрэг урсгалтай мөргөлдөхгүй)
const WHISKER_ANGLE = 0.45; // Хажуугийн "сахал" цацрагийн өнцөг (радиан)
const WALL_GROUPS = collisionGroups(GROUP.VEHICLE, GROUP.WORLD | GROUP.PROP);
const aim = { x: 0, z: 0 };
const origin = { x: 0, y: 0.7, z: 0 };
const rayDirection = { x: 0, y: 0, z: 0 };

export class AiDriver {
  /**
   * @param {import('../vehicles/Vehicle.js').Vehicle} vehicle
   * @param {{graph: import('../navigation/RoadGraph.js').RoadGraph, hash: import('../npc/SpatialHash.js').SpatialHash,
   *          physics: import('../core/Physics.js').Physics}} options
   */
  constructor(vehicle, { graph, hash, physics }) {
    this.vehicle = vehicle;
    this.graph = graph;
    this.hash = hash;
    this.physics = physics;
    this.blockGap = Infinity; // Урд замыг хаасан саад хүртэлх зай
    this.blockSpeed = 0;
    this.blockLateral = 0; // Саад машины тэнхлэгээс аль талд (+ баруун)
    this.waitTime = 0; // Саадын ард хэр удаан зогсож байна
    this.squeeze = 0; // > 0 бол саадын хажуугаар "шахаж" гарна (гацалтаас гарах)
    this.route = null;
    this.routeIndex = 1;
    this.routeTimer = Math.random() * ROUTE_REFRESH; // Машин бүр өөр үед (ачаалал тэгш)
    this.routeGoal = { x: 0, z: 0 };
    this.maxSpeed = 24;
    this.aggressive = false; // 3+ од: мөргөнө, гар тоормосоор эргэнэ
    this.avoidOffset = 0;
    this.reverseTimer = 0;
    this.stuckTimer = 0;
    this.lastSteer = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  }

  /** Зогсоох (явган цагдаа гарсан, баривчилж байна г.м.). */
  hold() {
    this.input.throttle = 0;
    this.input.brake = Math.abs(this.vehicle.speed) > 0.6 ? 1 : 0;
    this.input.steer = 0;
    this.input.handbrake = true;
    this.vehicle.setDriverInput(this.input);
  }

  /**
   * Тогтмол алхам: зорилт руу явах оролтыг тооцоолно.
   * @param {{x:number, z:number, vx:number, vz:number, speed:number, direct:boolean, stop:boolean, ignore:object|null}} goal
   *   direct — шууд харагдаж байгаа (маршрутгүй явна), stop — хажууд нь зогсох (явган тоглогч),
   *   ignore — тойрохгүй объект (мөргөх гэж буй тоглогчийн машин)
   */
  drive(dt, goal) {
    const vehicle = this.vehicle;
    const speed = vehicle.speed;
    if (this.reverseTimer > 0) {
      // Гацсан: эсрэг тийш жолоодож ухарна
      this.reverseTimer -= dt;
      this.setInput(0, 1, -this.lastSteer, false);
      return;
    }

    const p = vehicle.currPosition;
    const yaw = vehicle.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -fz; // Баруун тал
    const rz = fx;
    const distance = Math.hypot(goal.x - p.x, goal.z - p.z);
    let desired = this.maxSpeed;

    if (goal.direct) {
      // Тоглогч хаашаа явж байгааг урьдчилан тооцно (ойртох тусам бага)
      const lead = clamp(distance / Math.max(Math.abs(speed), 8), 0, 1);
      aim.x = goal.x + goal.vx * lead;
      aim.z = goal.z + goal.vz * lead;
      this.route = null;
      // Зогсож буй тоглогчийг түлхэхгүй — хажууд нь зогсож хаана (явган бол ≈7 м, машин бол ≈5 м-т)
      if (goal.stop) desired = Math.min(desired, stopSpeed(distance, 7));
      else if (goal.speed < 2.5) desired = Math.min(desired, stopSpeed(distance, 5));
      else if (distance < 22) desired = Math.min(desired, goal.speed + (this.aggressive ? 8 : 4));
    } else {
      this.routeTimer -= dt;
      const moved = Math.hypot(goal.x - this.routeGoal.x, goal.z - this.routeGoal.z) > 25;
      if (!this.route || this.routeTimer <= 0 || moved) this.planRoute(p, goal);
      if (this.route) {
        this.followRoute(p, clamp(4 + Math.abs(speed) * 0.55, 5, 22), RIGHT_LANE); // Бага хурдад ойрын цэг — булан "тасдахгүй"
        desired = Math.min(desired, this.cornerSpeed(p));
      } else {
        aim.x = goal.x;
        aim.z = goal.z;
      }
      if (goal.stop) desired = Math.min(desired, stopSpeed(distance, 7));
    }

    // Урд талын саадыг (NPC машин, хүн) зүүн талаар нь тойрно; тойрч чадахгүй бол араас нь удаашрна
    const offset = this.avoidance(dt, p, fx, fz, rx, rz, speed, goal.ignore);
    aim.x -= rx * offset;
    aim.z -= rz * offset;
    // Саадын ард 3 сек-ээс удаан зогсвол (нүүр тулсан гацалт) хажуугаар нь шахаж гарна
    if (this.blockGap < 12 && Math.abs(speed) < 0.5) this.waitTime += dt;
    else this.waitTime = Math.max(0, this.waitTime - dt);
    if (this.waitTime > 3) {
      this.waitTime = 0;
      this.squeeze = 3;
    }
    this.squeeze = Math.max(0, this.squeeze - dt);
    if (this.blockGap < Infinity && this.squeeze <= 0) {
      desired = Math.min(desired, this.blockSpeed + Math.sqrt(8 * Math.max(0, this.blockGap - 6)));
    } else if (this.squeeze > 0) {
      desired = Math.min(desired, 4);
    }

    // Жолоо: зорилтот цэг рүү чиглэх өнцөг + хана/хашаанаас холдох засвар
    const ax = aim.x - p.x;
    const az = aim.z - p.z;
    const angle = Math.atan2(ax * rx + az * rz, ax * fx + az * fz);
    const wall = this.whiskers(p, yaw, speed);
    const steer = clamp(angle * 1.8 + wall.bias, -1, 1);
    if (Math.abs(angle) > 0.7) desired = Math.min(desired, 9); // Огцом эргэлт — удаашрна
    if (wall.front < 4.5) desired = Math.min(desired, 3); // Урд нь хана — бараг зогсоно

    // Хурд: хүссэн хурд руу хурдасгах / тоормослох (бага хурдад тоормос = ухрах тул дарахгүй)
    const throttle = desired > speed + 0.5 ? clamp((desired - speed) * 0.45, 0.3, 1) : 0;
    const brake = speed > desired + 1.5 && speed > 1 ? clamp((speed - desired) * 0.3, 0.25, 1) : 0;
    const handbrake = this.aggressive && Math.abs(angle) > 1.1 && speed > 12;

    // Гацалт: хурдасгаж байхад хөдлөхгүй бол ухарна
    if (throttle > 0.4 && Math.abs(speed) < 0.8) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    if (this.stuckTimer > 1.3) {
      this.stuckTimer = 0;
      this.reverseTimer = 1.1;
      this.routeTimer = 1.1; // Ухарсны дараа маршрутаа шинээр гаргана
    }
    this.lastSteer = steer;
    this.setInput(throttle, brake, steer, handbrake);
  }

  setInput(throttle, brake, steer, handbrake) {
    this.input.throttle = throttle;
    this.input.brake = brake;
    this.input.steer = steer;
    this.input.handbrake = handbrake;
    this.vehicle.setDriverInput(this.input);
  }

  // ---------- Маршрут ----------

  planRoute(p, goal) {
    this.routeTimer = ROUTE_REFRESH;
    this.routeGoal.x = goal.x;
    this.routeGoal.z = goal.z;
    const route = this.graph.route(p, goal);
    if (!route) {
      this.route = null;
      return;
    }
    // Машин эхний хоёр уулзварын хоорондох замаар аль хэдийн явж байвал ар талын уулзвар руу буцахгүй
    if (route.length >= 4 && onSegment(route[1], route[2], p)) route.splice(1, 1);
    // Зорилт сүүлийн хоёр уулзварын хоорондох замд байвал хэтэрч очоод буцахгүй
    const n = route.length;
    if (n >= 4 && onSegment(route[n - 2], route[n - 3], route[n - 1])) route.splice(n - 2, 1);
    this.route = route;
    this.routeIndex = 1;
  }

  /**
   * "Сахал": урагш ба хоёр тийш цацраг (хана, хашаа, шон). Аль тал нь ойр байна, тэндээс холдох
   * жолооны засвар (bias) ба урд талын чөлөөт зайг буцаана.
   */
  whiskers(p, yaw, speed) {
    const length = clamp(4 + Math.abs(speed) * 0.6, 5, 14);
    const cast = (angle) => {
      const a = yaw + angle;
      rayDirection.x = Math.sin(a);
      rayDirection.z = Math.cos(a);
      origin.x = p.x + Math.sin(yaw) * 1.8; // Машины урд хэсгээс
      origin.z = p.z + Math.cos(yaw) * 1.8;
      return this.physics.castRay(origin, rayDirection, length, WALL_GROUPS) ?? length;
    };
    const left = cast(WHISKER_ANGLE); // +өнцөг = машины зүүн тал
    const right = cast(-WHISKER_ANGLE);
    const front = cast(0);
    // Зөвхөн ойрхон саад тооцогдоно (замын хажуугийн шон г.м. алсынхыг үл тооно).
    // Зүүн тал ойр бол баруун тийш (эерэг жолоо), баруун тал ойр бол зүүн тийш.
    const near = length * 0.6;
    const leftClose = Math.max(0, 1 - left / near);
    const rightClose = Math.max(0, 1 - right / near);
    return { bias: (leftClose - rightClose) * 0.9, front };
  }

  /**
   * Маршрутын дагуу машинаас `look` метрийн урд орших цэгийг aim-д бичнэ.
   * @param {number} [laneOffset] Замын төвөөс баруун тийш шилжүүлэх (эгнээ)
   */
  followRoute(p, look, laneOffset = 0) {
    const route = this.route;
    // Өнгөрсөн цэгүүдийг алгасна
    while (this.routeIndex < route.length - 1) {
      const a = route[this.routeIndex - 1];
      const b = route[this.routeIndex];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const t = ((p.x - a.x) * sx + (p.z - a.z) * sz) / (sx * sx + sz * sz || 1);
      if (t >= 1 || Math.hypot(b.x - p.x, b.z - p.z) < 7) this.routeIndex++;
      else break;
    }
    let a = route[this.routeIndex - 1];
    let b = route[this.routeIndex];
    // Одоогийн хэсэг дээрх проекц
    const sx = b.x - a.x;
    const sz = b.z - a.z;
    const t = clamp(((p.x - a.x) * sx + (p.z - a.z) * sz) / (sx * sx + sz * sz || 1), 0, 1);
    let x = a.x + sx * t;
    let z = a.z + sz * t;
    let remaining = look;
    for (let i = this.routeIndex; i < route.length; i++) {
      b = route[i];
      const d = Math.hypot(b.x - x, b.z - z);
      if (d >= remaining) {
        const ux = (b.x - x) / d;
        const uz = (b.z - z) / d;
        // Эгнээ рүү шилжүүлэх: эхний хэсэг (машины бодит байрлалаас эхэлдэг) — үгүй, сүүлийн
        // хэсэг (зорилт руу) — зорилтод ойртох тусам багасна, бусад — бүтэн
        const goal = route[route.length - 1];
        let offset = i >= 2 ? laneOffset : 0;
        if (i === route.length - 1) offset *= clamp((Math.hypot(goal.x - x, goal.z - z) - remaining - 6) / 20, 0, 1);
        // Баруун тал = (−uz, ux)
        aim.x = x + ux * remaining - uz * offset;
        aim.z = z + uz * remaining + ux * offset;
        return;
      }
      remaining -= d;
      x = b.x;
      z = b.z;
      a = b;
    }
    aim.x = x;
    aim.z = z;
  }

  /** Дараагийн эргэлтийн өнцгөөс хамаарах хурдны хязгаар (тоормослох зайг тооцсон). */
  cornerSpeed(p) {
    const route = this.route;
    let limit = this.maxSpeed;
    // Удахгүй ирэх эргэлт ба дөнгөж орсон эргэлт (дундуур нь хурдалж хэтрэхгүй)
    for (let i = this.routeIndex - 1; i <= this.routeIndex; i++) {
      if (i < 1 || i >= route.length - 1) continue;
      const a = route[i - 1];
      const b = route[i];
      const c = route[i + 1];
      const angle = Math.abs(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x));
      const turn = Math.min(angle, Math.PI * 2 - angle);
      // 90° эргэлт ≈ 7 м/с (9 м-ийн шороон замд ч багтана), шулуун — дээд хурд
      const corner = 7 + 16 * Math.max(0, 1 - turn / (Math.PI / 2)) ** 2;
      const toCorner = Math.hypot(b.x - p.x, b.z - p.z);
      if (i < this.routeIndex) {
        if (toCorner < 12) limit = Math.min(limit, corner);
      } else {
        limit = Math.min(limit, Math.sqrt(corner * corner + 2 * CORNER_DECEL * Math.max(0, toCorner - 4)));
      }
    }
    return limit;
  }

  /** Урд талд саад байвал хэдэн метр зүүн тийш (сөрөг — баруун) тойрох вэ. */
  avoidance(dt, p, fx, fz, rx, rz, speed, ignore) {
    const look = clamp(8 + Math.abs(speed) * 1.2, 10, 28);
    let blocked = false;
    let leftBlocked = false;
    let gap = Infinity;
    let gapSpeed = 0;
    const vehicle = this.vehicle;
    this.hash.query(p.x + fx * look * 0.5, p.z + fz * look * 0.5, look * 0.5 + 4, (e) => {
      if (e.ref === vehicle || e.ref === ignore || e.kind === 'player') return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const forward = dx * fx + dz * fz;
      if (forward < 2 || forward > look) return;
      const lateral = dx * rx + dz * rz;
      if (Math.abs(lateral) < 2.3) {
        blocked = true;
        if (forward < gap) {
          gap = forward;
          gapSpeed = Math.max(0, e.vx * fx + e.vz * fz);
          this.blockLateral = lateral;
        }
      } else if (lateral < -2.3 && lateral > -6.5) leftBlocked = true;
    });
    // Урд нь саад байвал (тойрч гарах хүртэл) хурдаа тааруулна — мөргөхгүй
    this.blockGap = blocked ? gap : Infinity;
    this.blockSpeed = gapSpeed;
    // Зүүн тал чөлөөтэй бол гүйцэж түрүүлнэ; хаалттай бол баруун тийш (явган зам, хашаа руу) биш — араас нь дагана
    let target = blocked && !leftBlocked ? 3.4 : 0;
    // Гацалтаас гарах: саад баруун талд бол зүүнээр, зүүн талд бол баруунаар
    if (this.squeeze > 0) target = this.blockLateral >= 0 ? 3.4 : -3;
    this.avoidOffset = damp(this.avoidOffset, target, 3, dt);
    return this.avoidOffset;
  }
}

/** Зорилтоос `gap` метрт зогсохоор тооцсон хурдны хязгаар (5 м/с² тоормос). */
function stopSpeed(distance, gap) {
  return Math.sqrt(2 * 5 * Math.max(0, distance - gap));
}

/**
 * p цэг a→b замын хэсэг дээр байна уу: a-г давсан, b хүрээгүй, замын өргөнд (хажуу тийш ≤ 12 м).
 * (Зэргэлдээ гудамжинд байгаа бол үгүй — эс тэгвээс барилга дундуур "шулуун" явах гэж гацна.)
 */
function onSegment(a, b, p) {
  const sx = b.x - a.x;
  const sz = b.z - a.z;
  const length = Math.hypot(sx, sz) || 1;
  const along = ((p.x - a.x) * sx + (p.z - a.z) * sz) / length;
  const lateral = Math.abs((p.x - a.x) * sz - (p.z - a.z) * sx) / length;
  return along > 0 && along < length && lateral < 12;
}
