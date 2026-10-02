// 스탯 칸 → 실제 수치 변환 (순수 함수)
//
// 빌드(build) = { attack, defense, attackSpeed, moveSpeed, range } 각 1~5칸, 합계 15칸.
// 3칸이 config 기본값이므로 모든 스탯 3칸이면 기본 캐릭터와 같다.

import { CONFIG } from '../config.js';

export const STAT_KEYS = Object.freeze(['attack', 'defense', 'attackSpeed', 'moveSpeed', 'range']);

export const STAT_LABELS = Object.freeze({
  attack: '공격력',
  defense: '방어력',
  attackSpeed: '공격속도',
  moveSpeed: '이동속도',
  range: '공격범위',
});

/** 모든 스탯이 기본 칸수인 빌드 */
export function defaultBuild(config = CONFIG) {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, config.stats.defaultLevel]));
}

export function buildTotal(build) {
  return STAT_KEYS.reduce((sum, k) => sum + (build[k] ?? 0), 0);
}

/**
 * 빌드 규칙 검사. 문제가 없으면 빈 배열.
 * @returns {string[]} 오류 메시지 목록
 */
export function validateBuild(build, config = CONFIG) {
  const { min, max, total } = config.stats;
  const errors = [];
  if (!build || typeof build !== 'object') return ['빌드 정보가 없습니다'];
  for (const k of STAT_KEYS) {
    const v = build[k];
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`${STAT_LABELS[k]}은(는) ${min}~${max}칸이어야 합니다`);
  }
  const sum = buildTotal(build);
  if (errors.length === 0 && sum !== total) errors.push(`총 ${total}칸을 모두 써야 합니다 (현재 ${sum}칸)`);
  return errors;
}

/**
 * 스탯 한 칸 올리기/내리기. 규칙(1~5칸, 합계 15칸 이하)을 어기면 원래 빌드를 그대로 반환.
 */
export function changeStat(build, key, delta, config = CONFIG) {
  const { min, max, total } = config.stats;
  const next = build[key] + delta;
  if (next < min || next > max) return build;
  if (delta > 0 && buildTotal(build) + delta > total) return build;
  return { ...build, [key]: next };
}

/**
 * 빌드 → 전투 수치. 상태 머신·판정 함수는 이 객체만 보고 동작하므로 캐릭터마다 다른 값을 줄 수 있다.
 * (칸 수가 범위를 벗어나면 가장 가까운 칸으로 맞춘다)
 */
export function deriveStats(build = defaultBuild(), config = CONFIG) {
  const { min, max, table, minWindupMs } = config.stats;
  const idx = (k) => Math.min(max, Math.max(min, Math.round(build[k] ?? config.stats.defaultLevel))) - 1;

  return {
    maxHp: config.player.maxHp,
    moveSpeed: table.moveSpeed.moveSpeed[idx('moveSpeed')],
    jumpPower: config.player.jumpPower,
    damage: table.attack.damage[idx('attack')],
    damageTakenMul: table.defense.damageTakenMul[idx('defense')],
    windupMs: Math.max(minWindupMs, table.attackSpeed.windupMs[idx('attackSpeed')]),
    activeMs: config.attack.activeMs,
    recoveryMs: table.attackSpeed.recoveryMs[idx('attackSpeed')],
    range: table.range.range[idx('range')],
    arcDeg: config.attack.arcDeg,
    parryWindowMs: config.parry.windowMs,
    parryRetryMs: config.parry.retryCooldownMs,
  };
}

/** 빌드 편집 화면에 보여줄 스탯별 수치 설명 */
export function describeStat(key, stats) {
  switch (key) {
    case 'attack':
      return `대미지 ${stats.damage}`;
    case 'defense':
      return `받는 대미지 ${Math.round(stats.damageTakenMul * 100)}%`;
    case 'attackSpeed':
      return `예비 ${stats.windupMs} · 후딜 ${stats.recoveryMs}ms`;
    case 'moveSpeed':
      return `${stats.moveSpeed} m/s`;
    case 'range':
      return `${stats.range} m`;
    default:
      return '';
  }
}
