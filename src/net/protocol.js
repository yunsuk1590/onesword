// 온라인 대전 메시지 형식과 검증 (순수 함수)
//
// 상대가 보낸 데이터는 그대로 믿지 않는다. 형식이 틀리거나 규칙을 어긴 값(치트 빌드 등)은 버린다.
//
// 로비 메시지
//   hello  { t, v, name, build }   접속 직후 서로 교환 (버전, 빌드 이름, 스탯 칸)
//   ready  { t }                    준비 완료
//   begin  { t }                    (호스트 → 게스트) 경기 시작
//   bye    { t }                    나가기
// 경기 메시지
//   s      { t, rd, x, y, z, yaw, hp, st, el, du, gh, seq }   내 캐릭터 상태
//   hit    { t, rd, seq, o, dmg, ast, back }                  (맞은 쪽 → 때린 쪽) 판정 결과
//   flow   { t, e }                                            (호스트 → 게스트) 라운드 진행 이벤트
//   clock  { t, rd, tl }                                       (호스트 → 게스트) 남은 시간

import { CONFIG } from '../config.js';
import { STATE } from '../core/stateMachine.js';
import { OUTCOME } from '../core/combat.js';
import { validateBuild, STAT_KEYS } from '../core/stats.js';

const STATES = new Set(Object.values(STATE));
const OUTCOMES = new Set([OUTCOME.PARRIED, OUTCOME.GUARDED, OUTCOME.HIT]);
const MAX_NAME = 16;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;

// ── 로비 ──
export function makeHello({ name, build }, config = CONFIG) {
  return { t: 'hello', v: config.online.protocolVersion, name, build: pickBuild(build) };
}

/** @returns {{ ok: true, name: string, build: Object } | { ok: false, error: string }} */
export function parseHello(msg, config = CONFIG) {
  if (msg?.t !== 'hello') return { ok: false, error: '잘못된 접속 정보' };
  if (msg.v !== config.online.protocolVersion) {
    return { ok: false, error: '상대와 게임 버전이 다릅니다. 둘 다 새로고침한 뒤 다시 시도하세요.' };
  }
  const build = pickBuild(msg.build ?? {});
  if (validateBuild(build).length) return { ok: false, error: '상대 빌드가 규칙에 맞지 않습니다' };
  const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, MAX_NAME) : '상대';
  return { ok: true, name, build };
}

function pickBuild(build) {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, build[k]]));
}

// ── 캐릭터 상태 ──
/** @param {import('../game/fighter.js').Fighter} f */
export function makeSnapshot(f, round) {
  const c = f.combat;
  return {
    t: 's',
    rd: round,
    x: round2(f.position.x),
    y: round2(f.position.y),
    z: round2(f.position.z),
    yaw: Math.round(f.yaw * 1000) / 1000,
    hp: round2(f.hp),
    st: c.state,
    el: Math.round(c.elapsed),
    du: Math.round(c.duration),
    gh: c.guardHeld,
    seq: f.attackSeq,
  };
}

export function isValidSnapshot(m) {
  return (
    m?.t === 's' &&
    [m.rd, m.x, m.y, m.z, m.yaw, m.hp, m.el, m.du, m.seq].every(num) &&
    STATES.has(m.st) &&
    typeof m.gh === 'boolean'
  );
}

// ── 판정 결과 ──
export function makeHitResult(round, seq, result) {
  return {
    t: 'hit',
    rd: round,
    seq,
    o: result.outcome,
    dmg: round2(result.damage),
    ast: result.attackerStaggerMs,
    back: result.backAttack,
  };
}

export function isValidHitResult(m) {
  return m?.t === 'hit' && [m.rd, m.seq, m.dmg, m.ast].every(num) && OUTCOMES.has(m.o) && typeof m.back === 'boolean' && m.dmg >= 0 && m.ast >= 0;
}

// ── 라운드 진행 ──
const FLOW_TYPES = new Set(['roundStart', 'fight', 'roundEnd', 'matchEnd']);

export function isValidFlow(m) {
  const e = m?.e;
  if (m?.t !== 'flow' || !e || !FLOW_TYPES.has(e.type)) return false;
  if (e.type !== 'matchEnd' && !num(e.round)) return false;
  if (e.type === 'roundEnd' || e.type === 'matchEnd') {
    const okIndex = (i) => i === null || i === 0 || i === 1;
    if (!Array.isArray(e.wins) || e.wins.length !== 2 || !e.wins.every(num)) return false;
    if (!okIndex(e.winnerIndex)) return false;
  }
  return true;
}

export function isValidClock(m) {
  return m?.t === 'clock' && num(m.rd) && num(m.tl);
}
