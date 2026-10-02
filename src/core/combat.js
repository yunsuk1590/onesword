// 공격·방어·패링 판정 (순수 함수)

import { STATE } from './stateMachine.js';

const DEG = Math.PI / 180;

function forwardOf(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** 정면 벡터와 (from → to) 방향 사이 각도 (라디안, 0 ~ π) */
function angleFromForward(from, yaw, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return 0;
  const f = forwardOf(yaw);
  const cos = (dx * f.x + dz * f.z) / dist;
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/**
 * 공격 적중 여부: 사거리 안 + 정면 부채꼴 안.
 * 부채꼴은 상대 몸 반지름만큼 각도 여유를 더 준다 (몸 가장자리에 걸쳐도 맞도록).
 * @param {{x:number, z:number, yaw:number}} attacker
 * @param {{x:number, z:number, radius:number}} target
 */
export function isInAttackArc(attacker, target, range, arcDeg) {
  const dist = Math.hypot(target.x - attacker.x, target.z - attacker.z);
  if (dist > range) return false;
  if (dist < 1e-6) return true;
  const halfArc = (arcDeg / 2) * DEG + Math.atan2(target.radius ?? 0, dist);
  return angleFromForward(attacker, attacker.yaw, target) <= halfArc;
}

/**
 * 백어택 여부: 공격자가 방어자의 등 뒤 부채꼴(backAngleDeg) 안에 있는가.
 * @param {{x:number, z:number}} attackerPos
 * @param {{x:number, z:number, yaw:number}} defender
 */
export function isBackAttack(attackerPos, defender, backAngleDeg) {
  const dist = Math.hypot(attackerPos.x - defender.x, attackerPos.z - defender.z);
  if (dist < 1e-6) return false;
  const angle = angleFromForward(defender, defender.yaw, attackerPos);
  return angle > Math.PI - (backAngleDeg / 2) * DEG;
}

export const OUTCOME = Object.freeze({
  NONE: 'NONE',
  PARRIED: 'PARRIED',
  GUARDED: 'GUARDED',
  HIT: 'HIT',
});

/**
 * 공격이 닿았을 때 결과 계산.
 * @param {Object} p
 * @param {string} p.defenderState 방어자의 현재 상태
 * @param {boolean} p.isBack 백어택인지
 * @param {number} p.damage 기본 대미지 (방어력 등 스탯 반영 후)
 * @param {number} p.attackerRemainingMs 공격자에게 남은 판정+후딜레이 시간 — 피격 경직 시간이 된다
 * @param {Object} p.rules CONFIG의 guard / parry / hit / backAttack 묶음
 * @returns {{ outcome:string, damage:number, attackerStaggerMs:number, defenderStaggerMs:number, hitStopMs:number, backAttack:boolean }}
 */
export function resolveHit({ defenderState, isBack, damage, attackerRemainingMs, rules }) {
  const base = { damage: 0, attackerStaggerMs: 0, defenderStaggerMs: 0, hitStopMs: 0, backAttack: isBack };

  if (defenderState === STATE.DEAD) return { ...base, outcome: OUTCOME.NONE };

  // 패링·방어는 정면(백어택이 아닌 경우)에서만 유효
  if (!isBack && defenderState === STATE.PARRY_WINDOW) {
    return {
      ...base,
      outcome: OUTCOME.PARRIED,
      attackerStaggerMs: rules.parry.attackerStaggerMs,
      hitStopMs: rules.parry.hitStopMs,
    };
  }

  if (!isBack && defenderState === STATE.GUARD) {
    return {
      ...base,
      outcome: OUTCOME.GUARDED,
      damage: damage * rules.guard.damageTaken,
      hitStopMs: rules.guard.hitStopMs,
    };
  }

  return {
    ...base,
    outcome: OUTCOME.HIT,
    damage: damage * (isBack ? rules.backAttack.damageMul : 1),
    // 공격자와 동시에 풀리도록 → 공격속도와 무관하게 연속기 불가
    defenderStaggerMs: Math.max(0, attackerRemainingMs),
    hitStopMs: rules.hit.hitStopMs,
  };
}
