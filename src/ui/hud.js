// HUD: 체력바, 라운드 승수, 남은 시간, 패링 바, 중앙 알림 문구

import { STATE } from '../core/stateMachine.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.player = makeBar(root.querySelector('#player-bar'));
    this.enemy = makeBar(root.querySelector('#enemy-bar'));
    this.timerEl = root.querySelector('#timer');
    this.parryDot = root.querySelector('#parry-indicator');
    this.parryFill = this.parryDot.querySelector('.fill');
    this.popupEl = root.querySelector('#popup');
    this.popupTimer = 0;
  }

  setNames(playerName, enemyName) {
    this.player.label.textContent = playerName;
    this.enemy.label.textContent = enemyName;
  }

  /** 'match'면 타이머·승수 표시, 'practice'면 숨김 */
  setMode(kind) {
    this.root.classList.toggle('practice', kind === 'practice');
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible);
  }

  /**
   * @param {number} dt
   * @param {import('../game/fighter.js').Fighter} player
   * @param {import('../game/fighter.js').Fighter} enemy
   * @param {{ timeLeftMs:number, wins:number[], roundsToWin:number } | null} matchInfo
   */
  update(dt, player, enemy, matchInfo = null) {
    updateBar(this.player, player, dt);
    updateBar(this.enemy, enemy, dt);

    if (matchInfo) {
      const sec = Math.ceil(matchInfo.timeLeftMs / 1000);
      this.timerEl.textContent = sec;
      this.timerEl.classList.toggle('low', sec <= 10);
      setPips(this.player.pips, matchInfo.wins[0], matchInfo.roundsToWin);
      setPips(this.enemy.pips, matchInfo.wins[1], matchInfo.roundsToWin);
    }

    // 패링 바: 헛패링 후 다시 차오르는 동안은 우클릭해도 일반 방어만 나간다
    const charge = player.parryCharge();
    const ready = charge >= 1;
    this.parryFill.style.width = `${(charge * 100).toFixed(1)}%`;
    this.parryDot.classList.toggle('ready', ready);
    this.parryDot.classList.toggle('active', player.state === STATE.PARRY_WINDOW);
    // 바가 덜 찼는데 방어 중 = 패링 대신 방어가 나간 상태 → 빨갛게 알려준다
    this.parryDot.classList.toggle('locked', !ready && player.state === STATE.GUARD);

    if (this.popupTimer > 0) {
      this.popupTimer -= dt * 1000;
      if (this.popupTimer <= 0) this.popupEl.classList.remove('show');
    }
  }

  /** 화면 중앙 알림 (패링!, 백어택!, ROUND 1 등) */
  popup(text, color = '#ffffff', { ms = 650, big = false } = {}) {
    const el = this.popupEl;
    el.textContent = text;
    el.style.color = color;
    el.classList.toggle('big', big);
    el.classList.remove('show');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('show');
    this.popupTimer = ms;
  }
}

function makeBar(el) {
  return {
    label: el.querySelector('.bar-label'),
    fill: el.querySelector('.fill'),
    lag: el.querySelector('.lag'),
    text: el.querySelector('.hp-text'),
    pips: el.querySelector('.pips'),
    shown: 1,
    lagShown: 1,
    lagDelay: 0,
  };
}

function updateBar(bar, fighter, dt) {
  const ratio = Math.max(0, fighter.hp / fighter.stats.maxHp);
  if (ratio < bar.shown) bar.lagDelay = 0.35; // 깎인 부분이 잠깐 남았다가 줄어든다
  if (ratio > bar.shown) bar.lagShown = ratio; // 회복(새 라운드)은 바로 반영
  bar.shown = ratio;
  if (bar.lagDelay > 0) bar.lagDelay -= dt;
  else bar.lagShown += (bar.shown - bar.lagShown) * (1 - Math.exp(-6 * dt));
  if (bar.lagShown < bar.shown) bar.lagShown = bar.shown;

  bar.fill.style.width = `${(bar.shown * 100).toFixed(2)}%`;
  bar.lag.style.width = `${(bar.lagShown * 100).toFixed(2)}%`;
  bar.text.textContent = Math.ceil(fighter.hp);
}

function setPips(el, wins, total) {
  if (el.children.length !== total) {
    el.replaceChildren(...Array.from({ length: total }, () => document.createElement('span')));
  }
  [...el.children].forEach((pip, i) => pip.classList.toggle('won', i < wins));
}
