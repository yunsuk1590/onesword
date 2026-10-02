import { describe, it, expect } from 'vitest';
import { isInAttackArc, isBackAttack, resolveHit, OUTCOME } from '../src/core/combat.js';
import { STATE } from '../src/core/stateMachine.js';
import { CONFIG } from '../src/config.js';

// yaw 0 = -Z 방향을 바라봄
const attacker = { x: 0, z: 0, yaw: 0 };
const deg = (d) => (d * Math.PI) / 180;

describe('isInAttackArc', () => {
  it('정면 사거리 안이면 적중', () => {
    expect(isInAttackArc(attacker, { x: 0, z: -2, radius: 0 }, 2.2, 70)).toBe(true);
  });

  it('사거리 경계: 2.2는 적중, 2.21은 빗나감', () => {
    expect(isInAttackArc(attacker, { x: 0, z: -2.2, radius: 0 }, 2.2, 70)).toBe(true);
    expect(isInAttackArc(attacker, { x: 0, z: -2.21, radius: 0 }, 2.2, 70)).toBe(false);
  });

  it('각도 경계: 반지름 0이면 ±35° 안만 적중', () => {
    const at = (a) => ({ x: -Math.sin(deg(a)) * 2, z: -Math.cos(deg(a)) * 2, radius: 0 });
    expect(isInAttackArc(attacker, at(34.9), 2.2, 70)).toBe(true);
    expect(isInAttackArc(attacker, at(-34.9), 2.2, 70)).toBe(true);
    expect(isInAttackArc(attacker, at(35.5), 2.2, 70)).toBe(false);
  });

  it('상대 몸 반지름만큼 각도 여유가 생긴다', () => {
    // 2m 거리에서 반지름 0.4 → 약 11.3° 여유
    const t = { x: -Math.sin(deg(44)) * 2, z: -Math.cos(deg(44)) * 2, radius: 0.4 };
    expect(isInAttackArc(attacker, t, 2.2, 70)).toBe(true);
    expect(isInAttackArc(attacker, { ...t, radius: 0 }, 2.2, 70)).toBe(false);
  });

  it('등 뒤나 옆의 상대는 맞지 않는다', () => {
    expect(isInAttackArc(attacker, { x: 0, z: 1.5, radius: 0.4 }, 2.2, 70)).toBe(false);
    expect(isInAttackArc(attacker, { x: 1.5, z: 0, radius: 0.4 }, 2.2, 70)).toBe(false);
  });

  it('시선 방향을 따라 판정 방향도 돈다', () => {
    const facingRight = { x: 0, z: 0, yaw: -Math.PI / 2 }; // +X를 바라봄
    expect(isInAttackArc(facingRight, { x: 2, z: 0, radius: 0.4 }, 2.2, 70)).toBe(true);
    expect(isInAttackArc(facingRight, { x: 0, z: -2, radius: 0.4 }, 2.2, 70)).toBe(false);
  });
});

describe('isBackAttack', () => {
  const defender = { x: 0, z: 0, yaw: 0 }; // -Z를 바라봄 → 등은 +Z

  it('정면에서 오면 백어택 아님', () => {
    expect(isBackAttack({ x: 0, z: -2 }, defender, 90)).toBe(false);
  });

  it('정확히 등 뒤면 백어택', () => {
    expect(isBackAttack({ x: 0, z: 2 }, defender, 90)).toBe(true);
  });

  it('옆(90°)은 백어택 아님', () => {
    expect(isBackAttack({ x: 2, z: 0 }, defender, 90)).toBe(false);
  });

  it('경계: 등 뒤 기준 좌우 45° 안쪽만 백어택', () => {
    // 정면 기준 각도 a인 위치
    const at = (a) => ({ x: -Math.sin(deg(a)) * 2, z: -Math.cos(deg(a)) * 2 });
    expect(isBackAttack(at(136), defender, 90)).toBe(true);
    expect(isBackAttack(at(-136), defender, 90)).toBe(true);
    expect(isBackAttack(at(134), defender, 90)).toBe(false);
  });
});

describe('resolveHit', () => {
  const base = { damage: 15, attackerRemainingMs: 550, rules: CONFIG };

  it('대기 상태에서 맞으면 전체 대미지 + 경직', () => {
    const r = resolveHit({ ...base, defenderState: STATE.IDLE, isBack: false });
    expect(r.outcome).toBe(OUTCOME.HIT);
    expect(r.damage).toBe(15);
    expect(r.defenderStaggerMs).toBe(550); // 공격자에게 남은 시간과 같음
    expect(r.attackerStaggerMs).toBe(0);
  });

  it('피격 경직은 공격자에게 남은 시간을 따른다 (공격속도가 달라도 동시에 풀림)', () => {
    const fast = resolveHit({ ...base, attackerRemainingMs: 300, defenderState: STATE.IDLE, isBack: false });
    expect(fast.defenderStaggerMs).toBe(300);
    const neg = resolveHit({ ...base, attackerRemainingMs: -5, defenderState: STATE.IDLE, isBack: false });
    expect(neg.defenderStaggerMs).toBe(0);
  });

  it('정면 방어: 대미지 20%, 경직 없음', () => {
    const r = resolveHit({ ...base, defenderState: STATE.GUARD, isBack: false });
    expect(r.outcome).toBe(OUTCOME.GUARDED);
    expect(r.damage).toBeCloseTo(3);
    expect(r.defenderStaggerMs).toBe(0);
  });

  it('패링 구간: 대미지 0, 공격자 경직, 히트스톱', () => {
    const r = resolveHit({ ...base, defenderState: STATE.PARRY_WINDOW, isBack: false });
    expect(r.outcome).toBe(OUTCOME.PARRIED);
    expect(r.damage).toBe(0);
    expect(r.attackerStaggerMs).toBe(CONFIG.parry.attackerStaggerMs);
    expect(r.hitStopMs).toBe(CONFIG.parry.hitStopMs);
  });

  it('등 뒤에서 맞으면 방어되지 않고 1.5배', () => {
    const r = resolveHit({ ...base, defenderState: STATE.GUARD, isBack: true });
    expect(r.outcome).toBe(OUTCOME.HIT);
    expect(r.damage).toBeCloseTo(22.5);
    expect(r.backAttack).toBe(true);
  });

  it('등 뒤에서는 패링도 되지 않는다', () => {
    const r = resolveHit({ ...base, defenderState: STATE.PARRY_WINDOW, isBack: true });
    expect(r.outcome).toBe(OUTCOME.HIT);
  });

  it('경직 중인 상대(카운터 찬스)는 그대로 맞는다', () => {
    const r = resolveHit({ ...base, defenderState: STATE.STAGGERED, isBack: false });
    expect(r.outcome).toBe(OUTCOME.HIT);
    expect(r.damage).toBe(15);
  });

  it('죽은 상대에게는 아무 효과 없음', () => {
    expect(resolveHit({ ...base, defenderState: STATE.DEAD, isBack: false }).outcome).toBe(OUTCOME.NONE);
  });
});
