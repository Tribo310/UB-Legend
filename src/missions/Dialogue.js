// Харилцан яриа (хадмал): дэлгэцийн доод хэсэгт ярьж буй хүний нэр (өнгөтэй) ба мөр.
// Мөр бүр уртаасаа хамаарч 2–6.5 сек харагдана; E дарж дараагийн мөр рүү алгасаж болно.
// Тоглогч яриа явагдаж байхад хөдөлж, жолоодож болно (тоглоомыг зогсоохгүй).
import { t } from '../i18n/i18n.js';
import { clamp } from '../core/utils.js';
import { CHARACTERS } from './missionData.js';

const GAP = 0.25; // Мөр хоорондын завсар (с)

export class Dialogue {
  /** @param {import('../ui/UI.js').UI} ui */
  constructor(ui) {
    this.ui = ui;
    this.lines = [];
    this.index = -1;
    this.timer = 0;
    this.onDone = null;
  }

  get active() {
    return this.index >= 0;
  }

  /**
   * @param {{s: string, t: string}[]} lines s — дүрийн түлхүүр (CHARACTERS), t — текст
   * @param {() => void} [onDone]
   */
  play(lines, onDone = null) {
    this.lines = lines;
    this.onDone = onDone;
    this.index = -1;
    this.timer = 0;
    this.advance();
  }

  advance() {
    this.index++;
    if (this.index >= this.lines.length) {
      this.stop();
      const done = this.onDone;
      this.onDone = null;
      done?.();
      return;
    }
    const line = this.lines[this.index];
    const character = CHARACTERS[line.s] ?? CHARACTERS.bat;
    this.timer = clamp(1.4 + line.t.length * 0.055, 2.2, 6.5);
    this.ui.showDialogue(t(character.nameKey), character.color, line.t);
  }

  /** E: дараагийн мөр. */
  skip() {
    if (this.active) this.timer = Math.min(this.timer, GAP);
  }

  stop() {
    this.index = -1;
    this.lines = [];
    this.ui.hideDialogue();
  }

  update(dt) {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer <= GAP && this.timer + dt > GAP) this.ui.hideDialogue();
    if (this.timer <= 0) this.advance();
  }
}
