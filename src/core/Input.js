// Оролтын систем: гар, хулгана (pointer lock), жойстик (Gamepad API).
//
// Товчлуурыг event.code-оор (физик байрлалаар) танина. Иймээс компьютер дээр
// монгол кирилл гарын байрлал идэвхтэй байсан ч W/A/S/D хэвийн ажиллана.
import { clamp } from './utils.js';

/** Үйлдэл → гарын товчлуурууд. Дараагийн үе шатуудын товчлуурыг урьдчилан тодорхойлов. */
export const KEY_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  handbrake: ['Space'], // Машин жолоодох үед
  vehicle: ['KeyF'], // Машинд суух / буух
  interact: ['KeyE'], // Үе шат 6
  map: ['KeyM'], // Үе шат 3
  phone: ['Tab'], // Үе шат 8
  pause: ['Escape', 'KeyP'],
  debugInfo: ['F3'],
  debugPhysics: ['F4'],
};

/** Стандарт gamepad-ийн товчлуурын индекс (Xbox нэршлээр; PlayStation дээр A = ✕, B = ○). */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

export const PAD_BINDINGS = {
  jump: [PAD.A],
  run: [PAD.B, PAD.LB],
  handbrake: [PAD.RB],
  vehicle: [PAD.Y],
  interact: [PAD.X],
  map: [PAD.BACK],
  phone: [PAD.UP],
  pause: [PAD.START],
};

// Тоглож байх үед browser-ийн анхдагч үйлдлийг (хуудас гүйлгэх, focus шилжих г.м.) хаах товчлуурууд
const PREVENT_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'F4']);
const STICK_DEADZONE = 0.18;
// Pointer lock эхлэх/дуусахад зарим browser хулганы асар том "үсрэлт" өгдөг — таслана
const MAX_MOUSE_DELTA = 250;
const PAD_BUTTON_COUNT = 17;

export class Input {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.keysDown = new Set(); // Одоо дарагдсан байгаа товчлуурууд
    this.keysPressed = new Set(); // Энэ кадрт шинээр дарагдсан товчлуурууд
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0; // Эерэг = холдуулах
    this.pointerLocked = false;
    this.dragging = false; // Pointer lock байхгүй үед хулганаа дарж чирэх горим
    this.gameplayActive = false;
    this.skipNextMove = false;

    this.padConnected = false;
    this.padMove = { x: 0, y: 0 };
    this.padLook = { x: 0, y: 0 };
    this.padButtons = new Array(PAD_BUTTON_COUNT).fill(false);
    this.padPrevButtons = new Array(PAD_BUTTON_COUNT).fill(false);
    this.padValues = new Float32Array(PAD_BUTTON_COUNT); // Аналог утга (RT/LT триггер 0..1)
    this.moveVector = { x: 0, y: 0 };
    this.driveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    // Game эдгээрийг тохируулна
    this.onPointerLockChange = null;
    this.onCanvasPointerDown = null;
    this.onGamepadChange = null;

