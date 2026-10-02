// 상태 머신 + 판정 + Fighter를 합친 통합 테스트 (렌더링 없이)
import { describe, it, expect } from 'vitest';
import { Fighter } from '../src/game/fighter.js';
import { Duel } from '../src/game/duel.js';
import { STATE } from '../src/core/stateMachine.js';
import { OUTCOME } from '../src/core/combat.js';
import { CONFIG } from '../src/config.js';
import { deriveStats } from '../src/core/stats.js';

const STEP = 1000 / 120;
// 기본 빌드끼리 한 대 맞았을 때 깎이는 체력 (기본 방어력 반영)
const HIT_DAMAGE = CONFIG.attack.damage * CONFIG.player.damageTakenMul;

/** a는 (0,0)에서 -Z를, b는 (0,-2)에서 +Z를 바라보며 마주 선다 */
function setup() {
  const a = new Fighter({ x: 0, z: 0, yaw: 0, name: 'a' });
  const b = new Fighter({ x: 0, z: -2, yaw: Math.PI, name: 'b' });
  return { a, b, duel: new Duel([a, b]) };
}

function runFor(duel, ms, control) {
  const events = [];
  for (let t = 0; t < ms; t += STEP) events.push(...duel.step(STEP, control));
  return events;
}

const hitsOf = (events) => events.filter((e) => e.type === 'hit');

