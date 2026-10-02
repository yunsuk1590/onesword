// PeerJS 연결 (브라우저 전용)
// 방 코드 = PeerJS 접속 주소. 처음 연결할 때만 PeerJS 공개 중계 서버를 쓰고, 이후 게임 데이터는 두 브라우저가 직접 주고받는다.
//
// 연결은 아래 모양(Transport)으로 감싸서 넘긴다 — 게임 코드는 PeerJS를 몰라도 된다.
//   { send(msg), onMessage(fn), onClose(fn), close() }

import { Peer } from 'peerjs';
import { CONFIG } from '../config.js';
import { generateRoomCode, peerIdForRoom } from './roomCode.js';

const ERROR_TEXT = {
  'peer-unavailable': '방을 찾을 수 없습니다. 코드를 확인하세요.',
  'unavailable-id': '방 코드를 만들지 못했습니다. 다시 시도하세요.',
  network: '중계 서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.',
  'server-error': '중계 서버 오류입니다. 잠시 후 다시 시도하세요.',
  'socket-error': '중계 서버와 연결이 끊겼습니다.',
  'socket-closed': '중계 서버와 연결이 끊겼습니다.',
  'browser-incompatible': '이 브라우저는 온라인 대전을 지원하지 않습니다.',
  disconnected: '중계 서버와 연결이 끊겼습니다.',
  webrtc: '상대와 직접 연결하지 못했습니다. 네트워크(회사·학교 방화벽 등)가 막고 있을 수 있습니다.',
};

export function describePeerError(err) {
  return ERROR_TEXT[err?.type] ?? `연결 오류 (${err?.type ?? err?.message ?? '알 수 없음'})`;
}

/** PeerJS DataConnection → Transport */
function wrapConnection(conn) {
  const messageFns = [];
  const closeFns = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeFns.forEach((fn) => fn());
  };
  conn.on('data', (data) => {
    if (!closed) messageFns.forEach((fn) => fn(data));
  });
  conn.on('close', fireClose);
  conn.on('error', fireClose);
  // 상대 탭이 갑자기 닫히면 close 이벤트가 늦게 올 수 있어서, 직접 연결 상태도 지켜본다
  conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
    const s = conn.peerConnection.iceConnectionState;
    if (s === 'failed' || s === 'closed') fireClose();
  });
  return {
    send(msg) {
      if (!closed && conn.open) conn.send(msg);
    },
    onMessage(fn) {
      messageFns.push(fn);
    },
    onClose(fn) {
      closeFns.push(fn);
    },
    close() {
      closed = true;
      conn.close();
    },
  };
}

/**
 * 방 만들기. 코드가 정해지면 onCode, 상대가 들어오면 onConnected(transport).
 * @returns {{ close: () => void }}
 */
export function hostRoom({ onCode, onConnected, onError }) {
  let peer = null;
  let tries = 0;
  let joined = false;
  let destroyed = false;

  const attempt = () => {
    const code = generateRoomCode();
    peer = new Peer(peerIdForRoom(code));
    peer.on('open', () => {
      if (!destroyed) onCode(code);
    });
    peer.on('connection', (conn) => {
      if (joined) {
        // 이미 상대가 있으면 나중에 온 사람은 거절 (1대1)
        conn.on('open', () => conn.close());
        return;
      }
      conn.on('open', () => {
        if (joined || destroyed) return conn.close();
        joined = true;
        onConnected(wrapConnection(conn));
      });
    });
    peer.on('error', (err) => {
      if (destroyed) return;
      if (err.type === 'unavailable-id' && tries++ < 5) {
        peer.destroy();
        attempt(); // 코드가 겹치면 새 코드로
        return;
      }
      if (!joined) onError(describePeerError(err));
      // 연결된 뒤의 중계 서버 오류는 무시 (게임 데이터는 직접 연결로 오간다)
    });
    peer.on('disconnected', () => {
      // 상대를 기다리는 중에 중계 서버와 끊기면 다시 붙는다
      if (!joined && !destroyed) peer.reconnect();
    });
  };

  attempt();
  return {
    close() {
      destroyed = true;
      peer?.destroy();
    },
  };
}

/**
 * 코드로 참가.
 * @returns {{ close: () => void }}
 */
export function joinRoom(code, { onConnected, onError }) {
  let done = false;
  const peer = new Peer();
  const fail = (message) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    onError(message);
    peer.destroy();
  };
  const timer = setTimeout(
    () => fail('연결 시간이 초과됐습니다. 코드를 확인하거나 다시 시도하세요.'),
    CONFIG.online.joinTimeoutMs,
  );

  peer.on('open', () => {
    const conn = peer.connect(peerIdForRoom(code), { reliable: true });
    conn.on('open', () => {
      if (done) return conn.close();
      done = true;
      clearTimeout(timer);
      onConnected(wrapConnection(conn));
    });
  });
  peer.on('error', (err) => fail(describePeerError(err)));

  return {
    close() {
      done = true;
      clearTimeout(timer);
      peer.destroy();
    },
  };
}
