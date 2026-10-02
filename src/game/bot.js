// AI → fighter 명령
//
// 봇은 플레이어와 같은 Fighter·같은 상태 머신·같은 판정을 쓴다. 특별 취급은 없다.
// 봇이 할 수 있는 것은 플레이어와 똑같이 "공격 / 우클릭 누름·뗌 / 이동 / 회전"뿐이고,
// 상대의 상태 변화는 난이도별 반응 시간만큼 늦게 행동으로 이어진다.
//
// 행동 모드 (이동 방식 결정)
//   APPROACH: 사거리 밖 → 다가간다
//   PRESSURE: 사거리 안 → 거리를 유지하며 옆걸음, 틈을 보고 공격
//   DEFEND:   방어 중 (미리 방어 자세 또는 상대 예비동작에 반응)
//   RETREAT:  맞은 뒤나 회피할 때 거리를 벌린다
//   FLANK:    상대 주위를 돌아 등 뒤로 간다 → 백어택 (이동속도가 빠를수록 자주 시도)

import { CONFIG } from '../config.js';
import { STATE, isAttacking } from '../core/stateMachine.js';
import { yawToward, turnToward } from '../core/physics.js';
import { isBackAttack } from '../core/combat.js';
import { gaussian, randRange } from '../core/random.js';

export const BOT_MODE = Object.freeze({
  APPROACH: 'APPROACH',
  PRESSURE: 'PRESSURE',
  DEFEND: 'DEFEND',
  RETREAT: 'RETREAT',
  FLANK: 'FLANK',
});

const DEG = Math.PI / 180;

export class BotController {
  /**
   * @param {import('./fighter.js').Fighter} fighter
   * @param {string} difficulty CONFIG.bot.difficulties의 키
   * @param {() => number} [rng] 난수 함수 (테스트에서 시드 고정용)
   */
  constructor(fighter, difficulty = 'normal', rng = Math.random) {
    this.fighter = fighter;
    this.difficulty = difficulty;
    this.d = CONFIG.bot.difficulties[difficulty];
    this.rng = rng;
    this.reset();
  }

  /** 라운드 시작 시 기억 초기화 */
  reset() {
    this.time = 0;
    this.mode = BOT_MODE.APPROACH;
    this.actions = []; // 예약된 행동 { at, run }
    this.lastOppState = null;
    this.lastHp = this.fighter.hp;
    this.wantAttackUntil = -Infinity; // 반격 의도 — 이 시각까지 공격 가능해지면 바로 공격
    this.nextAttackAt = 0;
    this.retreatUntil = 0;
    this.defendUntil = 0; // 상대 공격에 대응 중 (이 동안 먼저 공격하지 않음, 방어 버튼은 대응 로직이 관리)
    this.stance = false; // 미리 방어 자세
    this.nextStanceRoll = 0;
    this.strafeDir = 1;
    this.nextStrafeFlip = 0;
    this.flankUntil = 0; // 등 뒤 돌기 진행 중 (이 시각까지)
    this.flankDir = 1; // 상대 주위를 도는 방향
  }

  get flanking() {
    return this.time < this.flankUntil;
  }

