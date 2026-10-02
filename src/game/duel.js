// 1대1 전투 진행: 상태 타이머 → 조종(입력/AI) → 적중 판정 순서로 한 스텝을 처리하고
// 연출용 이벤트 목록을 돌려준다. (렌더링·사운드는 이벤트를 받아서 처리)

import { CONFIG } from '../config.js';
import { STATE, markAttackHit, onParrySuccess } from '../core/stateMachine.js';
import { isInAttackArc, isBackAttack, resolveHit, OUTCOME } from '../core/combat.js';

export class Duel {
  /**
   * @param {import('./fighter.js').Fighter[]} fighters 두 명
   * @param {{ rules?: Object, autoReset?: boolean }} [options] autoReset: KO 후 자동 부활 (패링 연습용)
   */
  constructor(fighters, { rules = CONFIG, autoReset = true } = {}) {
    this.fighters = fighters;
    this.rules = rules;
    this.autoReset = autoReset;
    this.time = 0;
    this.resetAt = null; // KO 후 자동 재시작 시각 (패링 연습 모드용)
    this.lastStates = fighters.map((f) => f.state);
  }

  /**
   * @param {number} dtMs
   * @param {(dtMs:number) => void} [control] 조종 단계 (플레이어 입력·AI가 명령을 내리고 이동)
   * @param {{ resolveHits?: boolean }} [options] resolveHits: false면 적중 판정을 건너뜀 (라운드 사이 연출 구간)
   * @returns {Array<Object>} 이벤트 목록
   */
  step(dtMs, control, { resolveHits = true } = {}) {
    const events = [];
    this.time += dtMs;

    for (const f of this.fighters) f.tick(dtMs);

    if (this.resetAt !== null && this.time >= this.resetAt) {
      this.resetAt = null;
      for (const f of this.fighters) f.revive();
      events.push({ type: 'reset' });
    }

    control?.(dtMs);

    if (resolveHits) this.#resolveHits(events);
    this.#collectStateChanges(events);
    return events;
  }

  #resolveHits(events) {
    const [a, b] = this.fighters;

    // 동시에 서로 맞히는 경우를 공정하게 처리하려고, 판정은 모두 현재 상태 기준으로 먼저 계산한 뒤 적용한다
    const hits = [];
    for (const [attacker, defender] of [
      [a, b],
      [b, a],
    ]) {
      if (attacker.state !== STATE.ATTACK_ACTIVE || attacker.combat.attackHasHit) continue;
      if (defender.isDead) continue;
      const atk = { x: attacker.position.x, z: attacker.position.z, yaw: attacker.yaw };
      const tgt = { x: defender.position.x, z: defender.position.z, radius: defender.radius };
      if (!isInAttackArc(atk, tgt, attacker.stats.range, attacker.stats.arcDeg)) continue;

      const back = isBackAttack(atk, { ...tgt, yaw: defender.yaw }, this.rules.backAttack.angleDeg);
      const result = resolveHit({
        defenderState: defender.state,
        isBack: back,
        damage: attacker.stats.damage * defender.stats.damageTakenMul,
        attackerRemainingMs: attacker.stats.activeMs - attacker.combat.elapsed + attacker.stats.recoveryMs,
        rules: this.rules,
      });
      hits.push({ attacker, defender, result });
    }

    for (const { attacker, defender, result } of hits) {
      attacker.combat = markAttackHit(attacker.combat); // 한 번의 공격은 한 번만 적중
      if (result.outcome === OUTCOME.NONE) continue;

      if (result.outcome === OUTCOME.PARRIED) defender.combat = onParrySuccess(defender.combat);
      if (result.attackerStaggerMs > 0) attacker.stagger(result.attackerStaggerMs);
      if (result.damage > 0) defender.takeDamage(result.damage);
      if (result.defenderStaggerMs > 0) defender.stagger(result.defenderStaggerMs);
      events.push({ type: 'hit', attacker, defender, result });
    }

    for (const f of this.fighters) {
      if (f.hp <= 0 && !f.isDead) {
        f.die();
        events.push({ type: 'ko', fighter: f });
        if (this.autoReset) this.resetAt = this.time + CONFIG.ko.resetDelayMs;
      }
    }
  }

  #collectStateChanges(events) {
    this.fighters.forEach((f, i) => {
      if (f.state !== this.lastStates[i]) {
        events.push({ type: 'state', fighter: f, from: this.lastStates[i], to: f.state });
        this.lastStates[i] = f.state;
      }
    });
  }
}
