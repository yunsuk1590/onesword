// 시작 화면, 일시정지, 결과 화면, 빌드 편집 화면 전환

import { STAT_KEYS, STAT_LABELS } from '../core/stats.js';
import { CONFIG } from '../config.js';

export class Menus {
  /**
   * @param {{
   *   onStart: (kind: 'match'|'practice', difficulty?: string) => void,
   *   onResume: () => void,
   *   onQuit: () => void,
   *   onRetry: () => void,
   *   onEditBuild: () => void,
   * }} handlers
   */
  constructor(handlers) {
    this.screens = {
      start: document.getElementById('menu-start'),
      pause: document.getElementById('menu-pause'),
      result: document.getElementById('menu-result'),
      builds: document.getElementById('menu-builds'),
      online: document.getElementById('menu-online'),
    };

    document.querySelectorAll('[data-start]').forEach((btn) => {
      btn.addEventListener('click', () => handlers.onStart(btn.dataset.start, btn.dataset.difficulty));
    });
    document.querySelectorAll('[data-action]').forEach((btn) => {
      const action = {
        resume: handlers.onResume,
        quit: handlers.onQuit,
        retry: handlers.onRetry,
        'edit-build': handlers.onEditBuild,
      }[btn.dataset.action];
      btn.addEventListener('click', () => action?.());
    });

    this.result = {
      title: document.getElementById('result-title'),
      sub: document.getElementById('result-sub'),
      score: document.getElementById('result-score'),
      rounds: document.getElementById('result-rounds'),
    };
    this.pauseHint = document.getElementById('pause-hint');
    this.retryButton = document.querySelector('#menu-result [data-action="retry"]');

    // 상대 빌드 선택 목록 (랜덤 + 프리셋)
    this.opponentSelect = document.getElementById('opponent-build');
    for (const [key, preset] of Object.entries(CONFIG.bot.builds)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${preset.label} (${STAT_KEYS.map((k) => preset.stats[k]).join('·')})`;
      this.opponentSelect.appendChild(opt);
    }
    this.buildNameEl = document.getElementById('current-build-name');
    this.buildStatsEl = document.getElementById('current-build-stats');
  }

  /** 상대 빌드 선택값: 'random' 또는 CONFIG.bot.builds의 키 */
  get opponentBuildChoice() {
    return this.opponentSelect.value;
  }

  /** 시작 화면의 '내 빌드' 요약 갱신 */
  setCurrentBuild({ name, stats }) {
    this.buildNameEl.textContent = name;
    this.buildStatsEl.textContent = STAT_KEYS.map((k) => `${STAT_LABELS[k]} ${stats[k]}`).join(' · ');
  }

  show(name) {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('hidden', key !== name);
  }

  hide() {
    this.show(null);
  }

  /** 일시정지 화면 (연습 모드에서는 '다시 하기' 문구를 바꿈) */
  showPause(hint) {
    this.pauseHint.textContent = hint;
    this.show('pause');
  }

  /**
   * @param {{
   *   outcome: 'win'|'lose'|'draw'|'disconnect', opponentLabel: string, wins: number[],
   *   rounds: {round:number, text:string, cls:string}[], retryLabel?: string, canRetry?: boolean,
   * }} r
   */
  showResult(r) {
    const titles = { win: '승리', lose: '패배', draw: '무승부', disconnect: '연결 끊김' };
    this.result.title.textContent = titles[r.outcome];
    this.result.title.className = `result-${r.outcome}`;
    this.result.sub.textContent =
      r.outcome === 'disconnect' ? '상대와의 연결이 끊겼습니다.' : `상대: ${r.opponentLabel}`;
    this.retryButton.textContent = r.retryLabel ?? '다시 하기';
    this.setRetryEnabled(r.canRetry ?? true);
    this.result.score.textContent = `${r.wins[0]} : ${r.wins[1]}`;
    this.result.rounds.replaceChildren(
      ...r.rounds.map(({ round, text, cls }) => {
        const li = document.createElement('li');
        li.className = cls;
        li.textContent = `${round}라운드 — ${text}`;
        return li;
      }),
    );
    this.show('result');
  }

  /** 결과 화면의 다시 하기(재대결) 버튼 표시 여부 */
  setRetryEnabled(enabled) {
    this.retryButton.classList.toggle('hidden', !enabled);
  }
}
