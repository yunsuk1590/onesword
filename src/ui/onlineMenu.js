// 온라인 대전 화면: 방 만들기(코드 표시) / 코드로 참가 / 상대 정보·준비

import { STAT_KEYS } from '../core/stats.js';

export class OnlineMenu {
  /**
   * @param {import('../net/lobby.js').Lobby} lobby
   * @param {{ show: () => void, onLeave: () => void }} handlers
   */
  constructor(lobby, { show, onLeave }) {
    this.lobby = lobby;
    this.show = show;
    this.el = {
      title: document.getElementById('online-title'),
      status: document.getElementById('online-status'),
      codeBox: document.getElementById('online-code-box'),
      code: document.getElementById('online-code'),
      copy: document.getElementById('online-copy'),
      joinBox: document.getElementById('online-join-box'),
      input: document.getElementById('online-code-input'),
      joinBtn: document.getElementById('online-join-btn'),
      opponent: document.getElementById('online-opponent'),
      ready: document.getElementById('online-ready'),
      leave: document.getElementById('online-leave'),
    };
    this.joinMode = false;

    document.querySelectorAll('[data-online]').forEach((btn) => {
      btn.addEventListener('click', () => (btn.dataset.online === 'host' ? this.openHost() : this.openJoin()));
    });
    this.el.joinBtn.addEventListener('click', () => this.lobby.join(this.el.input.value));
    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.lobby.join(this.el.input.value);
    });
    this.el.copy.addEventListener('click', () => this.#copyCode());
    this.el.ready.addEventListener('click', () => this.lobby.setReady());
    this.el.leave.addEventListener('click', () => {
      this.lobby.leave();
      onLeave();
    });
  }

  openHost() {
    this.joinMode = false;
    this.show();
    this.lobby.host();
  }

  openJoin() {
    this.lobby.leave();
    this.joinMode = true;
    this.el.input.value = '';
    this.show();
    this.render(this.lobby.state);
    this.el.input.focus();
  }

  /** 로비 상태가 바뀔 때마다 화면 갱신 */
  render(s) {
    const e = this.el;
    const isGuest = s.role === 'guest' || (s.status === 'idle' && this.joinMode);
    e.title.textContent = isGuest ? '코드로 참가' : '방 만들기';
    e.status.classList.toggle('error', s.status === 'error');

    const showJoinInput = isGuest && (s.status === 'idle' || s.status === 'error');
    e.joinBox.classList.toggle('hidden', !showJoinInput);
    e.codeBox.classList.toggle('hidden', !(s.role === 'host' && s.code && ['waiting', 'handshake', 'connected'].includes(s.status)));
    e.code.textContent = s.code ?? '';
    e.opponent.classList.toggle('hidden', s.status !== 'connected');
    e.ready.classList.toggle('hidden', s.status !== 'connected');

    switch (s.status) {
      case 'idle':
        e.status.textContent = isGuest ? '친구에게 받은 6자리 코드를 입력하세요.' : '';
        break;
      case 'creating':
        e.status.textContent = '방 만드는 중…';
        break;
      case 'waiting':
        e.status.textContent =
          s.detail ??
          '친구에게 이 코드를 알려 주세요. 친구가 입력하면 연결됩니다.\n(기다리는 동안 이 창을 최소화하거나 다른 탭으로 가리지 마세요 — 접속 신호를 놓칠 수 있습니다)';
        break;
      case 'joining':
        e.status.textContent = `${s.code} 방에 연결하는 중… ${s.detail ?? ''}`;
        break;
      case 'handshake':
        e.status.textContent = '연결됨 — 상대 정보 확인 중…';
        break;
      case 'connected': {
        const r = s.remote;
        e.opponent.textContent = `상대 빌드: ${r.name} (${STAT_KEYS.map((k) => r.build[k]).join('·')})`;
        e.ready.disabled = s.myReady;
        e.ready.textContent = s.myReady ? '준비 완료 ✓' : '준비 완료';
        e.status.textContent = s.remoteReady
          ? '상대가 준비했습니다! 준비 완료를 누르면 시작합니다.'
          : s.myReady
            ? '상대가 준비하기를 기다리는 중…'
            : '둘 다 준비 완료를 누르면 경기가 시작됩니다.';
        break;
      }
      case 'error':
        e.status.textContent = s.error;
        break;
    }
  }

  async #copyCode() {
    const code = this.lobby.state.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.el.copy.textContent = '복사됨!';
    } catch {
      this.el.copy.textContent = '직접 복사하세요';
    }
    setTimeout(() => (this.el.copy.textContent = '코드 복사'), 1500);
  }
}
