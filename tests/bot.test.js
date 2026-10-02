// AI 봇 시뮬레이션 테스트 (시드 고정 난수로 재현 가능)
import { describe, it, expect } from 'vitest';
import { Fighter } from '../src/game/fighter.js';
import { Duel } from '../src/game/duel.js';
import { Match, PHASE } from '../src/game/match.js';
import { BotController } from '../src/game/bot.js';
import { STATE } from '../src/core/stateMachine.js';
import { OUTCOME } from '../src/core/combat.js';
import { yawToward } from '../src/core/physics.js';
import { seededRandom } from '../src/core/random.js';
import { CONFIG } from '../src/config.js';
import { deriveStats } from '../src/core/stats.js';
import { turnToward } from '../src/core/physics.js';

const STEP = 1000 / 120;
const DIFFICULTIES = ['easy', 'normal', 'hard', '302'];

/**
 * 제자리에서 일정 간격으로 공격만 하는 '샌드백 공격자'를 상대로 봇이 얼마나 패링·방어하는지 센다.
 * 공격자는 항상 봇을 바라보고, 봇이 사거리 안에 있을 때만 공격한다.
 */
function defenseStats(difficulty, seed, durationMs = 120000) {
  const attacker = new Fighter({ x: 0, z: 0, yaw: 0 });
  const botFighter = new Fighter({ x: 0, z: -1.8, yaw: Math.PI });
  const bot = new BotController(botFighter, difficulty, seededRandom(seed));
  const duel = new Duel([attacker, botFighter]);
  const count = { attacks: 0, parried: 0, guarded: 0, hit: 0 };
  let nextAttack = 500;

  for (let t = 0; t < durationMs; t += STEP) {
    const events = duel.step(STEP, (dtMs) => {
      const dt = dtMs / 1000;
      attacker.yaw = yawToward(attacker.position.x, attacker.position.z, botFighter.position.x, botFighter.position.z);
      const dist = Math.hypot(botFighter.position.x - attacker.position.x, botFighter.position.z - attacker.position.z);
      if (t >= nextAttack && dist <= CONFIG.attack.range && attacker.tryAttack()) {
        count.attacks++;
        nextAttack = t + 1500;
      }
      attacker.step(dt, 0, 0, [botFighter]);
      bot.update(dt, attacker);
    });
    for (const e of events) {
      if (e.type !== 'hit' || e.attacker !== attacker) continue;
      if (e.result.outcome === OUTCOME.PARRIED) count.parried++;
      else if (e.result.outcome === OUTCOME.GUARDED) count.guarded++;
      else count.hit++;
    }
    // 죽어도 계속 측정
    for (const f of [attacker, botFighter]) if (f.isDead) f.revive();
  }
  return count;
}