describe('Duel 통합', () => {
  it('공격은 예비동작이 끝난 뒤에 적중하고, 한 번만 맞는다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    expect(hitsOf(runFor(duel, CONFIG.attack.windupMs - 10))).toHaveLength(0);
    const events = runFor(duel, 600);
    expect(hitsOf(events)).toHaveLength(1);
    expect(b.hp).toBeCloseTo(CONFIG.player.maxHp - HIT_DAMAGE);
  });

  it('공격 직전에 패링하면 공격자가 경직되고 대미지가 없다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - 60);
    b.guardDown(); // 판정 60ms 전에 우클릭
    const events = hitsOf(runFor(duel, 100));
    expect(events).toHaveLength(1);
    expect(events[0].result.outcome).toBe(OUTCOME.PARRIED);
    expect(a.state).toBe(STATE.STAGGERED);
    expect(b.hp).toBe(CONFIG.player.maxHp);
  });

  it('너무 일찍 누르면 패링이 아니라 방어가 된다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    b.guardDown(); // 판정 350ms 전 → 패링 구간(180ms)이 이미 끝남
    const events = hitsOf(runFor(duel, 400));
    expect(events[0].result.outcome).toBe(OUTCOME.GUARDED);
  });

  it('헛패링 후 제한 시간 안에는 패링 대신 방어가 나간다', () => {
    const { a, b, duel } = setup();
    b.guardDown(); // 아무 공격도 없는데 우클릭 → 헛패링
    runFor(duel, 50);
    b.guardUp();
    runFor(duel, 550);
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - 60); // 헛패링 후 약 890ms
    b.guardDown();
    expect(b.state).toBe(STATE.GUARD);
    const events = hitsOf(runFor(duel, 100));
    expect(events[0].result.outcome).toBe(OUTCOME.GUARDED);
  });

  it('패링에 성공하면 곧바로 다시 패링할 수 있다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - 60);
    b.guardDown();
    runFor(duel, 100);
    b.guardUp();
    runFor(duel, 150);
    expect(b.parryReady()).toBe(true);
    b.guardDown();
    expect(b.state).toBe(STATE.PARRY_WINDOW);
  });

  it('패링 후 경직된 상대에게 반격이 들어간다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - 60);
    b.guardDown();
    runFor(duel, 100);
    b.guardUp();
    runFor(duel, 100); // 패링 구간 종료 대기
    expect(b.tryAttack()).toBe(true);
    const events = hitsOf(runFor(duel, 400));
    expect(events[0].attacker).toBe(b);
    expect(events[0].result.outcome).toBe(OUTCOME.HIT);
    expect(a.hp).toBeCloseTo(CONFIG.player.maxHp - HIT_DAMAGE);
  });

  it('등 뒤에서 치면 방어 중이어도 1.5배 대미지', () => {
    const { a, b, duel } = setup();
    b.yaw = 0; // b가 a에게 등을 돌림 (-Z를 바라봄)
    b.guardDown();
    runFor(duel, 200);
    a.tryAttack();
    const events = hitsOf(runFor(duel, 400));
    expect(events[0].result.outcome).toBe(OUTCOME.HIT);
    expect(events[0].result.backAttack).toBe(true);
    expect(b.hp).toBeCloseTo(CONFIG.player.maxHp - HIT_DAMAGE * 1.5);
  });

  it('맞으면 진행 중이던 공격이 끊긴다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, 100);
    b.tryAttack(); // a보다 늦게 시작 → a가 먼저 맞힘
    runFor(duel, 300);
    expect(a.hp).toBe(CONFIG.player.maxHp);
    expect(b.state).toBe(STATE.STAGGERED);
  });

  it('체력이 0이 되면 DEAD, 일정 시간 후 부활', () => {
    const { a, b, duel } = setup();
    b.hp = 10;
    a.tryAttack();
    const events = runFor(duel, 400);
    expect(events.some((e) => e.type === 'ko' && e.fighter === b)).toBe(true);
    expect(b.state).toBe(STATE.DEAD);
    const later = runFor(duel, CONFIG.ko.resetDelayMs + 50);
    expect(later.some((e) => e.type === 'reset')).toBe(true);
    expect(b.hp).toBe(CONFIG.player.maxHp);
    expect(b.state).toBe(STATE.IDLE);
  });

  it('맞힌 쪽과 맞은 쪽은 같은 순간에 다시 행동할 수 있다 (연속기 없음)', () => {
    for (const recoveryMs of [250, 450, 650]) {
      const { a, b, duel } = setup();
      a.stats = { ...a.stats, recoveryMs }; // 공격속도 스탯이 다른 빌드 흉내
      a.tryAttack();
      let aFree = null;
      let bFree = null;
      let hit = false;
      for (let t = 0; t < 2000; t += STEP) {
        const ev = duel.step(STEP);
        if (hitsOf(ev).length) hit = true;
        if (!hit) continue;
        if (aFree === null && a.state === STATE.IDLE) aFree = t;
        if (bFree === null && b.state === STATE.IDLE) bFree = t;
      }
      expect(hit).toBe(true);
      expect(aFree).not.toBeNull();
      expect(bFree).toBe(aFree);
    }
  });

  it('패링 후 반격은 확정이다 (패링 직후 바로 공격하면 상대 경직이 끝나기 전에 맞는다)', () => {
    // 판정이 패링 구간 시작 직후에 들어오는 경우 — 성공 즉시 구간이 끝나므로 기다릴 필요 없음
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - STEP);
    b.guardDown();
    b.guardUp();
    let parried = false;
    let counterHit = null;
    for (let t = 0; t < 2000 && !counterHit; t += STEP) {
      const ev = hitsOf(duel.step(STEP, () => b.tryAttack()));
      if (ev.some((e) => e.result.outcome === OUTCOME.PARRIED)) parried = true;
      counterHit = ev.find((e) => e.attacker === b) ?? null;
    }
    expect(parried).toBe(true);
    expect(counterHit.result.outcome).toBe(OUTCOME.HIT);
  });

  it('패링 성공 직후에는 남은 패링 구간 없이 바로 공격할 수 있다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - 100);
    b.guardDown();
    b.guardUp();
    let parried = false;
    for (let t = 0; t < 300 && !parried; t += STEP) {
      parried = hitsOf(duel.step(STEP)).some((e) => e.result.outcome === OUTCOME.PARRIED);
    }
    expect(parried).toBe(true);
    expect(b.state).toBe(STATE.IDLE);
    expect(b.tryAttack()).toBe(true);
  });

  it('패링 후 반응이 늦어도(400ms) 반격이 막히지 않고 들어간다', () => {
    const { a, b, duel } = setup();
    a.tryAttack();
    runFor(duel, CONFIG.attack.windupMs - 60);
    b.guardDown();
    b.guardUp();
    let parryAt = null;
    let t = 0;
    let counter = null;
    for (; t < 3000 && !counter; t += STEP) {
      const ev = hitsOf(
        duel.step(STEP, () => {
          if (parryAt !== null && t - parryAt >= 400) b.tryAttack(); // 패링을 보고 400ms 뒤 클릭
          // 공격자는 경직이 풀리는 즉시 방어 자세 (가장 영리한 대응)
          if (a.state === STATE.IDLE && !a.combat.guardHeld) a.guardDown();
        }),
      );
      if (parryAt === null && ev.some((e) => e.result.outcome === OUTCOME.PARRIED)) parryAt = t;
      counter = ev.find((e) => e.attacker === b) ?? null;
    }
    expect(counter.result.outcome).toBe(OUTCOME.HIT);
  });

  it('공격속도 1칸(가장 느린 빌드)도 패링 후 400ms 늦게 반격하면 들어간다', () => {
    const slow = deriveStats({ attack: 5, defense: 4, attackSpeed: 1, moveSpeed: 2, range: 3 });
    const fast = deriveStats({ attack: 1, defense: 2, attackSpeed: 5, moveSpeed: 5, range: 2 });
    // 패링하는 쪽이 느린 빌드, 공격하는 쪽이 빠른 빌드 (가장 불리한 조합)
    const a = new Fighter({ x: 0, z: 0, yaw: 0, stats: fast });
    const b = new Fighter({ x: 0, z: -1.6, yaw: Math.PI, stats: slow });
    const duel = new Duel([a, b]);
    a.tryAttack();
    runFor(duel, fast.windupMs - 60);
    b.guardDown();
    b.guardUp();
    let parryAt = null;
    let counter = null;
    for (let t = 0; t < 3000 && !counter; t += STEP) {
      const ev = hitsOf(
        duel.step(STEP, () => {
          if (parryAt !== null && t - parryAt >= 400) b.tryAttack();
          if (a.state === STATE.IDLE && !a.combat.guardHeld) a.guardDown();
        }),
      );
      if (parryAt === null && ev.some((e) => e.result.outcome === OUTCOME.PARRIED)) parryAt = t;
      counter = ev.find((e) => e.attacker === b) ?? null;
    }
    expect(parryAt).not.toBeNull();
    expect(counter.result.outcome).toBe(OUTCOME.HIT);
  });
});
