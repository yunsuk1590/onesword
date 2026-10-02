// 온라인 로비: 방 만들기/참가 → 서로 정보 교환(hello) → 둘 다 준비 → 경기 시작(begin) → (경기 후) 재대결
// 방을 만든 쪽(호스트)과 참가한 쪽(게스트) 모두 같은 흐름을 거친다.
// 경기 중 메시지는 현재 경기(OnlineDuel)로 넘긴다.

import { makeHello, parseHello } from './protocol.js';
import { normalizeRoomCode, isValidRoomCode } from './roomCode.js';

/**
 * status
 *   idle       아무것도 안 함
 *   creating   방 만드는 중
 *   waiting    (호스트) 코드를 받고 상대를 기다리는 중
 *   joining    (게스트) 연결 중
 *   handshake  연결됨, 서로 정보 교환 중
 *   connected  연결 완료 — 준비 버튼 대기 (경기 후 재대결 대기도 여기)
 *   playing    경기 중
 *   error      실패 (error에 이유)
 */
export class Lobby {
  /**
   * @param {{
   *   net: { hostRoom: Function, joinRoom: Function },
   *   getMyInfo: () => { name: string, build: Object },
   *   onChange?: (state) => void,
   *   onBegin?: (role: 'host'|'guest', remote: { name: string, build: Object }) => void,
   * }} options
   */
  constructor({ net, getMyInfo, onChange, onBegin }) {
    this.net = net;
    this.getMyInfo = getMyInfo;
    this.onChange = onChange ?? (() => {});
    this.onBegin = onBegin ?? (() => {});
    this.handle = null; // 방 만들기/참가 핸들
    this.transport = null;
    this.game = null; // 현재 경기 (메시지를 받을 대상)
    this.state = this.#blank();
  }

  #blank() {
    return { status: 'idle', role: null, code: null, remote: null, myReady: false, remoteReady: false, error: null };
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  host() {
    this.leave();
    this.#set({ status: 'creating', role: 'host' });
    this.handle = this.net.hostRoom({
      onCode: (code) => this.#set({ status: 'waiting', code }),
      onConnected: (t) => this.#attach(t),
      onError: (msg) => this.#fail(msg),
    });
  }

  join(input) {
    const code = normalizeRoomCode(input);
    this.leave();
    if (!isValidRoomCode(code)) {
      this.#set({ status: 'error', role: 'guest', error: '방 코드는 6자리 영문·숫자입니다.' });
      return;
    }
    this.#set({ status: 'joining', role: 'guest', code });
    this.handle = this.net.joinRoom(code, {
      onConnected: (t) => this.#attach(t),
      onError: (msg) => this.#fail(msg),
    });
  }

  /** 준비 완료. 둘 다 준비되면 호스트가 경기를 시작시킨다. */
  setReady() {
    if (this.state.status !== 'connected' || this.state.myReady) return;
    this.#set({ myReady: true });
    this.send({ t: 'ready' });
    this.#maybeBegin();
  }

  /** 경기가 끝나 결과 화면으로 — 재대결을 위해 연결은 유지 */
  endGame() {
    this.game = null;
    if (this.state.status === 'playing') this.#set({ status: 'connected', myReady: false });
  }

  /** 나가기: 상대에게 알리고 연결을 끊는다 */
  leave() {
    if (this.transport) {
      this.send({ t: 'bye' });
      this.transport.close();
    }
    this.handle?.close();
    this.handle = null;
    this.transport = null;
    this.game = null;
    if (this.state.status !== 'idle') this.#set(this.#blank());
  }

  send(msg) {
    this.transport?.send(msg);
  }

  // ── 내부 ──
  #attach(transport) {
    this.transport = transport;
    transport.onMessage((msg) => this.#onMessage(msg));
    transport.onClose(() => this.#onClosed());
    this.#set({ status: 'handshake' });
    this.send(makeHello(this.getMyInfo()));
  }

  #onMessage(msg) {
    switch (msg?.t) {
      case 'hello': {
        const r = parseHello(msg);
        if (!r.ok) {
          this.#fail(r.error);
          return;
        }
        this.#set({ status: 'connected', remote: { name: r.name, build: r.build } });
        break;
      }
      case 'ready':
        this.#set({ remoteReady: true });
        this.#maybeBegin();
        break;
      case 'begin':
        if (this.state.role === 'guest' && this.state.status === 'connected') this.#begin();
        break;
      case 'bye':
        this.#onClosed();
        break;
      default:
        this.game?.receive(msg);
    }
  }

  #maybeBegin() {
    const s = this.state;
    if (s.role === 'host' && s.status === 'connected' && s.myReady && s.remoteReady) {
      this.send({ t: 'begin' });
      this.#begin();
    }
  }

  #begin() {
    this.#set({ status: 'playing', myReady: false, remoteReady: false });
    this.onBegin(this.state.role, this.state.remote);
  }

  #onClosed() {
    if (!this.transport && !this.handle) return;
    this.game?.notifyDisconnect();
    this.game = null;
    this.transport = null;
    this.handle?.close();
    this.handle = null;
    this.#set({ status: 'error', error: '상대와의 연결이 끊겼습니다.', myReady: false, remoteReady: false });
  }

  #fail(message) {
    this.transport?.close();
    this.handle?.close();
    this.transport = null;
    this.handle = null;
    this.#set({ status: 'error', error: message });
  }
}
