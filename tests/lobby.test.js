// 로비 흐름 테스트 — PeerJS 대신 가짜 네트워크를 넣는다
import { describe, it, expect } from 'vitest';
import { Lobby } from '../src/net/lobby.js';

const build = { attack: 3, defense: 3, attackSpeed: 3, moveSpeed: 3, range: 3 };

/** 메모리 안에서 방 코드로 두 로비를 잇는 가짜 네트워크. flush()를 불러야 메시지가 배달된다. */
function fakeNet() {
  const rooms = new Map();
  const queue = [];
  const makeTransportPair = () => {
    const ends = [0, 1].map(() => ({ msgFns: [], closeFns: [], closed: false }));
    const transport = (i) => ({
      send: (m) => !ends[i].closed && queue.push(() => ends[1 - i].msgFns.forEach((f) => f(JSON.parse(JSON.stringify(m))))),
      onMessage: (fn) => ends[i].msgFns.push(fn),
      onClose: (fn) => ends[i].closeFns.push(fn),
      close: () => {
        ends[i].closed = true;
        queue.push(() => {
          if (!ends[1 - i].closed) {
            ends[1 - i].closed = true;
            ends[1 - i].closeFns.forEach((f) => f());
          }
        });
      },
    });
    return [transport(0), transport(1)];
  };
  let nextCode = 'ABCDEF';
  return {
    net: {
      hostRoom({ onCode, onConnected }) {
        const code = nextCode;
        rooms.set(code, onConnected);
        queue.push(() => onCode(code));
        return { close: () => rooms.delete(code) };
      },
      joinRoom(code, { onConnected, onError }) {
        queue.push(() => {
          const host = rooms.get(code);
          if (!host) return onError('방을 찾을 수 없습니다.');
          const [h, g] = makeTransportPair();
          host(h);
          onConnected(g);
        });
        return { close() {} };
      },
    },
    flush() {
      while (queue.length) queue.shift()();
    },
    setNextCode(c) {
      nextCode = c;
    },
  };
}

function setup({ guestBuild = build } = {}) {
  const fake = fakeNet();
  const begins = { host: [], guest: [] };
  const host = new Lobby({ net: fake.net, getMyInfo: () => ({ name: '호스트빌드', build }), onBegin: (role, remote) => begins.host.push({ role, remote }) });
  const guest = new Lobby({ net: fake.net, getMyInfo: () => ({ name: '게스트빌드', build: guestBuild }), onBegin: (role, remote) => begins.guest.push({ role, remote }) });
  return { fake, host, guest, begins };
}

describe('Lobby', () => {
  it('방을 만들면 코드가 나오고, 그 코드로 참가하면 서로의 빌드를 확인한다', () => {
    const { fake, host, guest } = setup();
    host.host();
    fake.flush();
    expect(host.state.status).toBe('waiting');
    expect(host.state.code).toBe('ABCDEF');

    guest.join('abc-def'); // 소문자·하이픈도 허용
    fake.flush();
    expect(host.state.status).toBe('connected');
    expect(guest.state.status).toBe('connected');
    expect(host.state.remote.name).toBe('게스트빌드');
    expect(guest.state.remote).toEqual({ name: '호스트빌드', build });
  });

  it('형식이 틀린 코드는 바로 오류, 없는 방이면 연결 실패', () => {
    const { fake, guest } = setup();
    guest.join('12');
    expect(guest.state.status).toBe('error');
    guest.join('ZZZZZZ');
    fake.flush();
    expect(guest.state.status).toBe('error');
    expect(guest.state.error).toContain('찾을 수 없');
  });

  it('둘 다 준비해야 시작한다 (누가 먼저 준비하든)', () => {
    const { fake, host, guest, begins } = setup();
    host.host();
    fake.flush();
    guest.join('ABCDEF');
    fake.flush();

    guest.setReady();
    fake.flush();
    expect(host.state.remoteReady).toBe(true);
    expect(begins.host).toHaveLength(0);

    host.setReady();
    fake.flush();
    expect(begins.host).toEqual([{ role: 'host', remote: { name: '게스트빌드', build } }]);
    expect(begins.guest).toEqual([{ role: 'guest', remote: { name: '호스트빌드', build } }]);
    expect(host.state.status).toBe('playing');
    expect(guest.state.status).toBe('playing');
  });

  it('경기 중 메시지는 현재 경기로 넘어간다', () => {
    const { fake, host, guest } = setup();
    host.host();
    fake.flush();
    guest.join('ABCDEF');
    fake.flush();
    host.setReady();
    guest.setReady();
    fake.flush();
    const got = [];
    host.game = { receive: (m) => got.push(m), notifyDisconnect() {} };
    guest.send({ t: 's', x: 1 });
    fake.flush();
    expect(got).toEqual([{ t: 's', x: 1 }]);
  });

  it('경기가 끝나면 다시 준비해서 재대결할 수 있다', () => {
    const { fake, host, guest, begins } = setup();
    host.host();
    fake.flush();
    guest.join('ABCDEF');
    fake.flush();
    host.setReady();
    guest.setReady();
    fake.flush();
    host.endGame();
    guest.endGame();
    expect(host.state.status).toBe('connected');
    guest.setReady();
    host.setReady();
    fake.flush();
    expect(begins.host).toHaveLength(2);
    expect(begins.guest).toHaveLength(2);
  });

  it('상대가 나가면 연결 끊김을 알리고, 경기 중이면 경기에도 알린다', () => {
    const { fake, host, guest } = setup();
    host.host();
    fake.flush();
    guest.join('ABCDEF');
    fake.flush();
    host.setReady();
    guest.setReady();
    fake.flush();
    let notified = false;
    host.game = { receive() {}, notifyDisconnect: () => (notified = true) };
    guest.leave();
    fake.flush();
    expect(notified).toBe(true);
    expect(host.state.status).toBe('error');
    expect(host.state.error).toContain('끊겼');
    expect(guest.state.status).toBe('idle');
  });

  it('규칙을 어긴 빌드로 접속하면 거부한다', () => {
    const cheat = { attack: 5, defense: 5, attackSpeed: 5, moveSpeed: 5, range: 5 };
    const { fake, host, guest } = setup({ guestBuild: cheat });
    host.host();
    fake.flush();
    guest.join('ABCDEF');
    fake.flush();
    expect(host.state.status).toBe('error');
    expect(host.state.error).toContain('빌드');
  });
});
