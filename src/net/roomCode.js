// 방 코드 (순수 함수)
// 방 코드 = PeerJS 접속 주소의 일부. 사람이 읽고 입력하기 쉽게 헷갈리는 글자를 뺐다.

import { CONFIG } from '../config.js';

export function generateRoomCode(rng = Math.random, config = CONFIG) {
  const { codeAlphabet, codeLength } = config.online;
  let code = '';
  for (let i = 0; i < codeLength; i++) code += codeAlphabet[Math.floor(rng() * codeAlphabet.length)];
  return code;
}

/** 사용자가 입력한 코드 정리: 대문자로, 공백·하이픈 제거 */
export function normalizeRoomCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function isValidRoomCode(code, config = CONFIG) {
  const { codeAlphabet, codeLength } = config.online;
  return code.length === codeLength && [...code].every((ch) => codeAlphabet.includes(ch));
}

export function peerIdForRoom(code, config = CONFIG) {
  return config.online.peerPrefix + code;
}
