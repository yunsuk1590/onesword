// 입력 → fighter 명령
// 키보드·마우스·Pointer Lock을 다루는 Input과, 입력으로 플레이어 Fighter를 조종하는 PlayerController.

import { CONFIG } from '../config.js';
import { computeMoveVector } from '../core/physics.js';

// 조작표에 있는 키만 연결한다 (CLAUDE.md 2.2). 그 외 키는 무시.
const KEY_MAP = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
};

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = { forward: false, back: false, left: false, right: false };
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.events = []; // 'attack' | 'guardDown' | 'guardUp' | 'jump' — 시뮬레이션 스텝에서 순서대로 소비
    this.rightHeld = false;
    this.locked = false;
    this.onLockChange = null; // (locked: boolean) => void
    this.onLockError = null; // () => void — 잠금 실패 (Esc 직후 바로 다시 잠그려 할 때 등)

    window.addEventListener('keydown', (e) => this.#onKey(e, true));
    window.addEventListener('keyup', (e) => this.#onKey(e, false));
    window.addEventListener('blur', () => this.#releaseAll());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const max = CONFIG.camera.maxMouseDeltaPerEvent;
      this.mouseDx += clamp(e.movementX, -max, max);
      this.mouseDy += clamp(e.movementY, -max, max);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.events.push('attack');
      if (e.button === 2 && !this.rightHeld) {
        this.rightHeld = true;
        this.events.push('guardDown');
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.#releaseRight();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.#releaseAll();
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('pointerlockerror', () => this.onLockError?.());

    // 우클릭 메뉴는 게임 중 방해되므로 막는다 (우클릭은 방어/패링용)
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    // 최신 브라우저는 Promise를 반환한다. 거부되면(사용자 클릭 없이 요청 등) 실패를 알린다.
    // (pointerlockerror 이벤트로도 알려질 수 있어 두 번 불릴 수 있다 — 받는 쪽은 여러 번 불려도 안전해야 함)
    const result = this.element.requestPointerLock();
    if (result && typeof result.catch === 'function') result.catch(() => this.onLockError?.());
  }

  consumeMouse() {
    const delta = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = 0;
    this.mouseDy = 0;
    return delta;
  }

  consumeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  #onKey(e, down) {
    if (e.code === 'Space') {
      // 게임 중에만 가로챈다 (메뉴의 빌드 이름 입력칸에서는 띄어쓰기가 되어야 함)
      if (!this.locked) return;
      e.preventDefault();
      if (down && !e.repeat) this.events.push('jump');
      return;
    }
    const action = KEY_MAP[e.code];
    if (!action) return;
    this.keys[action] = down && this.locked;
  }

  #releaseRight() {
    if (!this.rightHeld) return;
    this.rightHeld = false;
    this.events.push('guardUp');
  }

  #releaseAll() {
    for (const k in this.keys) this.keys[k] = false;
    this.#releaseRight(); // 방어가 눌린 채로 멈추지 않도록
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}

export class PlayerController {
  constructor(fighter, input) {
    this.fighter = fighter;
    this.input = input;
    this.pitch = 0;
    this.lastMouse = { dx: 0, dy: 0 }; // 칼 흔들림 연출용
    this.time = 0;
    this.attackBufferedUntil = -Infinity;
  }

  /** 라운드 시작 등: 쌓여 있던 입력과 공격 예약을 버린다 */
  reset() {
    this.input.consumeEvents();
    this.attackBufferedUntil = -Infinity;
  }

  /** 시점 회전 — 히트스톱 중에도 매 렌더 프레임마다 호출 */
  look() {
    const f = this.fighter;
    const cam = CONFIG.camera;
    const { dx, dy } = this.input.consumeMouse();
    this.lastMouse = { dx, dy };
    f.yaw -= dx * cam.mouseSensitivity;
    const maxPitch = (cam.maxPitchDeg * Math.PI) / 180;
    this.pitch = clamp(this.pitch - dy * cam.mouseSensitivity, -maxPitch, maxPitch);
  }

  /** 시뮬레이션 스텝: 입력 이벤트 → 전투 명령, 그리고 이동 */
  update(dt, obstacles) {
    const f = this.fighter;
    this.time += dt * 1000;

    for (const ev of this.input.consumeEvents()) {
      switch (ev) {
        case 'attack':
          if (f.tryAttack()) this.attackBufferedUntil = -Infinity;
          else this.attackBufferedUntil = this.time + CONFIG.attack.inputBufferMs;
          break;
        case 'guardDown':
          f.guardDown();
          break;
        case 'guardUp':
          f.guardUp();
          break;
        case 'jump':
          f.jump();
          break;
      }
    }

    // 후딜레이 끝나기 직전에 누른 공격을 놓치지 않도록 잠깐 기억했다가 실행
    if (this.time <= this.attackBufferedUntil && f.tryAttack()) {
      this.attackBufferedUntil = -Infinity;
    }

    const dir = computeMoveVector(this.input.keys, f.yaw);
    const speed = f.currentMoveSpeed();
    f.step(dt, dir.x * speed, dir.z * speed, obstacles);
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
