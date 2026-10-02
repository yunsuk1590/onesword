// 1인칭 칼 모델과 애니메이션
// 별도 씬·카메라로 그려서 칼이 벽이나 상대 몸에 파묻혀 보이지 않게 한다.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { STATE } from '../core/stateMachine.js';

// 상태별 칼 자세 (위치: 카메라 기준 m, 회전: 라디안 XYZ). 연출 전용 값이라 config 대신 여기 둔다.
const base = CONFIG.viewModel;
const POSE = {
  idle: { p: [base.basePosition.x, base.basePosition.y, base.basePosition.z], r: [base.baseRotation.x, base.baseRotation.y, base.baseRotation.z] },
  // 예비동작: 칼을 오른쪽 위로 끌어올림
  windup: { p: [0.46, -0.24, -0.55], r: [0.1, -0.3, -0.55] },
  // 판정 끝: 왼쪽 아래로 휘두른 자세
  follow: { p: [-0.25, -0.38, -0.6], r: [-1.2, -0.3, 1.35] },
  // 방어: 칼날을 화면 가로로 눕혀 앞을 막음
  guard: { p: [0.3, -0.22, -0.55], r: [0.15, -0.35, 1.5] },
  // 경직: 칼이 오른쪽 아래로 튕겨남
  stagger: { p: [0.55, -0.6, -0.55], r: [-0.2, -0.6, -0.7] },
  dead: { p: [0.4, -1.1, -0.6], r: [-0.2, -0.3, 0.3] },
};

const GLOW = {
  windup: new THREE.Color(0xff7a1a),
  active: new THREE.Color(0xffffff),
  parry: new THREE.Color(0x5ad8ff),
  guard: new THREE.Color(0x4a7ab0),
};

export class ViewModel {
  constructor(aspect) {
    const vm = CONFIG.viewModel;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(vm.fov, aspect, 0.01, 10);

    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x302820, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1.5, 2, 1);
    this.scene.add(key);

    // root: 걷기 흔들림·마우스 지연 같은 오프셋 / sword: 상태별 자세
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.sword = buildSword();
    this.root.add(this.sword);
    this.bladeMat = this.sword.userData.bladeMaterial;
    this.pose = clonePose(POSE.idle);
    applyPose(this.sword, this.pose);

    this.time = 0;
    this.bobPhase = 0;
    this.moveRatio = 0; // 0(정지) ~ 1(전력 이동), 부드럽게 보간
    this.sway = { x: 0, y: 0 };
    this.dip = 0;
    this.glow = 0;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 공격범위 스탯에 맞춰 칼날 길이를 바꾼다 (1 = 기본 사거리) */
  setReach(scale) {
    this.sword.userData.blade.scale.y = scale;
  }

  /**
   * @param {number} dt
   * @param {{ speed:number, onGround:boolean, justLanded:boolean, mouseDx:number, mouseDy:number }} motion
   * @param {{ state:string, progress:number }} combat
   */
  update(dt, motion, combat) {
    this.#updateOffsets(dt, motion);
    this.#updatePose(dt, combat);
  }

  #updateOffsets(dt, s) {
    const vm = CONFIG.viewModel;
    this.time += dt;

    // 걷기 흔들림
    const targetRatio = s.onGround ? Math.min(1, s.speed / CONFIG.player.moveSpeed) : 0;
    this.moveRatio = damp(this.moveRatio, targetRatio, 10, dt);
    this.bobPhase += dt * vm.bobFrequency * this.moveRatio;
    const bobX = Math.sin(this.bobPhase) * vm.bobAmount * this.moveRatio;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * vm.bobAmount * this.moveRatio;

    // 숨쉬기 (가만히 있을 때 미세한 움직임)
    const breath = Math.sin(this.time * 1.6) * 0.004;

    // 마우스 지연 — 시점을 돌리면 칼이 살짝 늦게 따라온다
    const targetSwayX = clamp(-s.mouseDx * vm.swayAmount, -vm.swayMax, vm.swayMax);
    const targetSwayY = clamp(s.mouseDy * vm.swayAmount, -vm.swayMax, vm.swayMax);
    this.sway.x = damp(this.sway.x, targetSwayX, 8, dt);
    this.sway.y = damp(this.sway.y, targetSwayY, 8, dt);

