// Хайлтын түвшин (1–5 од).
//
// Гэмт хэрэг бүр "оноо" нэмнэ; оноо босго давах тусам од нэмэгдэнэ (илүү олон цагдаа).
// Цагдаа тоглогчийг харж байх үед мөрдөлт идэвхтэй, удаан хөөгдөх тусам түвшин аажмаар өснө (3 од хүртэл).
// Харагдахгүй болбол одод анивчиж "хайлт" эхэлнэ: сүүлд харагдсан газрын орчимд цагдаа эрнэ.
// Хангалттай удаан нуугдвал цагдаа мөрөө алдаж, хайлтын түвшин арилна.

/** Гэмт хэрэг → оноо. */
export const CRIMES = Object.freeze({
  pedestrianHit: 1, // Явган хүн мөргөсөн
  carjack: 1, // Машин булаасан
  vehicleRam: 0.5, // Машин хүчтэй мөргөсөн
  redLight: 1, // Цагдаагийн нүдэн дээр улаан гэрлээр гарсан
  policeRam: 1.5, // Цагдаагийн машин мөргөсөн
  officerHit: 2, // Цагдаа мөргөж унагаасан
  policeCarTheft: 2, // Цагдаагийн машин хулгайлсан
});
/** Од бүрийн оноон босго: 1★ = 1, 2★ = 3, 3★ = 6, 4★ = 10, 5★ = 15. */
const THRESHOLDS = Object.freeze([1, 3, 6, 10, 15]);
const MAX_POINTS = 20;
const PURSUIT_HEAT = 1 / 25; // Цагдаа харж байхад 25 сек тутамд +1 оноо…
const PURSUIT_HEAT_CAP = 6; // …гэхдээ ингэж зөвхөн 3 од хүртэл өснө
const DISPATCH_SECONDS = 8; // Хэрэг мэдээлэгдсэний дараа цагдаа (дуудлагаар) байршлыг тань мэдэж байх хугацаа

export class WantedSystem {
  constructor() {
    this.points = 0;
    this.level = 0;
    this.seen = false; // Яг одоо цагдаа харж байна уу
    this.searchTime = 0; // Харагдахгүй болсноос хойш (с)
    this.dispatch = 0;
    this.lastKnown = { x: 0, z: 0 }; // Сүүлд харагдсан байрлал
    this.lastCrime = null;
    /** (level, previous, reason) — түвшин өөрчлөгдөхөд */
    this.onChange = null;
    /** Цагдаа мөрөө алдахад */
    this.onEscaped = null;
  }

  /** Мөрөө алдахад хэр удаан нуугдах ёстой вэ (с): 1★ — 15, 5★ — 35. */
  get escapeTime() {
    return 10 + this.level * 5;
  }

  /** Цагдаа хайх хүрээ (сүүлд харагдсан цэгээс, м). */
  get searchRadius() {
    return 40 + this.level * 15;
  }

  /** Хайлтын үе (одод анивчина). */
  get searching() {
    return this.level > 0 && !this.seen;
  }

  /**
   * @param {keyof typeof CRIMES} crime
   * @param {{x:number, z:number}} position Хэрэг гарсан газар
   */
  report(crime, position) {
    const points = CRIMES[crime];
    if (!points) return;
    this.points = Math.min(MAX_POINTS, this.points + points);
    this.lastCrime = crime;
    this.lastKnown.x = position.x;
    this.lastKnown.z = position.z;
    this.dispatch = DISPATCH_SECONDS;
    this.seen = true;
    this.searchTime = 0;
    this.updateLevel(crime);
  }

  /** Туршилтад: дараагийн од хүртэл оноо нэмнэ (F6). */
  addStar(position) {
    const next = THRESHOLDS[Math.min(this.level, THRESHOLDS.length - 1)];
    this.points = Math.min(MAX_POINTS, Math.max(this.points, next));
    this.lastKnown.x = position.x;
    this.lastKnown.z = position.z;
    this.dispatch = DISPATCH_SECONDS;
    this.seen = true;
    this.searchTime = 0;
    this.updateLevel('debug');
  }

  updateLevel(reason) {
    let level = 0;
    for (const threshold of THRESHOLDS) if (this.points >= threshold) level++;
    if (level === this.level) return;
    const previous = this.level;
    this.level = level;
    this.onChange?.(level, previous, reason);
  }

  /**
   * Кадр бүр.
   * @param {boolean} spotted Цагдаа (машин, явган цагдаа, эргүүл) тоглогчийг харж байна уу
   * @param {{x:number, z:number}} position Тоглогчийн байрлал
   */
  update(dt, spotted, position) {
    if (this.level === 0) return;
    this.dispatch = Math.max(0, this.dispatch - dt);
    if (spotted || this.dispatch > 0) {
      this.seen = true;
      this.searchTime = 0;
      this.lastKnown.x = position.x;
      this.lastKnown.z = position.z;
      if (spotted && this.points < PURSUIT_HEAT_CAP) {
        this.points = Math.min(PURSUIT_HEAT_CAP, this.points + dt * PURSUIT_HEAT);
        this.updateLevel('pursuit');
      }
      return;
    }
    this.seen = false;
    this.searchTime += dt;
    if (this.searchTime >= this.escapeTime) {
      this.clear();
      this.onEscaped?.();
    }
  }

  clear() {
    const previous = this.level;
    this.points = 0;
    this.level = 0;
    this.seen = false;
    this.searchTime = 0;
    this.dispatch = 0;
    if (previous > 0) this.onChange?.(0, previous, 'clear');
  }
}
