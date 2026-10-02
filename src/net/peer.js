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
export function hostRoom({ onCode, onConnected, onError, onStatus }) {
  let peer = null;
  let tries = 0;
  let joined = false;
  let destroyed = false;

  // 중계 서버와의 연결 상태 점검: 끊겨 있으면 다시 붙는다.
  // (창이 백그라운드에 있으면 브라우저가 타이머를 늦춰서 중계 서버 연결이 조용히 끊길 수 있다 →
  //  그 상태로는 상대의 접속 신호를 받지 못해 상대 쪽에서 '연결 시간 초과'가 난다)
  const checkHealth = () => {
    if (joined || destroyed || !peer || peer.destroyed || !peer.disconnected) return;
    onStatus?.('중계 서버에 다시 연결하는 중…');
    peer.reconnect();
  };
  const healthTimer = setInterval(checkHealth, CONFIG.online.hostHealthCheckMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible') checkHealth();
  };
  globalThis.document?.addEventListener('visibilitychange', onVisible);

  const attempt = () => {
    const code = generateRoomCode();
    peer = new Peer(peerIdForRoom(code));
    peer.on('open', () => {
      // 다시 연결됐을 때도 같은 코드로 'open'이 온다
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
    peer.on('disconnected', () => checkHealth());
  };

  attempt();
  return {
    close() {
      destroyed = true;
      clearInterval(healthTimer);
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
      peer?.destroy();
    },
  };
}

/**
 * 코드로 참가.
 * 한 번에 안 열리면 몇 번 다시 시도하고, 끝내 실패하면 어느 단계에서 막혔는지 알려준다.
 * @returns {{ close: () => void }}
 */
export function joinRoom(code, { onConnected, onError, onStatus }) {
  const cfg = CONFIG.online;
  let done = false;
  let attempts = 0;
  let conn = null;
  let retryTimer = null;
  let serverOpen = false;
  const peer = new Peer();

  const cleanup = () => {
    done = true;
    clearTimeout(totalTimer);
    clearTimeout(retryTimer);
  };
  const fail = (message) => {
    if (done) return;
    cleanup();
    onError(message);
    peer.destroy();
  };
  const totalTimer = setTimeout(() => fail(timeoutMessage()), cfg.joinTimeoutMs);

  /** 시간 초과 시, 어느 단계에서 막혔는지에 따라 다른 안내 */
  const timeoutMessage = () => {
    if (!serverOpen) return '중계 서버(PeerJS)가 응답하지 않습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도하세요.';
    const ice = conn?.peerConnection?.iceConnectionState;
    if (ice === 'checking' || ice === 'failed' || ice === 'disconnected') {
      return '상대와 직접 연결하지 못했습니다. 네트워크(회사·학교 방화벽, 일부 모바일 데이터)가 P2P 연결을 막고 있을 수 있습니다.';
    }
    return '방장이 접속 신호에 응답하지 않습니다. 방장 창이 최소화되어 있거나 다른 탭에 가려져 있지 않은지 확인하고, 방장이 새로고침해서 새 방을 만든 뒤 다시 시도하세요.';
  };

  const tryConnect = () => {
    if (done) return;
    attempts++;
    onStatus?.(attempts === 1 ? '방장에게 접속 신호를 보내는 중…' : `다시 시도하는 중… (${attempts}/${cfg.joinAttempts})`);
    conn?.close();
    const c = peer.connect(peerIdForRoom(code), { reliable: true });
    conn = c;
    c.on('open', () => {
      if (done || c !== conn) return c.close();
      cleanup();
      onConnected(wrapConnection(c));
    });
    // 일정 시간 안에 안 열리면 새로 시도 (신호가 한 번 유실되는 경우가 있다)
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!done && attempts < cfg.joinAttempts) tryConnect();
    }, cfg.connectRetryMs);
  };

  peer.on('open', () => {
    serverOpen = true;
    tryConnect();
  });
  peer.on('error', (err) => {
    if (done) return;
    // 방이 안 보이면, 방장이 중계 서버에 잠깐 다시 붙는 중일 수 있으니 한 번 더 확인
    if (err.type === 'peer-unavailable' && attempts < cfg.joinAttempts) {
      clearTimeout(retryTimer);
      onStatus?.('방을 찾는 중…');
      retryTimer = setTimeout(tryConnect, cfg.unavailableRetryMs);
      return;
    }
    fail(describePeerError(err));
  });

  return {
    close() {
      cleanup();
      peer.destroy();
    },
  };
}
