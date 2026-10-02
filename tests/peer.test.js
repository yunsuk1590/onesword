// PeerJS 연결 계층 테스트 — PeerJS를 가짜로 바꾸고 시간을 직접 흘려서 재시도·오류 안내를 확인한다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CONFIG } from '../src/config.js';

const peers = [];

vi.mock('peerjs', () => {
  class Emitter {
    constructor() {
      this.handlers = {};
    }
    on(ev, fn) {
      (this.handlers[ev] ||= []).push(fn);
    }
    emit(ev, ...args) {
      (this.handlers[ev] || []).forEach((fn) => fn(...args));
    }
  }
  class FakeConn extends Emitter {
    constructor(target) {
      super();
      this.target = target;
      this.open = false;
      this.closed = false;
    }
    send() {}
    close() {
      this.closed = true;
    }
  }
  class Peer extends Emitter {
    constructor(id) {
      super();
      this.id = id;
      this.conns = [];
      this.disconnected = false;
      this.destroyed = false;
      this.reconnects = 0;
      peers.push(this);
    }
    connect(target) {
      const c = new FakeConn(target);
      this.conns.push(c);
      return c;
    }
    reconnect() {
      this.reconnects++;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { Peer, FakeConn };
});

const { hostRoom, joinRoom } = await import('../src/net/peer.js');
const { FakeConn } = await import('peerjs');
const cfg = CONFIG.online;

function callbacks() {
  const log = { connected: [], errors: [], status: [] };
  return {
    log,
    onConnected: (t) => log.connected.push(t),
    onError: (m) => log.errors.push(m),
    onStatus: (s) => log.status.push(s),
  };
}

beforeEach(() => {
  peers.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('joinRoom (참가)', () => {
  it('첫 시도가 열리지 않으면 접속 신호를 다시 보내고, 열리는 쪽으로 연결된다', () => {
    const cb = callbacks();
    joinRoom('ABCDEF', cb);
    const peer = peers[0];
    peer.emit('open');
    expect(peer.conns).toHaveLength(1);
    expect(peer.conns[0].target).toBe(cfg.peerPrefix + 'ABCDEF');

    vi.advanceTimersByTime(cfg.connectRetryMs);
    expect(peer.conns).toHaveLength(2);
    expect(peer.conns[0].closed).toBe(true); // 이전 시도는 정리
    expect(cb.log.status.at(-1)).toContain('다시 시도');

    peer.conns[1].open = true;
    peer.conns[1].emit('open');
    expect(cb.log.connected).toHaveLength(1);
    expect(cb.log.errors).toHaveLength(0);

    // 연결된 뒤엔 더 시도하지 않고, 시간 초과도 나지 않는다
    vi.advanceTimersByTime(cfg.joinTimeoutMs * 2);
    expect(peer.conns).toHaveLength(2);
    expect(cb.log.errors).toHaveLength(0);
  });

  it('재시도는 정해진 횟수까지만', () => {
    joinRoom('ABCDEF', callbacks());
    peers[0].emit('open');
    vi.advanceTimersByTime(cfg.connectRetryMs * 10);
    expect(peers[0].conns).toHaveLength(cfg.joinAttempts);
  });

  it('늦게 열린 이전 시도는 닫고 무시한다', () => {
    const cb = callbacks();
    joinRoom('ABCDEF', cb);
    peers[0].emit('open');
    vi.advanceTimersByTime(cfg.connectRetryMs);
    peers[0].conns[0].emit('open'); // 이미 버린 첫 시도
    expect(cb.log.connected).toHaveLength(0);
  });

  it('중계 서버가 응답하지 않으면 그렇게 알려준다', () => {
    const cb = callbacks();
    joinRoom('ABCDEF', cb);
    vi.advanceTimersByTime(cfg.joinTimeoutMs);
    expect(cb.log.errors[0]).toContain('중계 서버');
    expect(peers[0].destroyed).toBe(true);
  });

  it('방장이 신호에 응답하지 않으면, 방장 창 상태를 확인하라고 알려준다', () => {
    const cb = callbacks();
    joinRoom('ABCDEF', cb);
    peers[0].emit('open');
    vi.advanceTimersByTime(cfg.joinTimeoutMs);
    expect(cb.log.errors[0]).toContain('방장');
  });

  it('직접 연결(ICE)이 막혔으면 네트워크 문제라고 알려준다', () => {
    const cb = callbacks();
    joinRoom('ABCDEF', cb);
    peers[0].emit('open');
    vi.advanceTimersByTime(cfg.connectRetryMs * (cfg.joinAttempts - 1));
    peers[0].conns.at(-1).peerConnection = { iceConnectionState: 'failed' };
    vi.advanceTimersByTime(cfg.joinTimeoutMs);
    expect(cb.log.errors[0]).toContain('네트워크');
  });

  it("'방을 찾을 수 없음'은 한 번 더 확인한 뒤에도 없으면 실패", () => {
    const cb = callbacks();
    joinRoom('ABCDEF', cb);
    const peer = peers[0];
    peer.emit('open');
    peer.emit('error', { type: 'peer-unavailable' });
    expect(cb.log.errors).toHaveLength(0);
    vi.advanceTimersByTime(cfg.unavailableRetryMs);
    expect(peer.conns).toHaveLength(2);
    peer.emit('error', { type: 'peer-unavailable' });
    vi.advanceTimersByTime(cfg.unavailableRetryMs);
    peer.emit('error', { type: 'peer-unavailable' });
    expect(cb.log.errors[0]).toContain('방을 찾을 수 없습니다');
  });

  it('닫으면 더 이상 시도하지 않는다', () => {
    const cb = callbacks();
    const handle = joinRoom('ABCDEF', cb);
    peers[0].emit('open');
    handle.close();
    vi.advanceTimersByTime(cfg.joinTimeoutMs * 2);
    expect(peers[0].conns).toHaveLength(1);
    expect(cb.log.errors).toHaveLength(0);
  });
});

describe('hostRoom (방 만들기)', () => {
  function host() {
    const log = { codes: [], connected: [], errors: [], status: [] };
    const handle = hostRoom({
      onCode: (c) => log.codes.push(c),
      onConnected: (t) => log.connected.push(t),
      onError: (m) => log.errors.push(m),
      onStatus: (s) => log.status.push(s),
    });
    return { log, handle, peer: peers.at(-1) };
  }

  it('중계 서버와 끊기면 상대를 기다리는 동안 다시 붙는다', () => {
    const { log, peer } = host();
    peer.emit('open');
    expect(log.codes).toHaveLength(1);
    peer.disconnected = true;
    vi.advanceTimersByTime(cfg.hostHealthCheckMs);
    expect(peer.reconnects).toBeGreaterThan(0);
    expect(log.status.at(-1)).toContain('다시 연결');
  });

  it('상대가 들어온 뒤에는 중계 서버 연결을 신경 쓰지 않는다', () => {
    const { log, peer } = host();
    peer.emit('open');
    const conn = new FakeConn('guest');
    peer.emit('connection', conn);
    conn.open = true;
    conn.emit('open');
    expect(log.connected).toHaveLength(1);
    peer.disconnected = true;
    vi.advanceTimersByTime(cfg.hostHealthCheckMs * 3);
    expect(peer.reconnects).toBe(0);
  });

  it('이미 상대가 있으면 나중에 들어온 접속은 닫는다 (1대1)', () => {
    const { log, peer } = host();
    peer.emit('open');
    const first = new FakeConn('a');
    peer.emit('connection', first);
    first.emit('open');
    const second = new FakeConn('b');
    peer.emit('connection', second);
    second.emit('open');
    expect(log.connected).toHaveLength(1);
    expect(second.closed).toBe(true);
  });

  it('같은 게스트의 재시도 중 먼저 열린 연결 하나만 받는다', () => {
    const { log, peer } = host();
    peer.emit('open');
    const try1 = new FakeConn('g');
    const try2 = new FakeConn('g');
    peer.emit('connection', try1);
    peer.emit('connection', try2);
    try2.emit('open');
    try1.emit('open');
    expect(log.connected).toHaveLength(1);
    expect(try1.closed).toBe(true);
  });

  it('닫으면 점검을 멈추고 PeerJS도 정리한다', () => {
    const { handle, peer } = host();
    handle.close();
    peer.disconnected = true;
    vi.advanceTimersByTime(cfg.hostHealthCheckMs * 3);
    expect(peer.reconnects).toBe(0);
    expect(peer.destroyed).toBe(true);
  });
});
