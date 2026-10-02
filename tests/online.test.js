// 온라인 대전 테스트 — 실제 네트워크 대신 지연을 흉내 내는 가짜 연결로 두 사람을 연결한다
import { describe, it, expect } from 'vitest';
import { Fighter } from '../src/game/fighter.js';
import { OnlineDuel } from '../src/net/onlineDuel.js';
import { PHASE } from '../src/game/roundFlow.js';
import { STATE } from '../src/core/stateMachine.js';
import { OUTCOME } from '../src/core/combat.js';
import { yawToward } from '../src/core/physics.js';
import { generateRoomCode, normalizeRoomCode, isValidRoomCode, peerIdForRoom } from '../src/net/roomCode.js';
import { makeHello, parseHello, makeSnapshot, isValidSnapshot, isValidFlow } from '../src/net/protocol.js';
import { seededRandom } from '../src/core/random.js';
import { CONFIG } from '../src/config.js';

const STEP = 1000 / 120;
const LATENCY = 60; // 한쪽 방향 지연 (ms)

/** 두 사람을 잇는 가짜 연결. 메시지는 JSON으로 직렬화해서 LATENCY 뒤에 도착한다. */
function createLink(latency = LATENCY) {
  let now = 0;
  const queue = [];
  const receivers = [null, null];
  const sender = (from) => (msg) => queue.push({ to: 1 - from, at: now + latency, msg: JSON.parse(JSON.stringify(msg)) });
  return {
    senders: [sender(0), sender(1)],
    connect(a, b) {
      receivers[0] = a;
      receivers[1] = b;
    },
    advance(dt) {
      now += dt;
      for (let i = 0; i < queue.length; ) {
        if (queue[i].at <= now) receivers[queue[i].to].receive(queue.splice(i, 1)[0].msg);
        else i++;
      }
    },
  };
}

function setup() {
  const link = createLink();
  const hostMe = new Fighter({ name: 'host' });
  const guestMe = new Fighter({ name: 'guest' });
  const host = new OnlineDuel({ role: 'host', send: link.senders[0], local: hostMe, remote: new Fighter() });
  const guest = new OnlineDuel({ role: 'guest', send: link.senders[1], local: guestMe, remote: new Fighter() });
  link.connect(host, guest);
  const log = { host: [], guest: [] };
  log.host.push(...host.start());
  return { link, host, guest, hostMe, guestMe, log };
}

/** 두 사람의 게임을 함께 진행. controls: { host?: fn, guest?: fn } */
function run(ctx, ms, controls = {}) {
  for (let t = 0; t < ms; t += STEP) {
    ctx.log.host.push(...ctx.host.step(STEP, (dtMs) => {
      controls.host?.();
      ctx.hostMe.step(dtMs / 1000, 0, 0, [ctx.host.remote]);
    }));
    ctx.log.guest.push(...ctx.guest.step(STEP, (dtMs) => {
      controls.guest?.();
      ctx.guestMe.step(dtMs / 1000, 0, 0, [ctx.guest.remote]);
    }));
    ctx.link.advance(STEP);
  }
}

/** FIGHT까지 진행하고, 두 사람을 마주 보게 가까이 세운다 */
function toCloseFight(ctx, distance = 1.8) {
  run(ctx, CONFIG.match.introMs + LATENCY * 3);
  ctx.hostMe.position.x = 0;
  ctx.hostMe.position.z = 0;
  ctx.guestMe.position.x = 0;
  ctx.guestMe.position.z = -distance;
  ctx.hostMe.yaw = yawToward(0, 0, 0, -distance);
  ctx.guestMe.yaw = yawToward(0, -distance, 0, 0);
  run(ctx, 300); // 위치가 상대 화면에도 반영되도록
}

const hits = (events) => events.filter((e) => e.type === 'hit');
const HIT_DAMAGE = CONFIG.attack.damage * CONFIG.player.damageTakenMul;

describe('방 코드', () => {
  it('정해진 길이·글자로 만들어진다', () => {
    const code = generateRoomCode(seededRandom(1));
    expect(code).toHaveLength(CONFIG.online.codeLength);
    expect(isValidRoomCode(code)).toBe(true);
  });

  it('입력값 정리: 소문자·공백·하이픈 허용', () => {
    expect(normalizeRoomCode(' ab-c 2k9 ')).toBe('ABC2K9');
  });

  it('헷갈리는 글자(O, 0, I, 1)나 길이가 틀린 코드는 거부', () => {
    expect(isValidRoomCode('ABCDE0')).toBe(false);
    expect(isValidRoomCode('ABCDEI')).toBe(false);
    expect(isValidRoomCode('ABCDE')).toBe(false);
  });

  it('PeerJS 주소에 접두어가 붙는다', () => {
    expect(peerIdForRoom('ABCDEF')).toBe(CONFIG.online.peerPrefix + 'ABCDEF');
  });
});

