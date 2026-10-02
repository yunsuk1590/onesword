import { describe, it, expect } from 'vitest';
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
  onParrySuccess,
  parryCharge,
  moveSpeedMultiplier,
  canJump,
} from '../src/core/stateMachine.js';

const stats = {
  windupMs: 250,
  activeMs: 100,
  recoveryMs: 350,
  parryWindowMs: 150,
  parryRetryMs: 400,
};

const rules = { guard: { moveSpeedMul: 0.5 }, attack: { moveSpeedMul: 0.4 } };

/** 작은 간격으로 나눠서 시간 진행 (실제 게임 루프처럼) */
function run(s, ms, step = 1) {
  let t = 0;
  while (t < ms) {
    const d = Math.min(step, ms - t);
    s = tickCombat(s, d, stats);
    t += d;
  }
  return s;
}

describe('공격 흐름', () => {
  it('IDLE → 예비동작 → 판정 → 후딜레이 → IDLE', () => {
    let s = pressAttack(createCombatState());
    expect(s.state).toBe(STATE.ATTACK_WINDUP);
    s = run(s, 249);
    expect(s.state).toBe(STATE.ATTACK_WINDUP);
    s = run(s, 1);
    expect(s.state).toBe(STATE.ATTACK_ACTIVE);
    s = run(s, 100);
    expect(s.state).toBe(STATE.ATTACK_RECOVERY);
    s = run(s, 350);
    expect(s.state).toBe(STATE.IDLE);
  });

  it('큰 시간 간격으로 진행해도 남는 시간이 다음 상태로 이월된다', () => {
    let s = pressAttack(createCombatState());
    s = tickCombat(s, 300, stats); // windup 250 + active 50
    expect(s.state).toBe(STATE.ATTACK_ACTIVE);
    expect(s.elapsed).toBe(50);
  });

  it('공격 중에는 다시 공격할 수 없다 (같은 객체 반환)', () => {
    const s = pressAttack(createCombatState());
    expect(pressAttack(s)).toBe(s);
  });

  it('공격 판정 구간에 들어가면 적중 기록이 초기화된다', () => {
    let s = pressAttack(createCombatState());
    s = { ...s, attackHasHit: true };
    s = run(s, 250);
    expect(s.state).toBe(STATE.ATTACK_ACTIVE);
    expect(s.attackHasHit).toBe(false);
  });

  it('방어 중에도 공격을 시작할 수 있다', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 200); // 패링 구간 끝 → GUARD
    expect(s.state).toBe(STATE.GUARD);
    expect(pressAttack(s).state).toBe(STATE.ATTACK_WINDUP);
  });

  it('공격이 끝났을 때 우클릭을 누르고 있으면 방어로 넘어간다 (패링 구간 없이)', () => {
    let s = pressAttack(createCombatState());
    s = pressGuard(s, stats);
    expect(s.state).toBe(STATE.ATTACK_WINDUP);
    s = run(s, 700);
    expect(s.state).toBe(STATE.GUARD);
  });
});

describe('패링 구간', () => {
  it('우클릭을 누르면 즉시 PARRY_WINDOW', () => {
    const s = pressGuard(createCombatState(), stats);
    expect(s.state).toBe(STATE.PARRY_WINDOW);
  });

  it('경계값: 149ms까지는 패링 구간, 150ms에 끝난다', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 149);
    expect(s.state).toBe(STATE.PARRY_WINDOW);
    s = run(s, 1);
    expect(s.state).not.toBe(STATE.PARRY_WINDOW);
  });

  it('계속 누르고 있으면 패링 구간 후 GUARD', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 150);
    expect(s.state).toBe(STATE.GUARD);
  });

  it('구간 중에 떼도 패링 구간은 끝까지 유지되고, 끝나면 IDLE', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 50);
    s = releaseGuard(s);
    expect(s.state).toBe(STATE.PARRY_WINDOW);
    s = run(s, 99);
    expect(s.state).toBe(STATE.PARRY_WINDOW);
    s = run(s, 1);
    expect(s.state).toBe(STATE.IDLE);
  });

  it('방어 중 우클릭을 떼면 IDLE', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 200);
    expect(releaseGuard(s).state).toBe(STATE.IDLE);
  });
});