describe('BotController', () => {
  it('난이도가 높을수록 패링 성공률이 높다', () => {
    const rates = DIFFICULTIES.map((d) => {
      // 여러 시드 평균으로 운의 영향을 줄인다
      let parried = 0;
      let landed = 0;
      for (const seed of [1, 2, 3]) {
        const c = defenseStats(d, seed);
        parried += c.parried;
        landed += c.parried + c.guarded + c.hit;
      }
      return parried / Math.max(1, landed);
    });
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    expect(rates[0]).toBeLessThan(0.15); // 쉬움은 거의 패링 못 함
    expect(rates[3]).toBeGreaterThan(0.5); // 302명은 절반 이상 패링
  });

  it('쉬움 봇은 반응이 느려 대부분 그냥 맞는다', () => {
    const c = defenseStats('easy', 7);
    const landed = c.parried + c.guarded + c.hit;
    expect(landed).toBeGreaterThan(10);
    expect(c.hit / landed).toBeGreaterThan(0.5);
  });

  it('봇은 플레이어와 같은 규칙을 쓴다: 패링 연타 제한도 똑같이 적용', () => {
    const f = new Fighter();
    const bot = new BotController(f, '302', seededRandom(1));
    // 봇도 Fighter의 공개 명령만 쓴다 → 헛패링 후 1초 안에는 방어만 나간다
    f.guardDown();
    f.guardUp();
    f.tick(300);
    f.guardDown();
    expect(f.state).toBe(STATE.GUARD);
    expect(bot.fighter).toBe(f);
  });

  it('사거리 밖에서 시작해도 다가와서 공격한다', () => {
    const target = new Fighter({ x: 0, z: 5 });
    const botFighter = new Fighter({ x: 0, z: -5, yaw: 0 });
    const bot = new BotController(botFighter, 'normal', seededRandom(3));
    const duel = new Duel([target, botFighter]);
    let attacked = false;
    for (let t = 0; t < 8000 && !attacked; t += STEP) {
      const ev = duel.step(STEP, (dtMs) => bot.update(dtMs / 1000, target));
      if (ev.some((e) => e.type === 'hit' && e.attacker === botFighter)) attacked = true;
    }
    expect(attacked).toBe(true);
  });

  it('이동속도가 빠른 봇일수록 방어만 하는 상대의 등 뒤를 더 많이 잡는다', () => {
    /** 계속 방어 자세로 버티며 천천히(2 rad/s) 봇 쪽으로 도는 상대를 60초 동안 상대한다 */
    function backAttacks(moveSpeedLevel, seed) {
      const rest = 15 - 3 - 3 - 3 - moveSpeedLevel; // 나머지 칸은 방어력에
      const stats = deriveStats({ attack: 3, defense: rest, attackSpeed: 3, moveSpeed: moveSpeedLevel, range: 3 });
      const turtle = new Fighter({ x: 0, z: 0, yaw: 0 });
      const botFighter = new Fighter({ x: 0, z: -1.8, yaw: Math.PI, stats });
      const bot = new BotController(botFighter, 'hard', seededRandom(seed));
      const duel = new Duel([turtle, botFighter]);
      let count = 0;
      for (let t = 0; t < 60000; t += STEP) {
        const ev = duel.step(STEP, (dtMs) => {
          const dt = dtMs / 1000;
          if (!turtle.combat.guardHeld) turtle.guardDown();
          const want = yawToward(turtle.position.x, turtle.position.z, botFighter.position.x, botFighter.position.z);
          turtle.yaw = turnToward(turtle.yaw, want, 2 * dt);
          turtle.step(dt, 0, 0, [botFighter]);
          bot.update(dt, turtle);
        });
        count += ev.filter((e) => e.type === 'hit' && e.attacker === botFighter && e.result.backAttack).length;
        for (const f of [turtle, botFighter]) if (f.isDead) f.revive();
      }
      return count;
    }
    let slow = 0;
    let fast = 0;
    for (const seed of [1, 2, 3]) {
      slow += backAttacks(1, seed);
      fast += backAttacks(5, seed);
    }
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('봇 vs 봇 경기가 끝까지 진행된다 (모든 난이도)', () => {
    for (const [i, d] of DIFFICULTIES.entries()) {
      const a = new Fighter();
      const b = new Fighter();
      const botA = new BotController(a, d, seededRandom(10 + i));
      const botB = new BotController(b, 'normal', seededRandom(20 + i));
      const match = new Match([a, b], { spawns: [CONFIG.playerSpawn, CONFIG.opponentSpawn] });
      match.start();
      let end = null;
      const limit = (CONFIG.match.roundTimeSec * 1000 + 6000) * CONFIG.match.maxRounds;
      for (let t = 0; t < limit && !end; t += STEP) {
        const ev = match.step(STEP, (dtMs) => {
          botA.update(dtMs / 1000, b);
          botB.update(dtMs / 1000, a);
        });
        if (ev.some((e) => e.type === 'roundStart')) {
          botA.reset();
          botB.reset();
        }
        end = ev.find((e) => e.type === 'matchEnd') ?? null;
      }
      expect(end, `${d} 경기 종료`).not.toBeNull();
      expect(match.phase).toBe(PHASE.MATCH_END);
    }
  });
});
