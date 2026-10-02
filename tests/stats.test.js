import { describe, it, expect } from 'vitest';
import {
  STAT_KEYS,
  defaultBuild,
  buildTotal,
  validateBuild,
  changeStat,
  deriveStats,
} from '../src/core/stats.js';
import { CONFIG } from '../src/config.js';

const build = (attack, defense, attackSpeed, moveSpeed, range) => ({ attack, defense, attackSpeed, moveSpeed, range });

describe('기본 빌드', () => {
  it('모든 스탯 3칸 = 총 15칸', () => {
    const b = defaultBuild();
    expect(STAT_KEYS.every((k) => b[k] === 3)).toBe(true);
    expect(buildTotal(b)).toBe(CONFIG.stats.total);
    expect(validateBuild(b)).toEqual([]);
  });

  it('3칸 수치 = config 기본값 (표와 기본값이 어긋나지 않도록)', () => {
    const s = deriveStats(defaultBuild());
    expect(s.damage).toBe(CONFIG.attack.damage);
    expect(s.damageTakenMul).toBe(CONFIG.player.damageTakenMul);
    expect(s.windupMs).toBe(CONFIG.attack.windupMs);
    expect(s.recoveryMs).toBe(CONFIG.attack.recoveryMs);
    expect(s.moveSpeed).toBe(CONFIG.player.moveSpeed);
    expect(s.range).toBe(CONFIG.attack.range);
  });

  it('인자 없이 호출하면 기본 빌드', () => {
    expect(deriveStats()).toEqual(deriveStats(defaultBuild()));
  });
});

describe('validateBuild', () => {
  it('15칸을 다 쓰지 않으면 오류', () => {
    expect(validateBuild(build(3, 3, 3, 3, 2))).toHaveLength(1);
  });

  it('한 스탯이 0칸이나 6칸이면 오류', () => {
    expect(validateBuild(build(0, 3, 4, 4, 4)).length).toBeGreaterThan(0);
    expect(validateBuild(build(6, 1, 3, 3, 2)).length).toBeGreaterThan(0);
  });

  it('정수가 아니거나 빠진 스탯은 오류', () => {
    expect(validateBuild({ attack: 3 }).length).toBeGreaterThan(0);
    expect(validateBuild(build(2.5, 3.5, 3, 3, 3)).length).toBeGreaterThan(0);
    expect(validateBuild(null).length).toBeGreaterThan(0);
  });

  it('봇 프리셋은 모두 규칙에 맞다', () => {
    for (const [key, preset] of Object.entries(CONFIG.bot.builds)) {
      expect(validateBuild(preset.stats), key).toEqual([]);
    }
  });
});

describe('changeStat', () => {
  it('합계 15칸이 꽉 차면 더 올릴 수 없다', () => {
    const b = defaultBuild();
    expect(changeStat(b, 'attack', 1)).toBe(b);
  });

  it('내린 만큼 다른 스탯을 올릴 수 있다', () => {
    let b = changeStat(defaultBuild(), 'defense', -1);
    expect(buildTotal(b)).toBe(14);
    b = changeStat(b, 'attack', 1);
    expect(b.attack).toBe(4);
    expect(buildTotal(b)).toBe(15);
  });

  it('1칸 아래, 5칸 위로는 못 간다', () => {
    const low = build(1, 3, 4, 4, 3);
    expect(changeStat(low, 'attack', -1)).toBe(low);
    const high = build(5, 1, 3, 3, 2); // 14칸 — 합계 여유는 있지만 공격력이 이미 5칸
    expect(changeStat(high, 'attack', 1)).toBe(high);
  });
});

describe('deriveStats', () => {
  it('칸이 높을수록 좋아진다', () => {
    for (let lv = 1; lv < 5; lv++) {
      const a = deriveStats(build(lv, lv, lv, lv, lv));
      const b = deriveStats(build(lv + 1, lv + 1, lv + 1, lv + 1, lv + 1));
      expect(b.damage).toBeGreaterThan(a.damage);
      expect(b.damageTakenMul).toBeLessThan(a.damageTakenMul);
      expect(b.recoveryMs).toBeLessThan(a.recoveryMs);
      expect(b.windupMs).toBeLessThanOrEqual(a.windupMs);
      expect(b.moveSpeed).toBeGreaterThan(a.moveSpeed);
      expect(b.range).toBeGreaterThan(a.range);
    }
  });

  it('공격속도는 후딜레이를 크게, 예비동작은 조금만 줄인다', () => {
    const slow = deriveStats(build(3, 3, 1, 3, 3));
    const fast = deriveStats(build(3, 3, 5, 3, 3));
    const recoveryGain = slow.recoveryMs - fast.recoveryMs;
    const windupGain = slow.windupMs - fast.windupMs;
    expect(recoveryGain).toBeGreaterThan(windupGain * 2);
  });

  it('예비동작은 하한선 아래로 내려가지 않는다', () => {
    const config = structuredClone(CONFIG);
    config.stats.table.attackSpeed.windupMs = [300, 250, 200, 150, 100];
    expect(deriveStats(build(3, 3, 5, 2, 2), config).windupMs).toBe(CONFIG.stats.minWindupMs);
  });

  it('공격속도 5칸이어도 막히면 여전히 반격당할 여지가 있다 (방어 후 반격 가능 시간 > 0)', () => {
    // 막힌 순간 공격자에게 남은 시간 vs 상대의 예비동작
    const fast = deriveStats(build(1, 2, 5, 5, 2));
    const remaining = fast.activeMs + fast.recoveryMs;
    expect(remaining).toBeGreaterThan(CONFIG.stats.minWindupMs);
  });

  it('범위를 벗어난 칸 수는 가까운 칸으로 맞춘다', () => {
    const s = deriveStats(build(9, 0, 3, 3, 3));
    expect(s.damage).toBe(CONFIG.stats.table.attack.damage[4]);
    expect(s.damageTakenMul).toBe(CONFIG.stats.table.defense.damageTakenMul[0]);
  });
});
