import { describe, it, expect } from 'vitest';
import { Fighter } from '../src/game/fighter.js';
import { Match, PHASE } from '../src/game/match.js';
import { STATE } from '../src/core/stateMachine.js';
import { CONFIG } from '../src/config.js';

const STEP = 50;
const m = CONFIG.match;

function setup() {
  const a = new Fighter({ name: 'a' });
  const b = new Fighter({ name: 'b' });
  const match = new Match([a, b], { spawns: [CONFIG.playerSpawn, CONFIG.opponentSpawn] });
  const events = match.start();
  return { a, b, match, events };
}

function runFor(match, ms, control) {
  const events = [];
  for (let t = 0; t < ms; t += STEP) events.push(...match.step(STEP, control));
  return events;
}

/** FIGHT 단계까지 진행 */
function toFight(match) {
  return runFor(match, m.introMs);
}

/** 해당 쪽 체력을 0으로 만들어 KO */
function knockOut(match, fighter) {
  fighter.hp = 0;
  return match.step(STEP);
}

describe('Match', () => {
  it('시작하면 1라운드 INTRO, 일정 시간 뒤 FIGHT', () => {
    const { match, events } = setup();
    expect(events).toContainEqual({ type: 'roundStart', round: 1 });
    expect(match.phase).toBe(PHASE.INTRO);
    const ev = toFight(match);
    expect(ev.some((e) => e.type === 'fight')).toBe(true);
    expect(match.phase).toBe(PHASE.FIGHT);
  });

  it('INTRO 중에는 조작(control)이 호출되지 않는다', () => {
    const { match } = setup();
    let called = 0;
    runFor(match, m.introMs - STEP, () => called++);
    expect(called).toBe(0);
    runFor(match, STEP * 3, () => called++);
    expect(called).toBeGreaterThan(0);
  });

  it('시작 위치에서 서로 마주 본다', () => {
    const { a, b } = setup();
    expect(a.position).toMatchObject({ x: CONFIG.playerSpawn.x, z: CONFIG.playerSpawn.z });
    expect(b.position).toMatchObject({ x: CONFIG.opponentSpawn.x, z: CONFIG.opponentSpawn.z });
    expect(Math.abs(Math.abs(a.yaw - b.yaw) - Math.PI)).toBeCloseTo(0);
  });

  it('KO되면 상대가 라운드를 가져가고, 다음 라운드는 처음 상태로 시작', () => {
    const { a, b, match } = setup();
    toFight(match);
    a.position.x = 3;
    b.hp = 40;
    const ev = knockOut(match, b);
    const end = ev.find((e) => e.type === 'roundEnd');
    expect(end.winner).toBe(a);
    expect(end.reason).toBe('ko');
    expect(match.wins).toEqual([1, 0]);
    expect(match.phase).toBe(PHASE.ROUND_END);

    const next = runFor(match, m.roundEndMs);
    expect(next).toContainEqual({ type: 'roundStart', round: 2 });
    expect(b.hp).toBe(CONFIG.player.maxHp);
    expect(b.state).toBe(STATE.IDLE);
    expect(a.position.x).toBe(CONFIG.playerSpawn.x);
  });

  it('라운드 종료 후에는 공격이 들어가지 않는다', () => {
    const { a, b, match } = setup();
    toFight(match);
    // 서로 붙여 놓고 a가 공격하는 도중 라운드 종료
    a.position.x = 0; a.position.z = 0; a.yaw = 0;
    b.position.x = 0; b.position.z = -1.5;
    a.tryAttack();
    b.hp = 0;
    match.step(STEP); // b KO → ROUND_END
    a.hp = 50;
    const hpBefore = a.hp;
    runFor(match, 600);
    expect(a.hp).toBe(hpBefore);
  });

  it('시간 초과: 남은 체력 비율이 높은 쪽 승리', () => {
    const { a, b, match } = setup();
    toFight(match);
    a.hp = 30;
    b.hp = 60;
    const ev = runFor(match, m.roundTimeSec * 1000 + STEP);
    const end = ev.find((e) => e.type === 'roundEnd');
    expect(end.reason).toBe('time');
    expect(end.winner).toBe(b);
    expect(match.wins).toEqual([0, 1]);
  });

  it('시간 초과에 체력이 같으면 무승부 라운드 (아무도 승수 없음)', () => {
    const { match } = setup();
    toFight(match);
    const ev = runFor(match, m.roundTimeSec * 1000 + STEP);
    expect(ev.find((e) => e.type === 'roundEnd').winner).toBeNull();
    expect(match.wins).toEqual([0, 0]);
  });

  it('2승하면 경기 종료', () => {
    const { a, b, match } = setup();
    for (let i = 0; i < 2; i++) {
      toFight(match);
      knockOut(match, b);
      const ev = runFor(match, m.roundEndMs);
      if (i === 1) {
        const end = ev.find((e) => e.type === 'matchEnd');
        expect(end.winner).toBe(a);
        expect(end.wins).toEqual([2, 0]);
      }
    }
    expect(match.phase).toBe(PHASE.MATCH_END);
    expect(match.history).toHaveLength(2);
  });

  it('1:1에서 3라운드까지 간다', () => {
    const { a, b, match } = setup();
    toFight(match);
    knockOut(match, b);
    runFor(match, m.roundEndMs);
    toFight(match);
    knockOut(match, a);
    const ev = runFor(match, m.roundEndMs);
    expect(ev).toContainEqual({ type: 'roundStart', round: 3 });
  });

  it('무승부가 계속되면 최대 라운드 후 승수로 판정 (같으면 무승부 경기)', () => {
    const { match } = setup();
    let end = null;
    for (let i = 0; i < m.maxRounds && !end; i++) {
      toFight(match);
      const ev = runFor(match, m.roundTimeSec * 1000 + m.roundEndMs + STEP * 2);
      end = ev.find((e) => e.type === 'matchEnd') ?? null;
    }
    expect(end).not.toBeNull();
    expect(end.winner).toBeNull();
    expect(match.round).toBe(m.maxRounds);
  });
});