    this.attachListeners();
  }

  attachListeners() {
    window.addEventListener('keydown', (event) => {
      if (this.gameplayActive && PREVENT_DEFAULT.has(event.code)) event.preventDefault();
      if (!event.repeat) this.keysPressed.add(event.code);
      this.keysDown.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keysDown.delete(event.code));
    // Alt+Tab хийхэд товчлуур "гацахаас" сэргийлнэ
    window.addEventListener('blur', () => this.releaseAll());

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked && !this.dragging) return;
      if (this.skipNextMove) {
        this.skipNextMove = false;
        return;
      }
      this.mouseDX += clamp(event.movementX, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
      this.mouseDY += clamp(event.movementY, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
    });
    this.canvas.addEventListener('mousedown', (event) => {
      if (this.gameplayActive && !this.pointerLocked) this.dragging = true;
      this.onCanvasPointerDown?.(event);
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.gameplayActive) return;
        // deltaMode: 0 = пиксел, 1 = мөр, 2 = хуудас. Хулганы нэг "шүд" ≈ 1 нэгж болгоно.
        const scale = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 100 : 1;
        this.wheel += (event.deltaY * scale) / 100;
      },
      { passive: true },
    );
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.skipNextMove = true;
      this.dragging = false;
      this.onPointerLockChange?.(this.pointerLocked);
    });

    window.addEventListener('gamepadconnected', () => this.onGamepadChange?.(true));
    window.addEventListener('gamepaddisconnected', () => this.onGamepadChange?.(false));
  }

  /** Кадр бүрийн эхэнд дуудна: жойстикийн төлөвийг уншина. */
  poll() {
    const current = this.padButtons;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) this.padPrevButtons[i] = current[i];

    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    let pad = null;
    if (pads) {
      for (const candidate of pads) {
        if (candidate && candidate.connected) {
          pad = candidate;
          break;
        }
      }
    }

    if (!pad) {
      this.padConnected = false;
      current.fill(false);
      this.padValues.fill(0);
      this.padMove.x = this.padMove.y = this.padLook.x = this.padLook.y = 0;
      return;
    }

    this.padConnected = true;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
      const button = pad.buttons[i];
      current[i] = Boolean(button?.pressed);
      this.padValues[i] = button ? button.value : 0;
    }
    applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.padMove);
    applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.padLook);
  }

  /** Кадр бүрийн төгсгөлд дуудна: нэг удаагийн үйл явдлуудыг цэвэрлэнэ. */
  endFrame() {
    this.keysPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Үйлдлийн товчлуур одоо дарагдсан байна уу? */
  isDown(action) {
    const keys = KEY_BINDINGS[action];
    if (keys) {
      for (const code of keys) if (this.keysDown.has(code)) return true;
    }
    const buttons = PAD_BINDINGS[action];
    if (buttons && this.padConnected) {
      for (const index of buttons) if (this.padButtons[index]) return true;
    }
    return false;
  }

  /** Үйлдлийн товчлуур яг энэ кадрт дарагдсан уу? (нэг удаагийн үйлдэлд: үсрэх, цэс) */
  wasPressed(action) {
    const keys = KEY_BINDINGS[action];
    if (keys) {
      for (const code of keys) if (this.keysPressed.has(code)) return true;
    }
    const buttons = PAD_BINDINGS[action];
    if (buttons && this.padConnected) {
      for (const index of buttons) if (this.padButtons[index] && !this.padPrevButtons[index]) return true;
    }
    return false;
  }

  /**
   * Хөдөлгөөний вектор: x = баруун(+)/зүүн(−), y = урагш(+)/хойш(−). Урт нь ≤ 1.
   * Гар ба жойстикийн зүүн стикийг нэгтгэнэ.
   */
  getMoveVector() {
    let x = 0;
    let y = 0;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('backward')) y -= 1;
    x += this.padMove.x;
    y -= this.padMove.y; // Стикийг дээш түлхэхэд сөрөг утга өгдөг
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.moveVector.x = x;
    this.moveVector.y = y;
    return this.moveVector;
  }

  /** Жойстикийн баруун стик (камер) — x баруун, y доош. */
  getLookStick() {
    return this.padLook;
  }

  /**
   * Машин жолоодох оролт: throttle/brake 0..1 (гар эсвэл RT/LT триггер),
   * steer −1 (зүүн) .. 1 (баруун), handbrake (Space / RB).
   */
  getDriveInput() {
    const out = this.driveInput;
    out.throttle = Math.max(this.isDown('forward') ? 1 : 0, this.padValues[PAD.RT]);
    out.brake = Math.max(this.isDown('backward') ? 1 : 0, this.padValues[PAD.LT]);
    let steer = this.padMove.x;
    if (this.isDown('right')) steer += 1;
    if (this.isDown('left')) steer -= 1;
    out.steer = clamp(steer, -1, 1);
    out.handbrake = this.isDown('handbrake');
    return out;
  }

  setGameplayActive(active) {
    this.gameplayActive = active;
    if (!active) this.dragging = false;
  }

  releaseAll() {
    this.keysDown.clear();
    this.dragging = false;
  }

  /** Хулганыг "түгжинэ" — курсор алга болж, хулгана зөвхөн камер эргүүлнэ. */
  requestPointerLock() {
    if (this.pointerLocked || !this.canvas.requestPointerLock) return;
    try {
      const result = this.canvas.requestPointerLock();
      // Шинэ browser-ууд Promise буцаана. Татгалзвал (хэрэглэгчийн үйлдэл шаардлагатай г.м.)
      // тоглоом "чирж эргүүлэх" горимоор үргэлжилж, дэлгэц дээр дарахад дахин оролдоно.
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Pointer lock дэмждэггүй орчин — чирэх горим ажиллана
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

/** Стикийн бага хазайлтыг (drift) тасалж, үлдсэнийг 0..1 болгож масштаблана. */
function applyDeadzone(x, y, out) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < STICK_DEADZONE) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min(1, (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  out.x = (x / magnitude) * scaled;
  out.y = (y / magnitude) * scaled;
  return out;
}
