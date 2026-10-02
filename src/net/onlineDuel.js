// 온라인 1대1 대전 — 한 사람의 컴퓨터에서 돌아가는 쪽
//
// 원칙
// 1. 내 캐릭터는 내가 움직인다. 상대 캐릭터는 상대가 보내준 상태를 보여준다 (스냅샷 사이엔 같은 상태 머신으로 예측).
// 2. "맞는 쪽"이 판정한다. 상대 공격이 내 화면에서 판정 구간에 들어오면, 내 패링·방어 상태로 결과를 정한다.
//    → 네트워크 지연이 있어도 내 눈에 보인 대로 패링이 된다. 결과는 때린 쪽에 보내서 적용시킨다.
// 3. 라운드·타이머·승패는 호스트가 정한다 (RoundFlow). 게스트는 호스트가 보낸 진행 이벤트를 따른다.
//
// 이벤트·승수·기록은 모두 "내 관점"으로 바꿔서 내보낸다: wins = [나, 상대], 승자 = 내 Fighter 또는 상대 Fighter.

import { CONFIG } from '../config.js';
import { RoundFlow, PHASE } from '../game/roundFlow.js';
import { STATE, onParrySuccess } from '../core/stateMachine.js';
import { isInAttackArc, isBackAttack, resolveHit, OUTCOME } from '../core/combat.js';
import { yawToward, turnToward } from '../core/physics.js';
import {
  makeSnapshot,
  isValidSnapshot,
  makeHitResult,
  isValidHitResult,
  isValidFlow,
  isValidClock,
} from './protocol.js';

export class OnlineDuel {
  /**
   * @param {{
   *   role: 'host'|'guest',
   *   send: (msg: Object) => void,
   *   local: import('../game/fighter.js').Fighter,
   *   remote: import('../game/fighter.js').Fighter,
   *   rules?: Object,
   * }} options
   */
  constructor({ role, send, local, remote, rules = CONFIG }) {
    this.role = role;
    this.isHost = role === 'host';
    this.send = send;
    this.local = local;
    this.remote = remote;
    this.rules = rules;
    this.localIndex = this.isHost ? 0 : 1; // 호스트 기준 인덱스 (호스트 = 0, 게스트 = 1)

    this.flow = this.isHost ? new RoundFlow(rules) : null;
    // 게스트: 호스트가 알려준 진행 상황
    this.mirror = { phase: null, round: 0, wins: [0, 0], timeLeftMs: 0, history: [], winnerIndex: undefined };

    this.inbox = [];
    this.time = 0;
    this.remoteTarget = { ...remote.position, yaw: remote.yaw };
    this.lastResolvedSeq = -1; // 이미 판정한 상대 공격 번호
    this.remoteOverrideUntil = 0; // 내가 패링한 상대를 경직으로 보여주는 예측 구간
    this.sinceSnapshot = Infinity;
    this.sinceClock = 0;
    this.lastSent = { state: null, hp: null, seq: null };
    this.lastStates = [local.state, remote.state];
    this.disconnected = false;
  }

  /** 상대가 보낸 메시지 (다음 step에서 처리) */
  receive(msg) {
    this.inbox.push(msg);
  }

  /** 연결이 끊겼을 때 (로비가 호출) */
  notifyDisconnect() {
    this.inbox.push({ t: '_disconnect' });
  }

