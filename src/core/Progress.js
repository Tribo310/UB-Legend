// Тоглогчийн ахиц: мөнгө (₮), биелүүлсэн даалгаврууд.
// Одоохондоо санах ойд л хадгална — Үе шат 8-д (хадгалах систем) localStorage / "өөрийн байр"-нд
// хадгалагдана. Иймээс өгөгдөл нь энгийн, JSON болгоход хялбар бүтэцтэй.

export class Progress {
  constructor() {
    this.money = 0;
    /** @type {Set<string>} Биелүүлсэн даалгаврын id */
    this.completed = new Set();
    /** (money, delta) — мөнгө өөрчлөгдөхөд (HUD) */
    this.onMoneyChange = null;
  }

  addMoney(amount) {
    this.money = Math.max(0, this.money + amount);
    this.onMoneyChange?.(this.money, amount);
  }

  complete(missionId) {
    this.completed.add(missionId);
  }

  isCompleted(missionId) {
    return this.completed.has(missionId);
  }

  toJSON() {
    return { money: this.money, completed: [...this.completed] };
  }
}

/** 25000 → "25 000 ₮" */
export function formatMoney(amount) {
  return `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₮`;
}