describe('메시지 검증', () => {
  const build = { attack: 3, defense: 3, attackSpeed: 3, moveSpeed: 3, range: 3 };

  it('정상 hello는 통과', () => {
    const r = parseHello(makeHello({ name: '내 빌드', build }));
    expect(r).toEqual({ ok: true, name: '내 빌드', build });
  });

  it('버전이 다르면 거부', () => {
    expect(parseHello({ ...makeHello({ name: 'a', build }), v: 999 }).ok).toBe(false);
  });

  it('규칙을 어긴 빌드(치트)는 거부', () => {
    const cheat = { attack: 5, defense: 5, attackSpeed: 5, moveSpeed: 5, range: 5 };
    expect(parseHello(makeHello({ name: 'a', build: cheat })).ok).toBe(false);
  });

  it('스냅샷: 정상은 통과, 이상한 값은 거부', () => {
    const snap = makeSnapshot(new Fighter(), 1);
    expect(isValidSnapshot(snap)).toBe(true);
    expect(isValidSnapshot({ ...snap, x: NaN })).toBe(false);
    expect(isValidSnapshot({ ...snap, st: 'GOD_MODE' })).toBe(false);
    expect(isValidSnapshot({ ...snap, hp: '100' })).toBe(false);
  });

  it('진행 이벤트: 형식이 틀리면 거부', () => {
    expect(isValidFlow({ t: 'flow', e: { type: 'roundStart', round: 1 } })).toBe(true);
    expect(isValidFlow({ t: 'flow', e: { type: 'roundEnd', round: 1, reason: 'ko', winnerIndex: 5, wins: [1, 0] } })).toBe(false);
    expect(isValidFlow({ t: 'flow', e: { type: 'explode' } })).toBe(false);
  });
});