  // ── 진행 상황 (내 관점) ──
  get phase() {
    return this.isHost ? this.flow.phase : this.mirror.phase;
  }
  get round() {
    return this.isHost ? this.flow.round : this.mirror.round;
  }
  get timeLeftMs() {
    return this.isHost ? this.flow.timeLeftMs : this.mirror.timeLeftMs;
  }
  get roundsToWin() {
    return this.rules.match.roundsToWin;
  }
  get wins() {
    const w = this.isHost ? this.flow.wins : this.mirror.wins;
    return this.#toLocalPair(w);
  }
  get history() {
    const h = this.isHost ? this.flow.history : this.mirror.history;
    return h.map((r) => ({ ...r, winnerIndex: this.#toLocalIndex(r.winnerIndex) }));
  }
  /** 경기 종료 시 이긴 Fighter 또는 null(무승부). 진행 중이면 undefined. */
  get winner() {
    const i = this.isHost ? this.flow.winnerIndex : this.mirror.winnerIndex;
    return this.#fighterOf(i);
  }

  /** 경기 시작. 호스트만 라운드를 연다 (게스트는 호스트의 roundStart를 기다림). */
  start() {
    if (!this.isHost) return [];
    return this.#publishFlow(this.flow.start());
  }

  /**
   * @param {number} dtMs
   * @param {(dtMs:number) => void} control 내 캐릭터 조종 (FIGHT 중에만 호출)
   */
  step(dtMs, control) {
    const events = [];
    const dt = dtMs / 1000;
    this.time += dtMs;

    // 1. 받은 메시지
    for (const msg of this.inbox.splice(0)) this.#onMessage(msg, events);

    // 2. 시간 진행 (상대는 스냅샷 사이를 같은 상태 머신으로 예측)
    this.local.tick(dtMs);
    this.remote.tick(dtMs);

    // 3. 조작
    if (this.phase === PHASE.FIGHT && !this.disconnected) control?.(dtMs);
    else this.local.step(dt, 0, 0, [this.remote]);

    // 4. 상대 위치를 부드럽게 따라감
    this.#smoothRemote(dt);

    // 5. 상대 공격이 나를 맞혔는지 (맞는 쪽 기준 판정)
    if (this.phase === PHASE.FIGHT) this.#judgeIncoming(events);

    // 6. 내 KO
    if (this.local.hp <= 0 && !this.local.isDead) {
      this.local.die();
      events.push({ type: 'ko', fighter: this.local });
    }

    // 7. 라운드 진행
    if (this.isHost) this.#hostFlow(dtMs, events);
    else if (this.mirror.phase === PHASE.FIGHT) this.mirror.timeLeftMs = Math.max(0, this.mirror.timeLeftMs - dtMs);

    // 8. 내 상태 전송
    this.#maybeSendSnapshot(dtMs);

    // 9. 상태 변화 (효과음용)
    [this.local, this.remote].forEach((f, i) => {
      if (f.state !== this.lastStates[i]) {
        events.push({ type: 'state', fighter: f, from: this.lastStates[i], to: f.state });
        this.lastStates[i] = f.state;
      }
    });
    return events;
  }

  // ── 메시지 처리 ──
  #onMessage(msg, events) {
    switch (msg?.t) {
      case 's':
        if (isValidSnapshot(msg)) this.#applySnapshot(msg, events);
        break;
      case 'hit':
        if (isValidHitResult(msg)) this.#applyHitResult(msg, events);
        break;
      case 'flow':
        if (!this.isHost && isValidFlow(msg)) this.#applyFlow(msg.e, events);
        break;
      case 'clock':
        if (!this.isHost && isValidClock(msg) && msg.rd === this.mirror.round) this.mirror.timeLeftMs = msg.tl;
        break;
      case '_disconnect':
        if (!this.disconnected) {
          this.disconnected = true;
          events.push({ type: 'disconnect' });
        }
        break;
    }
  }

  #applySnapshot(m, events) {
    if (m.rd < this.round) return; // 이전 라운드에 보낸 늦은 데이터
    const r = this.remote;
    this.remoteTarget = { x: m.x, y: m.y, z: m.z, yaw: m.yaw };
    r.hp = Math.min(m.hp, r.stats.maxHp);
    r.attackSeq = m.seq;

    // 내가 패링해서 경직 중으로 보여주는 동안엔, 상대가 그걸 알기 전에 보낸 상태로 되돌리지 않는다
    const predicted = this.time < this.remoteOverrideUntil && m.st !== STATE.STAGGERED && m.st !== STATE.DEAD;
    if (!predicted) {
      const wasDead = r.isDead;
      r.combat = { ...r.combat, state: m.st, elapsed: m.el, duration: m.du, guardHeld: m.gh };
      if (!wasDead && r.isDead) events.push({ type: 'ko', fighter: r });
    }
  }

  /** 내 공격에 대해 상대가 판정한 결과 */
  #applyHitResult(m, events) {
    if (m.rd < this.round) return;
    const result = {
      outcome: m.o,
      damage: m.dmg,
      attackerStaggerMs: m.ast,
      defenderStaggerMs: 0,
      backAttack: m.back,
      hitStopMs: 0,
    };
    if (m.o === OUTCOME.PARRIED && !this.local.isDead) this.local.stagger(m.ast);
    if (m.dmg > 0) this.remote.takeDamage(m.dmg); // 체력바 즉시 반영 (다음 스냅샷이 확정)
    events.push({ type: 'hit', attacker: this.local, defender: this.remote, result });
  }

