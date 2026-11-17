// Тоглогчийн тохиргоо (хэл, хулганы мэдрэмж г.м.) — localStorage-д хадгална.
// localStorage хаалттай (private горим) үед ч алдаагүй ажиллаж, анхдагч утгаа ашиглана.

const STORAGE_KEY = 'ub-hotyn-domog:settings:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'mn',
  mouseSensitivity: 1,
  invertY: false,
  showDebug: true,
});

export class Settings {
  constructor() {
    const stored = readStorage();
    this.values = { ...DEFAULT_SETTINGS, ...stored };
    // Буруу утга хадгалагдсан байвал засна
    const sensitivity = Number(this.values.mouseSensitivity);
    this.values.mouseSensitivity = Number.isFinite(sensitivity) ? Math.min(3, Math.max(0.2, sensitivity)) : 1;
    this.values.invertY = Boolean(this.values.invertY);
    this.values.showDebug = Boolean(this.values.showDebug);
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    writeStorage(this.values);
  }
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(values) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Хадгалах боломжгүй (private горим г.м.) — энэ сессийн турш санах ойд л үлдэнэ
  }
}