  /**
   * @param {number} dt 초
   * @param {import('./fighter.js').Fighter} opp 상대
   */
  update(dt, opp) {
    const f = this.fighter;
    const d = this.d;
    const b = CONFIG.bot;
    this.time += dt * 1000;

    if (f.isDead || opp.isDead) {
      if (f.combat.guardHeld) f.guardUp();
      f.step(dt, 0, 0, [opp]);
      return;
    }

    const dx = opp.position.x - f.position.x;
    const dz = opp.position.z - f.position.z;
    const dist = Math.hypot(dx, dz) || 1e-6;

    // ── 1. 관찰: 상대 상태가 바뀌면 (반응 시간 뒤의) 대응을 예약 ──
    if (opp.state !== this.lastOppState) {
      this.#onOpponentState(opp, dist);
      this.lastOppState = opp.state;
    }
    if (f.hp < this.lastHp && this.rng() < d.retreatChance) {
      this.retreatUntil = this.time + randRange(this.rng, 400, 900);
    }
    this.lastHp = f.hp;

    // ── 2. 예약된 행동 실행 ──
    if (this.actions.length) {
      const due = this.actions.filter((a) => a.at <= this.time).sort((p, q) => p.at - q.at);
      this.actions = this.actions.filter((a) => a.at > this.time);
      for (const a of due) a.run();
    }

    const defending = this.time < this.defendUntil;

    // ── 3. 미리 방어 자세 (가까이 있을 때 가끔 우클릭을 누르고 있는다) ──
    if (this.time >= this.nextStanceRoll) {
      this.nextStanceRoll = this.time + randRange(this.rng, ...b.stanceRerollMs);
      this.stance = dist < f.stats.range + 1.2 && this.rng() < d.guardStance;
    }
    if (this.flanking) this.stance = false; // 돌아갈 땐 방어 자세를 풀고 전속력
    if (!defending && this.wantAttackUntil < this.time) {
      if (this.stance && !f.combat.guardHeld && f.state === STATE.IDLE) f.guardDown();
      if (!this.stance && f.combat.guardHeld) f.guardUp();
    }

    // ── 3-1. 등 뒤 돌기 시작: 상대가 방어 자세로 버티면 방어가 안 통하는 등 뒤를 노린다 ──
    if (
      !this.flanking &&
      !defending &&
      opp.state === STATE.GUARD &&
      dist <= f.stats.range + 1.5 &&
      this.rng() < d.flankChance * this.#speedFactor() * dt
    ) {
      this.#startFlank(opp, b.flankTimeoutMs);
    }

    // ── 4. 공격 ──
    const facing = this.#isFacing(opp);
    const behind = isBackAttack(f.position, { x: opp.position.x, z: opp.position.z, yaw: opp.yaw }, CONFIG.backAttack.angleDeg);
    if (this.flanking && behind && facing && dist <= f.stats.range) {
      // 등 뒤를 잡았다 → 백어택
      if (this.#attack()) this.flankUntil = 0;
    } else if (this.time <= this.wantAttackUntil && facing && dist <= f.stats.range) {
      if (this.#attack()) this.wantAttackUntil = -Infinity;
    } else if (
      !this.flanking &&
      !defending &&
      this.time >= this.nextAttackAt &&
      facing &&
      dist <= f.stats.range * 0.95 &&
      (f.state === STATE.IDLE || f.state === STATE.GUARD)
    ) {
      let rate = d.aggression;
      if (d.smart && opp.state === STATE.GUARD) rate *= 0.35; // 막히면 반격당하니 자제
      if (this.rng() < rate * dt && this.#attack()) {
        this.nextAttackAt = this.time + randRange(this.rng, ...b.attackGapMs);
      }
    }

    // ── 5. 이동 모드 결정 ──
    if (this.time < this.retreatUntil) this.mode = BOT_MODE.RETREAT;
    else if (this.flanking) this.mode = BOT_MODE.FLANK;
    else if (f.combat.guardHeld || defending) this.mode = BOT_MODE.DEFEND;
    else if (dist > f.stats.range * 0.95) this.mode = BOT_MODE.APPROACH;
    else this.mode = BOT_MODE.PRESSURE;

    // ── 6. 이동 ──
    if (this.time >= this.nextStrafeFlip) {
      this.strafeDir = this.rng() < 0.5 ? -1 : 1;
      this.nextStrafeFlip = this.time + randRange(this.rng, ...b.strafeFlipMs);
    }
    const tx = dx / dist; // 상대 방향
    const tz = dz / dist;
    const px = -tz * this.strafeDir; // 옆 방향
    const pz = tx * this.strafeDir;
    let mx = 0;
    let mz = 0;
    switch (this.mode) {
      case BOT_MODE.APPROACH:
        mx = tx;
        mz = tz;
        break;
      case BOT_MODE.PRESSURE:
      case BOT_MODE.DEFEND: {
        const preferred = f.stats.range * b.preferredRangeRatio;
        const radial = Math.max(-1, Math.min(1, (dist - preferred) * 2));
        mx = tx * radial + px * b.strafeSpeedMul;
        mz = tz * radial + pz * b.strafeSpeedMul;
        break;
      }
      case BOT_MODE.RETREAT:
        mx = -tx + px * 0.3;
        mz = -tz + pz * 0.3;
        break;
      case BOT_MODE.FLANK: {
        // 상대를 중심으로 원을 그리며 돈다: 접선 방향 + 거리 유지
        const preferred = f.stats.range * b.preferredRangeRatio;
        const radial = Math.max(-1, Math.min(1, (dist - preferred) * 2));
        const orbit = behind ? 0.3 : 1; // 이미 등 뒤면 천천히 자리 유지
        mx = tz * this.flankDir * orbit + tx * radial; // 접선 = flankDir × (상대→나 벡터를 90° 회전)
        mz = -tx * this.flankDir * orbit + tz * radial;
        break;
      }
    }
    const len = Math.hypot(mx, mz);
    const speed = f.currentMoveSpeed();
    const vx = len > 1 ? (mx / len) * speed : mx * speed;
    const vz = len > 1 ? (mz / len) * speed : mz * speed;

    // ── 7. 회전: 상대를 바라본다 (공격 중엔 느리게, 경직 중엔 못 돈다) ──
    let turn = d.turnSpeed;
    if (isAttacking(f.state)) turn *= b.attackTurnMul;
    if (f.state === STATE.STAGGERED || f.state === STATE.STUNNED) turn = 0;
    f.yaw = turnToward(f.yaw, yawToward(f.position.x, f.position.z, opp.position.x, opp.position.z), turn * dt);

    f.step(dt, vx, vz, [opp]);
  }

  // ── 상대 상태 변화에 대한 대응 ──
  #onOpponentState(opp, dist) {
    const d = this.d;
    switch (opp.state) {
      case STATE.ATTACK_WINDUP: {
        if (dist > opp.stats.range + 1.0) return; // 닿지 않을 거리면 무시
        const reactAt = this.time + this.#reaction();
        const hitAt = this.time - opp.combat.elapsed + opp.stats.windupMs; // 판정이 들어올 예상 시각
        const flankP = Math.min(CONFIG.bot.flankMaxChance, d.flankChance * this.#speedFactor());
        const r = this.rng();
        if (r < d.parryChance) this.#planParry(reactAt, hitAt);
        else if (r < d.parryChance + flankP) this.#planSidestep(opp, reactAt, hitAt);
        else if (r < d.parryChance + flankP + d.dodgeChance) this.#planDodge(reactAt, hitAt);
        // 그 외: 대응 못 함 — 미리 방어 자세였다면 막히고, 아니면 맞는다
        break;
      }
      case STATE.ATTACK_ACTIVE:
        // 상대 공격이 나옴 → 헛치거나 막혔다면 후딜레이를 노린다
        if (this.rng() < d.punishChance) {
          this.#schedule(this.#reaction(), () => {
            if (opp.state === STATE.ATTACK_ACTIVE || opp.state === STATE.ATTACK_RECOVERY) {
              this.wantAttackUntil = this.time + 350;
            }
          });
        }
        break;
      case STATE.STAGGERED:
        // 패링당한 긴 경직 → 반격 찬스 (맞아서 생긴 짧은 경직은 서로 동시에 풀리므로 무시)
        if (opp.combat.duration >= CONFIG.parry.attackerStaggerMs * 0.9 && this.rng() < d.punishChance) {
          this.#schedule(this.#reaction(), () => {
            // 경직이 끝나기 전에 등 뒤까지 돌아가서 칠 수 있을 만큼 빠르면 백어택(1.5배), 아니면 정면 반격
            const remaining = opp.combat.duration - opp.combat.elapsed;
            if (opp.state === STATE.STAGGERED && this.#timeToGetBehind(opp) + this.fighter.stats.windupMs < remaining - 80) {
              this.#startFlank(opp, remaining);
            } else {
              this.wantAttackUntil = this.time + 400;
            }
          });
        }
        break;
    }
  }

  /** 이동속도가 빠를수록 등 뒤 돌기를 자주 시도한다 (기본 속도 = 1, 느리면 줄고 빠르면 늘어남) */
  #speedFactor() {
    return (this.fighter.stats.moveSpeed / CONFIG.player.moveSpeed) ** 2;
  }

  /** 상대 주위를 돌아 등 뒤 부채꼴에 들어가기까지 걸리는 예상 시간 (ms) */
  #timeToGetBehind(opp) {
    const f = this.fighter;
    const rx = f.position.x - opp.position.x;
    const rz = f.position.z - opp.position.z;
    const r = Math.hypot(rx, rz) || 1e-6;
    // 상대 정면 기준 내 각도 → 등 뒤 부채꼴 경계까지 남은 각도
    const cos = (rx * -Math.sin(opp.yaw) + rz * -Math.cos(opp.yaw)) / r;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    const backEdge = Math.PI - (CONFIG.backAttack.angleDeg / 2) * DEG;
    const arc = Math.max(0, backEdge - angle) * Math.max(r, this.fighter.stats.range * CONFIG.bot.preferredRangeRatio);
    return (arc / f.stats.moveSpeed) * 1000;
  }

  /** 등 뒤 돌기 시작. 상대 등 쪽으로 더 가까운 방향으로 돈다. */
  #startFlank(opp, durationMs) {
    const f = this.fighter;
    const tx = opp.position.x - f.position.x;
    const tz = opp.position.z - f.position.z;
    // 접선 (tz, -tx)가 상대 등 방향 (sin yaw, cos yaw)을 향하면 +1
    const along = tz * Math.sin(opp.yaw) - tx * Math.cos(opp.yaw);
    this.flankDir = along === 0 ? (this.rng() < 0.5 ? -1 : 1) : Math.sign(along);
    this.flankUntil = this.time + durationMs;
    this.stance = false;
    if (f.combat.guardHeld) f.guardUp();
  }

  /** 상대 예비동작을 보고 옆으로 돌아 피한다 → 상대 공격은 헛치고, 후딜레이 동안 등 뒤를 노린다 */
  #planSidestep(opp, reactAt, hitAt) {
    this.defendUntil = hitAt + 100;
    this.wantAttackUntil = -Infinity;
    this.#schedule(reactAt - this.time, () => {
      // 상대 후딜레이가 끝날 때까지 돈다
      this.#startFlank(opp, hitAt - this.time + opp.stats.activeMs + opp.stats.recoveryMs);
    });
  }

  /** 타이밍 패링: 판정 예상 시각에 패링 구간 가운데가 오도록 누른다 (난이도별 오차) */
  #planParry(reactAt, hitAt) {
    const f = this.fighter;
    const windowMs = f.stats.parryWindowMs;
    const ideal = hitAt - windowMs / 2 + gaussian(this.rng) * this.d.parryErrorMs;
    const pressAt = Math.max(ideal, reactAt);
    if (pressAt > hitAt) return; // 반응이 늦어서 손쓸 수 없음

    this.defendUntil = hitAt + 150;
    this.wantAttackUntil = -Infinity;
    // 방어 자세로 누르고 있었다면 먼저 뗐다가 다시 눌러야 패링이 나간다 (플레이어와 같은 규칙)
    this.#schedule(pressAt - this.time - 25, () => {
      if (f.combat.guardHeld) f.guardUp();
    });
    this.#schedule(pressAt - this.time, () => {
      // 영리한 봇은 패링 바가 덜 찼으면 패링 대신 그냥 방어를 유지한다
      const holdGuard = this.d.smart && !f.parryReady();
      f.guardDown();
      const releaseAt = holdGuard ? hitAt + 120 : pressAt + 70;
      this.#schedule(releaseAt - this.time, () => {
        if (!this.stance) f.guardUp();
      });
    });
  }

  /** 뒤로 빠져서 상대 공격을 헛치게 만든다 → 이후 ATTACK_ACTIVE 대응에서 빈틈을 노림 */
  #planDodge(reactAt, hitAt) {
    this.defendUntil = hitAt + 100;
    this.#schedule(reactAt - this.time, () => {
      if (this.fighter.combat.guardHeld && !this.stance) this.fighter.guardUp();
      this.retreatUntil = hitAt + 200;
    });
  }

  #attack() {
    const f = this.fighter;
    if (f.combat.guardHeld) {
      f.guardUp();
      this.stance = false;
    }
    return f.tryAttack();
  }

  #isFacing(opp) {
    const f = this.fighter;
    const want = yawToward(f.position.x, f.position.z, opp.position.x, opp.position.z);
    let diff = Math.abs(want - f.yaw) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    return diff < (f.stats.arcDeg / 2) * 0.8 * DEG;
  }

  #reaction() {
    return this.d.reactionMs + (this.rng() * 2 - 1) * this.d.reactionJitterMs;
  }

  #schedule(delayMs, run) {
    this.actions.push({ at: this.time + Math.max(0, delayMs), run });
  }
}