describe('패링 연타 방지', () => {
  it('이전 패링 시도 후 400ms 안에 다시 누르면 일반 방어만 된다', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 50);
    s = releaseGuard(s);
    s = run(s, 250); // 시도 후 300ms
    s = pressGuard(s, stats);
    expect(s.state).toBe(STATE.GUARD);
  });

  it('경계값: 399ms에는 방어, 400ms에는 패링', () => {
    let s = pressGuard(createCombatState(), stats);
    s = releaseGuard(s);
    s = run(s, 399);
    expect(pressGuard(s, stats).state).toBe(STATE.GUARD);
    s = run(s, 1);
    expect(pressGuard(s, stats).state).toBe(STATE.PARRY_WINDOW);
  });

  it('쿨타임 중에 누른 방어는 패링 시도로 치지 않는다 (쿨타임이 연장되지 않음)', () => {
    let s = pressGuard(createCombatState(), stats);
    s = releaseGuard(run(s, 10));
    s = run(s, 290); // 시도 후 300ms
    s = releaseGuard(pressGuard(s, stats)); // 방어만 — 시도 아님
    s = run(s, 100); // 첫 시도 후 400ms
    expect(pressGuard(s, stats).state).toBe(STATE.PARRY_WINDOW);
  });

  it('공격 중에 우클릭을 눌러도 패링 구간은 생기지 않는다', () => {
    let s = pressAttack(createCombatState());
    s = pressGuard(s, stats);
    expect(s.state).toBe(STATE.ATTACK_WINDUP);
    expect(s.lastParryAt).toBe(-Infinity);
  });
});

describe('패링 성공 보상', () => {
  it('패링에 성공하면 제한이 풀려 바로 다시 패링할 수 있다', () => {
    let s = pressGuard(createCombatState(), stats);
    s = releaseGuard(run(s, 200));
    expect(pressGuard(s, stats).state).toBe(STATE.GUARD); // 성공 처리 전: 제한 중
    s = onParrySuccess(s);
    expect(pressGuard(s, stats).state).toBe(STATE.PARRY_WINDOW);
  });

  it('패링에 성공하면 패링 구간이 바로 끝나서 즉시 공격할 수 있다', () => {
    let s = pressGuard(createCombatState(), stats);
    s = run(s, 20);
    s = onParrySuccess(releaseGuard(s));
    expect(s.state).toBe(STATE.IDLE);
    expect(pressAttack(s).state).toBe(STATE.ATTACK_WINDUP);
  });

  it('패링 성공 후 우클릭을 계속 누르고 있으면 방어로', () => {
    let s = pressGuard(createCombatState(), stats);
    s = onParrySuccess(run(s, 20));
    expect(s.state).toBe(STATE.GUARD);
  });

  it('패링 바 진행률', () => {
    let s = pressGuard(createCombatState(), stats);
    expect(parryCharge(s, stats)).toBe(0);
    s = run(s, 200);
    expect(parryCharge(s, stats)).toBeCloseTo(0.5);
    s = run(s, 300);
    expect(parryCharge(s, stats)).toBe(1);
    expect(parryCharge(createCombatState(), stats)).toBe(1);
  });
});

describe('경직 / 사망', () => {
  it('경직은 진행 중인 공격을 취소하고, 시간이 지나면 풀린다', () => {
    let s = pressAttack(createCombatState());
    s = applyStagger(s, STATE.STAGGERED, 700);
    expect(s.state).toBe(STATE.STAGGERED);
    s = run(s, 699);
    expect(s.state).toBe(STATE.STAGGERED);
    s = run(s, 1);
    expect(s.state).toBe(STATE.IDLE);
  });

  it('경직 중에는 공격·패링을 할 수 없다', () => {
    const s = applyStagger(createCombatState(), STATE.STAGGERED, 700);
    expect(pressAttack(s)).toBe(s);
    expect(pressGuard(s, stats).state).toBe(STATE.STAGGERED);
  });

  it('스턴도 같은 규칙으로 동작한다', () => {
    let s = applyStagger(createCombatState(), STATE.STUNNED, 300);
    expect(pressAttack(s)).toBe(s);
    s = run(s, 300);
    expect(s.state).toBe(STATE.IDLE);
  });

  it('사망하면 시간이 지나도 그대로이고, 경직도 걸리지 않는다', () => {
    let s = kill(createCombatState());
    s = run(s, 5000, 50);
    expect(s.state).toBe(STATE.DEAD);
    expect(applyStagger(s, STATE.STAGGERED, 100).state).toBe(STATE.DEAD);
    expect(pressAttack(s)).toBe(s);
  });

  it('부활하면 IDLE', () => {
    expect(revive(kill(createCombatState())).state).toBe(STATE.IDLE);
  });
});

describe('이동·점프 제한', () => {
  it('상태별 이동 속도 배율', () => {
    expect(moveSpeedMultiplier(STATE.IDLE, rules)).toBe(1);
    expect(moveSpeedMultiplier(STATE.GUARD, rules)).toBe(0.5);
    expect(moveSpeedMultiplier(STATE.ATTACK_WINDUP, rules)).toBe(0.4);
    expect(moveSpeedMultiplier(STATE.STAGGERED, rules)).toBe(0);
    expect(moveSpeedMultiplier(STATE.DEAD, rules)).toBe(0);
  });

  it('공격 중·경직 중에는 점프 불가', () => {
    expect(canJump(STATE.IDLE)).toBe(true);
    expect(canJump(STATE.GUARD)).toBe(true);
    expect(canJump(STATE.ATTACK_RECOVERY)).toBe(false);
    expect(canJump(STATE.STAGGERED)).toBe(false);
  });
});