    // 착지 시 칼이 아래로 툭 내려갔다 돌아온다
    if (s.justLanded) this.dip = vm.landDip;
    this.dip = damp(this.dip, 0, 9, dt);

    this.root.position.set(bobX + this.sway.x, bobY + breath + this.sway.y - this.dip, 0);
  }

  #updatePose(dt, { state, progress }) {
    let target;
    let lambda = 16; // 자세 전환 속도
    let glowColor = null;
    let glowTarget = 0;

    switch (state) {
      case STATE.ATTACK_WINDUP:
        target = lerpPose(POSE.idle, POSE.windup, easeOutCubic(progress));
        lambda = 40;
        glowColor = GLOW.windup;
        glowTarget = 0.15 + 0.6 * progress;
        break;
      case STATE.ATTACK_ACTIVE:
        target = lerpPose(POSE.windup, POSE.follow, easeOutQuad(progress));
        lambda = 60;
        glowColor = GLOW.active;
        glowTarget = 0.7;
        break;
      case STATE.ATTACK_RECOVERY:
        target = lerpPose(POSE.follow, POSE.idle, easeInOutQuad(progress));
        lambda = 30;
        break;
      case STATE.PARRY_WINDOW:
        target = POSE.guard;
        lambda = 35;
        glowColor = GLOW.parry;
        glowTarget = 1.2;
        break;
      case STATE.GUARD:
        target = POSE.guard;
        lambda = 25;
        glowColor = GLOW.guard;
        glowTarget = 0.25;
        break;
      case STATE.STAGGERED:
      case STATE.STUNNED: {
        // 경직 중에는 칼이 떨린다
        const shake = Math.sin(this.time * 70) * 0.02 * (1 - progress);
        target = offsetPose(POSE.stagger, shake);
        lambda = 22;
        break;
      }
      case STATE.DEAD:
        target = POSE.dead;
        lambda = 4;
        break;
      default:
        target = POSE.idle;
    }

    dampPose(this.pose, target, lambda, dt);
    applyPose(this.sword, this.pose);

    this.glow = damp(this.glow, glowTarget, glowTarget > this.glow ? 40 : 10, dt);
    if (glowColor) this.bladeMat.emissive.copy(glowColor);
    this.bladeMat.emissiveIntensity = this.glow;
  }
}

// 칼 모델: 원점이 손잡이 중앙(손 위치), 칼날은 +Y 방향
function buildSword() {
  const group = new THREE.Group();

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd7dde4, metalness: 0.35, roughness: 0.3, emissive: 0x000000 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, metalness: 0.4, roughness: 0.5 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9 });

  // 손잡이
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.2, 10), leather);
  group.add(grip);

  // 폼멜
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), steelDark);
  pommel.position.y = -0.115;
  group.add(pommel);

  // 코등이
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.055), steelDark);
  guard.position.y = 0.115;
  group.add(guard);

  // 칼날 — 끝이 뾰족한 평면 도형을 얇게 돌출
  const w = 0.056;
  const len = 0.78;
  const tip = 0.12;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, len);
  shape.lineTo(0, len + tip);
  shape.lineTo(-w / 2, len);
  shape.closePath();
  const depth = 0.012;
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  bladeGeo.translate(0, 0, -depth / 2);
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.y = 0.13;
  group.add(blade);

  group.userData.bladeMaterial = bladeMat;
  group.userData.blade = blade;
  return group;
}

// ── 자세 보간 도우미 ──
function clonePose(p) {
  return { p: [...p.p], r: [...p.r] };
}

function lerpPose(a, b, t) {
  return {
    p: a.p.map((v, i) => v + (b.p[i] - v) * t),
    r: a.r.map((v, i) => v + (b.r[i] - v) * t),
  };
}

function offsetPose(p, d) {
  return { p: [p.p[0] + d, p.p[1] + d * 0.5, p.p[2]], r: [...p.r] };
}

function dampPose(cur, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  for (let i = 0; i < 3; i++) {
    cur.p[i] += (target.p[i] - cur.p[i]) * k;
    cur.r[i] += (target.r[i] - cur.r[i]) * k;
  }
}

function applyPose(obj, pose) {
  obj.position.set(pose.p[0], pose.p[1], pose.p[2]);
  obj.rotation.set(pose.r[0], pose.r[1], pose.r[2]);
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