describe('OnlineDuel (지연 60ms)', () => {
  it('호스트가 라운드를 열면 게스트도 같은 단계로 따라간다', () => {
    const ctx = setup();
    expect(ctx.host.phase).toBe(PHASE.INTRO);
    run(ctx, CONFIG.match.introMs + LATENCY * 3);
    expect(ctx.host.phase).toBe(PHASE.FIGHT);
    expect(ctx.guest.phase).toBe(PHASE.FIGHT);
    expect(ctx.log.guest.some((e) => e.type === 'roundStart')).toBe(true);
    expect(ctx.log.guest.some((e) => e.type === 'fight')).toBe(true);
  });

  it('서로 반대편에서 시작하고, 상대 화면에도 내 위치가 보인다', () => {
    const ctx = setup();
    run(ctx, 500);
    expect(ctx.hostMe.position.z).toBe(CONFIG.playerSpawn.z);
    expect(ctx.guestMe.position.z).toBe(CONFIG.opponentSpawn.z);
    expect(ctx.guest.remote.position.z).toBeCloseTo(CONFIG.playerSpawn.z, 1);
    expect(ctx.host.remote.position.z).toBeCloseTo(CONFIG.opponentSpawn.z, 1);
  });

  it('게스트의 공격이 호스트에게 맞는다 — 맞은 쪽(호스트)이 판정하고 결과를 알린다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guestMe.tryAttack();
    run(ctx, 1000);
    expect(ctx.hostMe.hp).toBeCloseTo(CONFIG.player.maxHp - HIT_DAMAGE);
    expect(hits(ctx.log.host).filter((e) => e.defender === ctx.hostMe)).toHaveLength(1);
    // 게스트는 결과를 전달받는다
    const g = hits(ctx.log.guest);
    expect(g).toHaveLength(1);
    expect(g[0].attacker).toBe(ctx.guestMe);
    expect(g[0].result.outcome).toBe(OUTCOME.HIT);
    // 게스트 화면의 호스트 체력도 같아진다
    expect(ctx.guest.remote.hp).toBeCloseTo(ctx.hostMe.hp);
  });

  it('호스트가 자기 화면 기준 타이밍으로 패링하면, 공격한 게스트가 경직된다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guestMe.tryAttack();
    // 호스트 화면에서 게스트 예비동작이 보이기 시작한 뒤, 판정 직전에 우클릭
    let pressed = false;
    let guestStaggered = false;
    for (let t = 0; t < 1500; t += STEP) {
      run(ctx, STEP, {
        host: () => {
          const r = ctx.host.remote;
          if (!pressed && r.state === STATE.ATTACK_WINDUP && r.combat.elapsed >= r.stats.windupMs - 60) {
            ctx.hostMe.guardDown();
            ctx.hostMe.guardUp();
            pressed = true;
          }
        },
      });
      if (ctx.guestMe.state === STATE.STAGGERED) guestStaggered = true;
    }
    expect(pressed).toBe(true);
    expect(ctx.hostMe.hp).toBe(CONFIG.player.maxHp);
    expect(guestStaggered).toBe(true);
    expect(hits(ctx.log.guest)[0].result.outcome).toBe(OUTCOME.PARRIED);
  });

  it('방어 중인 게스트는 호스트 공격을 막는다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guestMe.guardDown();
    run(ctx, 400);
    ctx.hostMe.tryAttack();
    run(ctx, 1000);
    const g = hits(ctx.log.guest);
    expect(g[0].result.outcome).toBe(OUTCOME.GUARDED);
    expect(hits(ctx.log.host)[0].result.outcome).toBe(OUTCOME.GUARDED);
  });

  it('한 번의 공격은 한 번만 판정된다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guestMe.tryAttack();
    run(ctx, 2000);
    expect(hits(ctx.log.host)).toHaveLength(1);
  });

  it('게스트가 KO되면 호스트가 라운드를 끝내고, 양쪽 모두 자기 관점의 승수를 본다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guestMe.hp = 5;
    ctx.hostMe.tryAttack();
    run(ctx, 1200);
    const hostEnd = ctx.log.host.find((e) => e.type === 'roundEnd');
    const guestEnd = ctx.log.guest.find((e) => e.type === 'roundEnd');
    expect(hostEnd.winner).toBe(ctx.hostMe);
    expect(guestEnd.winner).toBe(ctx.guest.remote);
    expect(ctx.host.wins).toEqual([1, 0]);
    expect(ctx.guest.wins).toEqual([0, 1]);
    expect(ctx.guest.history[0].winnerIndex).toBe(1); // 게스트 관점: 상대(1)가 이김
  });

  it('다음 라운드에는 둘 다 체력이 회복되고 시작 위치로 돌아간다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guestMe.hp = 5;
    ctx.hostMe.tryAttack();
    run(ctx, 1200 + CONFIG.match.roundEndMs + LATENCY * 3);
    expect(ctx.guest.round).toBe(2);
    expect(ctx.guestMe.hp).toBe(CONFIG.player.maxHp);
    expect(ctx.guestMe.state).toBe(STATE.IDLE);
    expect(ctx.guestMe.position.z).toBe(CONFIG.opponentSpawn.z);
  });

  it('2승하면 양쪽 모두 경기 종료 — 승자가 서로 맞게 보인다', () => {
    const ctx = setup();
    for (let round = 0; round < 2; round++) {
      toCloseFight(ctx);
      ctx.guestMe.hp = 5;
      ctx.hostMe.tryAttack();
      run(ctx, 1200 + CONFIG.match.roundEndMs + LATENCY * 3);
    }
    const hostEnd = ctx.log.host.find((e) => e.type === 'matchEnd');
    const guestEnd = ctx.log.guest.find((e) => e.type === 'matchEnd');
    expect(hostEnd.winner).toBe(ctx.hostMe);
    expect(guestEnd.winner).toBe(ctx.guest.remote);
    expect(ctx.guest.winner).toBe(ctx.guest.remote);
    expect(ctx.guest.phase).toBe(PHASE.MATCH_END);
  });

  it('시간 초과는 호스트가 체력 비율로 판정하고 게스트에게 알린다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.hostMe.hp = 30; // 호스트가 더 적음 → 게스트 승
    run(ctx, CONFIG.match.roundTimeSec * 1000 + 500);
    const guestEnd = ctx.log.guest.find((e) => e.type === 'roundEnd');
    expect(guestEnd.reason).toBe('time');
    expect(guestEnd.winner).toBe(ctx.guestMe);
    expect(ctx.guest.timeLeftMs).toBeLessThan(1000);
  });

  it('연결이 끊기면 이벤트로 알리고 조작이 멈춘다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.guest.notifyDisconnect();
    let controlled = false;
    run(ctx, 100, { guest: () => (controlled = true) });
    expect(ctx.log.guest.some((e) => e.type === 'disconnect')).toBe(true);
    expect(controlled).toBe(false);
  });

  it('상대가 보낸 이상한 메시지는 무시한다', () => {
    const ctx = setup();
    toCloseFight(ctx);
    ctx.host.receive({ t: 's', x: 'hack' });
    ctx.host.receive({ t: 'hit', o: 'INSTANT_KILL', dmg: 9999 });
    ctx.host.receive({ t: 'flow', e: { type: 'matchEnd', winnerIndex: 1, wins: [0, 9] } }); // 게스트가 보낸 진행 이벤트
    run(ctx, 200);
    expect(ctx.hostMe.hp).toBe(CONFIG.player.maxHp);
    expect(ctx.host.phase).toBe(PHASE.FIGHT);
  });
});
