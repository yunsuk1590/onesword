// 봇 대전 경기: 라운드 진행(RoundFlow) + 두 캐릭터의 전투(Duel)
// 렌더링과 무관한 순수 게임 로직.

import { CONFIG } from '../config.js';
import { Duel } from './duel.js';
import { RoundFlow, PHASE } from './roundFlow.js';
import { yawToward } from '../core/physics.js';

export { PHASE };

export class Match {
  /**
   * @param {import('./fighter.js').Fighter[]} fighters [0]: 플레이어, [1]: 상대
   * @param {{ spawns: {x:number, z:number}[], rules?: Object }} options
   */
  constructor(fighters, { spawns, rules = CONFIG }) {
    this.fighters = fighters;
    this.spawns = spawns;
    this.rules = rules;
    this.duel = new Duel(fighters, { rules, autoReset: false });
    this.flow = new RoundFlow(rules);
  }

  get phase() {
    return this.flow.phase;
  }
  get round() {
    return this.flow.round;
  }
  get wins() {
    return this.flow.wins;
  }
  get history() {
    return this.flow.history;
  }
  get timeLeftMs() {
    return this.flow.timeLeftMs;
  }
  get roundsToWin() {
    return this.flow.roundsToWin;
  }
  /** 경기 종료 시 이긴 Fighter 또는 null(무승부). 진행 중이면 undefined. */
  get winner() {
    const i = this.flow.winnerIndex;
    return i === undefined || i === null ? i : this.fighters[i];
  }

  /** 경기 시작 — 1라운드 준비 */
  start() {
    return this.#convert(this.flow.start());
  }

  /**
   * @param {number} dtMs
   * @param {(dtMs:number) => void} control 조종 단계 — FIGHT 중에만 호출된다
   */
  step(dtMs, control) {
    const events = [];
    if (this.flow.phase === PHASE.FIGHT) {
      const fightEvents = this.duel.step(dtMs, control);
      events.push(...fightEvents);
      if (fightEvents.some((e) => e.type === 'ko')) {
        const alive = this.fighters.map((f, i) => (f.isDead ? -1 : i)).filter((i) => i >= 0);
        const winner = alive.length === 1 ? alive[0] : null; // 둘 다 쓰러지면 무승부
        events.push(...this.#convert(this.flow.endRound('ko', winner, this.fighters.map((f) => f.hp))));
        return events;
      }
    } else {
      events.push(...this.#idleStep(dtMs));
    }
    const ratios = () => this.fighters.map((f) => f.hp / f.stats.maxHp);
    events.push(...this.#convert(this.flow.step(dtMs, ratios)));
    return events;
  }

  /** 조작 없이 시간만 흐르게 (애니메이션·중력). 적중 판정은 하지 않는다. */
  #idleStep(dtMs) {
    const dt = dtMs / 1000;
    return this.duel.step(dtMs, () => this.fighters.forEach((f) => f.step(dt, 0, 0)), { resolveHits: false });
  }

  /** RoundFlow 이벤트 → 경기 이벤트 (승자 인덱스를 Fighter로, 라운드 시작 시 위치 초기화) */
  #convert(flowEvents) {
    return flowEvents.map((e) => {
      switch (e.type) {
        case 'roundStart':
          this.#resetFighters();
          return e;
        case 'roundEnd': {
          const { winnerIndex, ...rest } = e;
          if (this.flow.history.at(-1).hp === null) this.flow.history.at(-1).hp = this.fighters.map((f) => f.hp);
          return { ...rest, winner: winnerIndex === null ? null : this.fighters[winnerIndex] };
        }
        case 'matchEnd':
          return { type: 'matchEnd', winner: this.winner, wins: e.wins };
        default:
          return e;
      }
    });
  }

  #resetFighters() {
    const [sa, sb] = this.spawns;
    this.fighters[0].resetForRound({ x: sa.x, z: sa.z, yaw: yawToward(sa.x, sa.z, sb.x, sb.z) });
    this.fighters[1].resetForRound({ x: sb.x, z: sb.z, yaw: yawToward(sb.x, sb.z, sa.x, sa.z) });
  }
}
