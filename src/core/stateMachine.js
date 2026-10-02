// 캐릭터 전투 상태 전이 (순수 함수)
//
// 모든 함수는 상태 객체를 직접 바꾸지 않고 새 객체를 반환한다.
// 명령이 거부되면 입력받은 객체를 그대로 반환하므로 `next !== prev`로 수락 여부를 알 수 있다.

export const STATE = Object.freeze({
  IDLE: 'IDLE',
  ATTACK_WINDUP: 'ATTACK_WINDUP',
  ATTACK_ACTIVE: 'ATTACK_ACTIVE',
  ATTACK_RECOVERY: 'ATTACK_RECOVERY',
  GUARD: 'GUARD',
  PARRY_WINDOW: 'PARRY_WINDOW',
  STAGGERED: 'STAGGERED',
  STUNNED: 'STUNNED', // 지속시간 기반 행동불가. 현재는 발생 요인 없음 (추후 확장용)
  DEAD: 'DEAD',
});

const S = STATE;

// 한 번의 tick에서 연쇄 전이를 허용하는 최대 횟수 (무한 루프 방지)
const MAX_CHAIN = 8;

/**
 * @typedef {Object} CombatState
 * @property {string} state 현재 상태
 * @property {number} elapsed 현재 상태에 들어온 뒤 지난 시간 (ms)
 * @property {number} duration STAGGERED/STUNNED 같은 가변 길이 상태의 지속 시간 (ms)
 * @property {number} time 이 캐릭터의 누적 전투 시간 (ms) — 패링 연타 방지 계산용
 * @property {boolean} guardHeld 우클릭을 누르고 있는지
 * @property {number} lastParryAt 마지막 패링 시도 시각 (time 기준)
 * @property {boolean} attackHasHit 이번 공격이 이미 적중했는지 (1회 적중 제한)
 */

export function createCombatState(time = 0) {
  return {
    state: S.IDLE,
    elapsed: 0,
    duration: 0,
    time,
    guardHeld: false,
    lastParryAt: -Infinity,
    attackHasHit: false,
  };
}

function enter(s, state, extra = {}) {
  return { ...s, state, elapsed: 0, duration: 0, ...extra };
}

/** 행동이 끝났을 때: 우클릭을 누르고 있으면 방어, 아니면 대기 */
function settle(s) {
  return enter(s, s.guardHeld ? S.GUARD : S.IDLE);
}

/** 현재 상태의 길이(ms). 시간으로 끝나지 않는 상태는 Infinity. */
export function stateDuration(s, stats) {
  switch (s.state) {
    case S.ATTACK_WINDUP:
      return stats.windupMs;
    case S.ATTACK_ACTIVE:
      return stats.activeMs;
    case S.ATTACK_RECOVERY:
      return stats.recoveryMs;
    case S.PARRY_WINDOW:
      return stats.parryWindowMs;
    case S.STAGGERED:
    case S.STUNNED:
      return s.duration;
    default:
      return Infinity;
  }
}

function advance(s) {
  switch (s.state) {
    case S.ATTACK_WINDUP:
      return enter(s, S.ATTACK_ACTIVE, { attackHasHit: false });
    case S.ATTACK_ACTIVE:
      return enter(s, S.ATTACK_RECOVERY);
    default:
      // 후딜레이·패링 구간·경직·스턴이 끝나면 대기(또는 방어)로
      return settle(s);
  }
}

/**
 * 시간 진행. 상태 길이를 넘긴 시간은 다음 상태로 이월해서 프레임 간격과 무관하게 타이밍이 정확하다.
 */
export function tickCombat(s, dtMs, stats) {
  let next = { ...s, time: s.time + dtMs, elapsed: s.elapsed + dtMs };
  for (let i = 0; i < MAX_CHAIN; i++) {
    const limit = stateDuration(next, stats);
    if (next.elapsed < limit) break;
    const overflow = next.elapsed - limit;
    next = { ...advance(next), elapsed: overflow };
  }
  return next;
}

/** 좌클릭: 대기·방어 중에만 공격 시작 가능 */
export function pressAttack(s) {
  if (s.state !== S.IDLE && s.state !== S.GUARD) return s;
  return enter(s, S.ATTACK_WINDUP, { attackHasHit: false });
}

/**
 * 우클릭 누름.
 * - 대기 중이고 연타 방지 시간이 지났으면 → 패링 구간
 * - 대기 중이지만 연타 방지 시간 안이면 → 일반 방어만
 * - 그 외 상태(공격 중, 경직 등) → 누르고 있다는 것만 기록. 행동이 끝나면 방어로 넘어간다.
 */
export function pressGuard(s, stats) {
  if (s.guardHeld) return s;
  const held = { ...s, guardHeld: true };
  if (s.state !== S.IDLE) return held;
  if (s.time - s.lastParryAt >= stats.parryRetryMs) {
    return enter(held, S.PARRY_WINDOW, { lastParryAt: s.time });
  }
  return enter(held, S.GUARD);
}

/**
 * 우클릭 뗌.
 * 방어 중이면 바로 대기로. 패링 구간은 떼어도 끝까지 유지된다 (짧게 '톡' 누르는 패링 허용).
 */
export function releaseGuard(s) {
  if (!s.guardHeld) return s;
  const released = { ...s, guardHeld: false };
  return s.state === S.GUARD ? enter(released, S.IDLE) : released;
}

/** 경직·스턴 부여. 진행 중이던 공격은 취소된다. */
export function applyStagger(s, kind, durationMs) {
  if (s.state === S.DEAD) return s;
  return enter(s, kind, { duration: durationMs });
}

/**
 * 패링 성공 시:
 * - 연타 방지 제한을 즉시 풀어준다 (헛패링만 제한받도록)
 * - 패링 구간을 바로 끝내서 곧장 반격할 수 있게 한다 (남은 구간 때문에 반격이 늦어지지 않도록)
 */
export function onParrySuccess(s) {
  const refunded = { ...s, lastParryAt: -Infinity };
  return s.state === S.PARRY_WINDOW ? settle(refunded) : refunded;
}

/** 패링 재시도 가능까지 진행률 0~1 (1이면 지금 패링 가능) */
export function parryCharge(s, stats) {
  if (stats.parryRetryMs <= 0) return 1;
  return Math.min(1, Math.max(0, (s.time - s.lastParryAt) / stats.parryRetryMs));
}

export function markAttackHit(s) {
  return { ...s, attackHasHit: true };
}

export function kill(s) {
  return enter(s, S.DEAD);
}

export function revive(s) {
  return settle({ ...s, attackHasHit: false });
}

export function isAttacking(state) {
  return state === S.ATTACK_WINDUP || state === S.ATTACK_ACTIVE || state === S.ATTACK_RECOVERY;
}

/** 상태별 이동 속도 배율 */
export function moveSpeedMultiplier(state, rules) {
  switch (state) {
    case S.IDLE:
      return 1;
    case S.GUARD:
    case S.PARRY_WINDOW:
      return rules.guard.moveSpeedMul;
    case S.ATTACK_WINDUP:
    case S.ATTACK_ACTIVE:
    case S.ATTACK_RECOVERY:
      return rules.attack.moveSpeedMul;
    default:
      // 경직·스턴·사망: 이동 불가
      return 0;
  }
}

export function canJump(state) {
  return state === S.IDLE || state === S.GUARD || state === S.PARRY_WINDOW;
}
