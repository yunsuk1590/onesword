// 라운드 진행 규칙 (3판 2선승, 라운드당 제한 시간) — 순수 로직
// 캐릭터를 직접 다루지 않고 "지금 몇 라운드, 어떤 단계, 누가 몇 승"만 관리한다.
// 봇 대전(Match)과 온라인 대전(호스트 쪽)이 같은 규칙을 쓰도록 분리했다.
//
// 인덱스 0, 1은 두 참가자. 승자 인덱스가 null이면 무승부.

import { CONFIG } from '../config.js';

export const PHASE = Object.freeze({
  INTRO: 'INTRO', // 'ROUND n' 표시 — 조작 불가
  FIGHT: 'FIGHT',
  ROUND_END: 'ROUND_END', // KO·시간 초과 후 잠깐 대기
  MATCH_END: 'MATCH_END',
});

export class RoundFlow {
  constructor(rules = CONFIG) {
    this.rules = rules;
    this.wins = [0, 0];
    this.round = 0;
    this.history = []; // 라운드별 결과 { round, winnerIndex, reason, hp }
    this.phase = null;
    this.phaseTime = 0;
    this.timeLeftMs = 0;
    this.winnerIndex = undefined; // 경기 종료 시 0 / 1 / null(무승부)
  }

  get roundsToWin() {
    return this.rules.match.roundsToWin;
  }

  /** 경기 시작 — 1라운드 준비 */
  start() {
    const events = [];
    this.#beginRound(events);
    return events;
  }

  /**
   * 시간 진행.
   * @param {number} dtMs
   * @param {() => number[]} getHpRatios 시간 초과 판정용 [참가자0 체력 비율, 참가자1 체력 비율]
   */
  step(dtMs, getHpRatios) {
    const events = [];
    const m = this.rules.match;
    this.phaseTime += dtMs;

    switch (this.phase) {
      case PHASE.INTRO:
        if (this.phaseTime >= m.introMs) {
          this.#setPhase(PHASE.FIGHT);
          events.push({ type: 'fight', round: this.round });
        }
        break;

      case PHASE.FIGHT:
        this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs);
        if (this.timeLeftMs <= 0) {
          // 시간 초과: 남은 체력 비율이 높은 쪽 승리
          const [ra, rb] = getHpRatios();
          const winner = ra > rb ? 0 : rb > ra ? 1 : null;
          events.push(...this.endRound('time', winner));
        }
        break;

      case PHASE.ROUND_END:
        if (this.phaseTime >= m.roundEndMs) {
          if (this.#isDecided()) {
            this.#setPhase(PHASE.MATCH_END);
            const [a, b] = this.wins;
            this.winnerIndex = a > b ? 0 : b > a ? 1 : null;
            events.push({ type: 'matchEnd', winnerIndex: this.winnerIndex, wins: [...this.wins] });
          } else {
            this.#beginRound(events);
          }
        }
        break;
    }
    return events;
  }

  /**
   * 라운드 종료 (KO는 바깥에서 판단해서 호출). FIGHT 중일 때만 유효.
   * @param {'ko'|'time'} reason
   * @param {0|1|null} winnerIndex
   * @param {number[]} [hp] 기록용 남은 체력
   */
  endRound(reason, winnerIndex, hp = null) {
    if (this.phase !== PHASE.FIGHT) return [];
    if (winnerIndex !== null) this.wins[winnerIndex]++;
    this.history.push({ round: this.round, winnerIndex, reason, hp });
    this.#setPhase(PHASE.ROUND_END);
    return [{ type: 'roundEnd', round: this.round, reason, winnerIndex, wins: [...this.wins] }];
  }

  #setPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
  }

  #beginRound(events) {
    this.round++;
    this.timeLeftMs = this.rules.match.roundTimeSec * 1000;
    this.#setPhase(PHASE.INTRO);
    events.push({ type: 'roundStart', round: this.round });
  }

  #isDecided() {
    return this.wins.some((w) => w >= this.roundsToWin) || this.round >= this.rules.match.maxRounds;
  }
}