  /** 게스트: 호스트가 보낸 라운드 진행 이벤트 */
  #applyFlow(e, events) {
    const mr = this.mirror;
    switch (e.type) {
      case 'roundStart':
        mr.round = e.round;
        mr.phase = PHASE.INTRO;
        mr.timeLeftMs = this.rules.match.roundTimeSec * 1000;
        break;
      case 'fight':
        mr.phase = PHASE.FIGHT;
        break;
      case 'roundEnd':
        mr.phase = PHASE.ROUND_END;
        mr.wins = [...e.wins];
        mr.history.push({ round: e.round, winnerIndex: e.winnerIndex, reason: e.reason });
        break;
      case 'matchEnd':
        mr.phase = PHASE.MATCH_END;
        mr.wins = [...e.wins];
        mr.winnerIndex = e.winnerIndex;
        break;
    }
    events.push(this.#toLocalEvent(e));
  }

  // ── 판정 ──
  #judgeIncoming(events) {
    const r = this.remote;
    const me = this.local;
    if (r.state !== STATE.ATTACK_ACTIVE || r.attackSeq === this.lastResolvedSeq || me.isDead) return;

    const atk = { x: r.position.x, z: r.position.z, yaw: r.yaw };
    const tgt = { x: me.position.x, z: me.position.z, radius: me.radius };
    if (!isInAttackArc(atk, tgt, r.stats.range, r.stats.arcDeg)) return; // 판정 구간 동안 계속 확인

    this.lastResolvedSeq = r.attackSeq; // 한 번의 공격은 한 번만
    const back = isBackAttack(atk, { ...tgt, yaw: me.yaw }, this.rules.backAttack.angleDeg);
    const result = resolveHit({
      defenderState: me.state,
      isBack: back,
      damage: r.stats.damage * me.stats.damageTakenMul,
      attackerRemainingMs: r.stats.activeMs - r.combat.elapsed + r.stats.recoveryMs,
      rules: this.rules,
    });

    if (result.outcome === OUTCOME.PARRIED) {
      me.combat = onParrySuccess(me.combat);
      // 상대는 이 결과를 받아야 경직되지만, 내 화면에선 바로 경직된 것으로 보여준다
      r.stagger(result.attackerStaggerMs);
      this.remoteOverrideUntil = this.time + this.rules.online.predictedStaggerMs;
    }
    if (result.damage > 0) me.takeDamage(result.damage);
    if (result.defenderStaggerMs > 0) me.stagger(result.defenderStaggerMs);

