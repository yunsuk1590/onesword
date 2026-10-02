// 캐릭터 (플레이어·봇 공통)
// 렌더링과 분리된 데이터 + 물리 스텝 + 전투 상태. 플레이어와 봇은 같은 클래스·같은 규칙을 쓴다.

import { CONFIG } from '../config.js';
import { stepVertical, clampToArena, resolveCircleOverlap } from '../core/physics.js';
import { deriveStats } from '../core/stats.js';
import {
  STATE,
  createCombatState,
  tickCombat,
  pressAttack,
  pressGuard,
  releaseGuard,
  applyStagger,
  kill,
  revive,
  stateDuration,
  parryCharge,
  moveSpeedMultiplier,
  canJump,
} from '../core/stateMachine.js';

export class Fighter {
  constructor({ x = 0, z = 0, yaw = 0, name = '', stats = deriveStats() } = {}) {
    this.name = name;
    this.stats = stats;
    this.position = { x, y: 0, z };
    this.vy = 0;
    this.onGround = true;
    this.yaw = yaw;
    this.radius = CONFIG.player.radius;
    this.horizontalSpeed = 0; // 직전 스텝의 수평 속력 (칼 흔들림 연출용)
    this.justLanded = false;

    this.hp = stats.maxHp;
    this.combat = createCombatState();
    this.attackSeq = 0; // 공격마다 1씩 증가하는 번호 (온라인 대전에서 같은 공격을 두 번 판정하지 않도록)
  }

  get state() {
    return this.combat.state;
  }

  get isDead() {
    return this.combat.state === STATE.DEAD;
  }

  /** 현재 상태 진행률 0~1 (시간으로 끝나지 않는 상태는 0) */
  stateProgress() {
    const d = stateDuration(this.combat, this.stats);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return Math.min(1, this.combat.elapsed / d);
  }

  /** 패링 재시도 가능까지 진행률 0~1 (HUD 패링 바) */
  parryCharge() {
    return parryCharge(this.combat, this.stats);
  }

  /** 지금 우클릭하면 패링 판정이 생기는지 */
  parryReady() {
    return this.parryCharge() >= 1;
  }

  // ── 전투 명령 ──
  tick(dtMs) {
    this.combat = tickCombat(this.combat, dtMs, this.stats);
  }

  tryAttack() {
    const next = pressAttack(this.combat);
    if (next === this.combat) return false;
    this.combat = next;
    this.attackSeq++;
    return true;
  }

  guardDown() {
    this.combat = pressGuard(this.combat, this.stats);
  }

  guardUp() {
    this.combat = releaseGuard(this.combat);
  }

  stagger(ms) {
    this.combat = applyStagger(this.combat, STATE.STAGGERED, ms);
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
  }

  die() {
    this.combat = kill(this.combat);
  }

  revive() {
    this.hp = this.stats.maxHp;
    this.combat = revive(this.combat);
  }

  /** 새 라운드: 위치·체력·전투 상태를 모두 처음으로 */
  resetForRound({ x, z, yaw }) {
    this.position.x = x;
    this.position.y = 0;
    this.position.z = z;
    this.vy = 0;
    this.onGround = true;
    this.yaw = yaw;
    this.horizontalSpeed = 0;
    this.justLanded = false;
    this.hp = this.stats.maxHp;
    this.combat = createCombatState();
  }

  // ── 이동 ──
  currentMoveSpeed() {
    return this.stats.moveSpeed * moveSpeedMultiplier(this.state, CONFIG);
  }

  /** 점프 시도. 땅에 있고 행동 가능한 상태일 때만. */
  jump() {
    if (!this.onGround || !canJump(this.state)) return false;
    this.vy = this.stats.jumpPower;
    this.onGround = false;
    return true;
  }

  /**
   * 한 스텝 이동.
   * @param {number} dt 초
   * @param {number} vx 수평 속도 X (m/s)
   * @param {number} vz 수평 속도 Z (m/s)
   * @param {Fighter[]} obstacles 부딪힐 다른 캐릭터들
   */
  step(dt, vx, vz, obstacles = []) {
    const p = this.position;
    p.x += vx * dt;
    p.z += vz * dt;

    const wasOnGround = this.onGround;
    const v = stepVertical(p.y, this.vy, dt, CONFIG.physics.gravity);
    p.y = v.y;
    this.vy = v.vy;
    this.onGround = v.onGround;
    // 착지 연출 신호는 한 번 켜지면 렌더 프레임에서 소비할 때까지 유지
    if (!wasOnGround && this.onGround) this.justLanded = true;

    for (const o of obstacles) {
      if (o === this) continue;
      const r = resolveCircleOverlap(p.x, p.z, this.radius, o.position.x, o.position.z, o.radius);
      p.x = r.x;
      p.z = r.z;
    }

    const c = clampToArena(p.x, p.z, CONFIG.arena.radius, this.radius);
    p.x = c.x;
    p.z = c.z;

    this.horizontalSpeed = Math.hypot(vx, vz);
  }

  consumeLanded() {
    const landed = this.justLanded;
    this.justLanded = false;
    return landed;
  }
}