    this.send(makeHitResult(this.round, r.attackSeq, result));
    this.sinceSnapshot = Infinity; // 바뀐 내 상태를 바로 보낸다
    events.push({ type: 'hit', attacker: r, defender: me, result });
  }

  // ── 호스트: 라운드 진행 ──
  #hostFlow(dtMs, events) {
    let flowEvents;
    if (this.flow.phase === PHASE.FIGHT && (this.local.isDead || this.remote.isDead)) {
      const winner = this.local.isDead && this.remote.isDead ? null : this.local.isDead ? 1 : 0;
      flowEvents = this.flow.endRound('ko', winner, [this.local.hp, this.remote.hp]);
    } else {
      const ratios = () => [this.local.hp / this.local.stats.maxHp, this.remote.hp / this.remote.stats.maxHp];
      flowEvents = this.flow.step(dtMs, ratios);
    }
    events.push(...this.#publishFlow(flowEvents));

    this.sinceClock += dtMs;
    if (this.sinceClock >= this.rules.online.clockIntervalMs) {
      this.sinceClock = 0;
      this.send({ t: 'clock', rd: this.flow.round, tl: Math.round(this.flow.timeLeftMs) });
    }
  }

  /** 호스트: 진행 이벤트를 게스트에게 보내고, 내 관점 이벤트로 바꿔 돌려준다 */
  #publishFlow(flowEvents) {
    return flowEvents.map((e) => {
      this.send({ t: 'flow', e });
      return this.#toLocalEvent(e);
    });
  }

  /** 호스트 기준 진행 이벤트 → 내 관점 이벤트 (라운드 시작 시 위치 초기화) */
  #toLocalEvent(e) {
    switch (e.type) {
      case 'roundStart':
        this.#resetPositions();
        return { type: 'roundStart', round: e.round };
      case 'fight':
        return { type: 'fight', round: e.round };
      case 'roundEnd':
        return { type: 'roundEnd', round: e.round, reason: e.reason, winner: this.#fighterOf(e.winnerIndex), wins: this.#toLocalPair(e.wins) };
      case 'matchEnd':
        return { type: 'matchEnd', winner: this.#fighterOf(e.winnerIndex), wins: this.#toLocalPair(e.wins) };
      default:
        return e;
    }
  }

  #resetPositions() {
    const { playerSpawn: hostSpawn, opponentSpawn: guestSpawn } = this.rules;
    const [mine, theirs] = this.isHost ? [hostSpawn, guestSpawn] : [guestSpawn, hostSpawn];
    this.local.resetForRound({ x: mine.x, z: mine.z, yaw: yawToward(mine.x, mine.z, theirs.x, theirs.z) });
    this.remote.resetForRound({ x: theirs.x, z: theirs.z, yaw: yawToward(theirs.x, theirs.z, mine.x, mine.z) });
    this.remoteTarget = { ...this.remote.position, yaw: this.remote.yaw };
    this.remoteOverrideUntil = 0;
    this.sinceSnapshot = Infinity;
  }

  // ── 전송 ──
  #maybeSendSnapshot(dtMs) {
    this.sinceSnapshot += dtMs;
    const f = this.local;
    const changed = f.state !== this.lastSent.state || f.hp !== this.lastSent.hp || f.attackSeq !== this.lastSent.seq;
    if (!changed && this.sinceSnapshot < this.rules.online.snapshotIntervalMs) return;
    this.sinceSnapshot = 0;
    this.lastSent = { state: f.state, hp: f.hp, seq: f.attackSeq };
    this.send(makeSnapshot(f, this.round));
  }

  #smoothRemote(dt) {
    const r = this.remote;
    const t = this.remoteTarget;
    const k = 1 - Math.exp(-this.rules.online.remoteSmoothing * dt);
    // 너무 멀리 벗어났으면 (라운드 시작·순간 이동) 바로 맞춘다
    if (Math.hypot(t.x - r.position.x, t.z - r.position.z) > 3) {
      r.position.x = t.x;
      r.position.z = t.z;
    } else {
      r.position.x += (t.x - r.position.x) * k;
      r.position.z += (t.z - r.position.z) * k;
    }
    r.position.y += (t.y - r.position.y) * k;
    let diff = (t.yaw - r.yaw) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    r.yaw = turnToward(r.yaw, t.yaw, Math.abs(diff) * k);
  }

  // ── 관점 변환 ──
  #toLocalIndex(i) {
    if (i === null || i === undefined) return i;
    return i === this.localIndex ? 0 : 1;
  }
  #toLocalPair(pair) {
    return this.isHost ? [pair[0], pair[1]] : [pair[1], pair[0]];
  }
  #fighterOf(hostIndex) {
    if (hostIndex === null || hostIndex === undefined) return hostIndex;
    return hostIndex === this.localIndex ? this.local : this.remote;
  }
}
