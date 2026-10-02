// 진입점, 게임 루프, 화면 전환

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { yawToward } from './core/physics.js';
import { STATE } from './core/stateMachine.js';
import { OUTCOME } from './core/combat.js';
import { deriveStats } from './core/stats.js';
import { Fighter } from './game/fighter.js';
import { Input, PlayerController } from './game/player.js';
import { DummyController } from './game/dummy.js';
import { BotController } from './game/bot.js';
import { Duel } from './game/duel.js';
import { Match } from './game/match.js';
import { BuildStore } from './game/buildStore.js';
import { OnlineDuel } from './net/onlineDuel.js';
import { Lobby } from './net/lobby.js';
import { hostRoom, joinRoom } from './net/peer.js';
import { createArenaScene } from './render/scene.js';
import { createFighterView } from './render/fighterView.js';
import { ViewModel } from './render/viewModel.js';
import { Effects } from './render/effects.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { BuildEditor } from './ui/buildEditor.js';
import { OnlineMenu } from './ui/onlineMenu.js';
import { Sfx } from './audio/sfx.js';

// ── 렌더러 ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
document.getElementById('app').appendChild(renderer.domElement);

// ── 씬과 카메라 ──
const scene = createArenaScene();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ'; // yaw → pitch 순서 (FPS 카메라)

const viewModel = new ViewModel(window.innerWidth / window.innerHeight);
const effects = new Effects(scene, document.getElementById('flash'));
const hud = new Hud(document.getElementById('hud'));
const sfx = new Sfx();
const input = new Input(renderer.domElement);

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  viewModel.setAspect(aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── 게임 세션 ──
// mode: 'menu'(시작 화면) | 'playing'(경기·연습 중, 일시정지 포함) | 'result'(결과 화면)
let mode = 'menu';
/** @type {null | { kind:'match'|'practice', difficulty?:string, opponentLabel:string, player:Fighter, opponent:Fighter, controller:PlayerController, brain:BotController|DummyController, match:Match|null, duel:Duel|null, view:ReturnType<typeof createFighterView> }} */
let session = null;
let resultAt = null; // 결과 화면을 띄울 시각 (performance.now 기준)

const buildStore = new BuildStore();

const menus = new Menus({
  onStart: (kind, difficulty) => startSession(kind, difficulty, menus.opponentBuildChoice),
  onResume: () => {
    sfx.unlock();
    input.requestLock();
  },
  onQuit: () => quitToMenu(),
  onRetry: () => {
    if (session?.kind === 'online') {
      // 재대결: 다시 준비 → 둘 다 준비되면 시작
      lobby.setReady();
      menus.show('online');
    } else {
      startSession(session.kind, session.difficulty, session.opponentChoice);
    }
  },
  onEditBuild: () => {
    buildEditor.open();
    menus.show('builds');
  },
});

const buildEditor = new BuildEditor(buildStore, {
  onClose: () => {
    menus.setCurrentBuild(buildStore.getCurrent());
    menus.show('start');
  },
});

// ── 온라인 대전 ──
const lobby = new Lobby({
  net: { hostRoom, joinRoom },
  getMyInfo: () => {
    const b = buildStore.getCurrent();
    return { name: b.name, build: b.stats };
  },
  onChange: (state) => {
    onlineMenu.render(state);
    // 결과 화면에서 상대가 나가면 재대결 버튼을 숨긴다
    if (mode === 'result' && session?.kind === 'online' && state.status === 'error') menus.setRetryEnabled(false);
  },
  onBegin: (role, remote) => startOnlineSession(role, remote),
});
const onlineMenu = new OnlineMenu(lobby, {
  show: () => menus.show('online'),
  onLeave: () => quitToMenu(),
});

function startOnlineSession(role, remote) {
  try {
    if (session) scene.remove(session.view.group);
    const myBuild = buildStore.getCurrent();
    const player = new Fighter({ name: `나 · ${myBuild.name}`, stats: deriveStats(myBuild.stats) });
    const opponent = new Fighter({ name: `상대 · ${remote.name}`, stats: deriveStats(remote.build) });
    const controller = new PlayerController(player, input);
    const online = new OnlineDuel({ role, send: (m) => lobby.send(m), local: player, remote: opponent });
    lobby.game = online;

    const view = createFighterView(CONFIG.online.opponentColor, { reach: opponent.stats.range / CONFIG.attack.range });
    scene.add(view.group);
    viewModel.setReach(player.stats.range / CONFIG.attack.range);
    session = { kind: 'online', opponentLabel: opponent.name, player, opponent, controller, brain: null, match: null, duel: null, online, view };

    hud.setNames(player.name, opponent.name);
    hud.setMode('match');
    resetFrameState();
    resultAt = null;
    mode = 'playing';
    menus.hide();
    sfx.unlock();
    input.consumeEvents();
    // 네트워크로 시작 신호를 받은 경우엔 브라우저가 마우스 잠금을 거부할 수 있다 → 일시정지 화면의 '계속하기'로 입장
    input.requestLock();
    handleEvents(online.start());
  } catch (err) {
    window.__showFatal?.(err?.stack ?? String(err));
    quitToMenu();
  }
}

/** 상대 빌드 선택값 → 프리셋 ('random'이면 매번 무작위) */
function pickOpponentBuild(choice) {
  const keys = Object.keys(CONFIG.bot.builds);
  const key = choice in CONFIG.bot.builds ? choice : keys[Math.floor(Math.random() * keys.length)];
  return CONFIG.bot.builds[key];
}

/** 시작 중 오류가 나면 화면이 멈춘 채로 두지 않고, 오류를 보여주고 시작 화면으로 되돌린다 */
function startSession(kind, difficulty, opponentChoice) {
  try {
    beginSession(kind, difficulty, opponentChoice);
  } catch (err) {
    window.__showFatal?.(err?.stack ?? String(err));
    quitToMenu();
  }
}

function beginSession(kind, difficulty, opponentChoice = 'random') {
  if (session) scene.remove(session.view.group);

  const spawns = [CONFIG.playerSpawn, CONFIG.opponentSpawn];
  const myBuild = buildStore.getCurrent();
  const player = new Fighter({ name: `나 · ${myBuild.name}`, stats: deriveStats(myBuild.stats) });
  const controller = new PlayerController(player, input);
  let opponent, brain, match = null, duel = null, color;

  if (kind === 'match') {
    const diff = CONFIG.bot.difficulties[difficulty];
    const preset = pickOpponentBuild(opponentChoice);
    opponent = new Fighter({ name: `봇 · ${diff.label} · ${preset.label}`, stats: deriveStats(preset.stats) });
    color = diff.color;
    brain = new BotController(opponent, difficulty);
    match = new Match([player, opponent], { spawns });
  } else {
    opponent = new Fighter({ name: '허수아비' });
    color = 0xb0463c;
    brain = new DummyController(opponent);
    duel = new Duel([player, opponent]);
    placeAtSpawns(player, opponent);
  }
  const opponentLabel = opponent.name;

  // 공격범위 스탯만큼 칼 길이도 달라 보이게
  const view = createFighterView(color, { reach: opponent.stats.range / CONFIG.attack.range });
  scene.add(view.group);
  viewModel.setReach(player.stats.range / CONFIG.attack.range);
  session = { kind, difficulty, opponentChoice, opponentLabel, player, opponent, controller, brain, match, duel, view };

  hud.setNames(player.name, opponentLabel);
  hud.setMode(kind);
  resetFrameState();
  resultAt = null;
  mode = 'playing';
  menus.hide();
  sfx.unlock();
  input.consumeEvents();
  input.requestLock();
  if (match) handleEvents(match.start());
}

function placeAtSpawns(player, opponent) {
  const [a, b] = [CONFIG.playerSpawn, CONFIG.opponentSpawn];
  player.resetForRound({ x: a.x, z: a.z, yaw: yawToward(a.x, a.z, b.x, b.z) });
  opponent.resetForRound({ x: b.x, z: b.z, yaw: yawToward(b.x, b.z, a.x, a.z) });
}

function quitToMenu() {
  if (lobby.state.status !== 'idle') lobby.leave();
  if (session) scene.remove(session.view.group);
  session = null;
  resultAt = null;
  mode = 'menu';
  menus.setCurrentBuild(buildStore.getCurrent());
  menus.show('start');
}

function showResult() {
  const { player, opponentLabel } = session;
  const match = session.match ?? session.online;
  const online = session.kind === 'online';
  mode = 'result';
  hud.setVisible(false);
  if (document.pointerLockElement) document.exitPointerLock();
  if (online) lobby.endGame();

  const reasonText = { ko: 'KO', time: '판정' };
  const ended = match.winner !== undefined;
  menus.showResult({
    outcome: !ended ? 'disconnect' : match.winner === player ? 'win' : match.winner ? 'lose' : 'draw',
    retryLabel: online ? '재대결' : '다시 하기',
    canRetry: !online || lobby.state.status === 'connected',
    opponentLabel,
    wins: match.wins,
    rounds: match.history.map((h) => {
      if (h.winnerIndex === null) return { round: h.round, text: '무승부', cls: 'draw' };
      const won = h.winnerIndex === 0;
      return { round: h.round, text: `${won ? '승리' : '패배'} (${reasonText[h.reason]})`, cls: won ? 'win' : 'lose' };
    }),
  });
}

input.onLockChange = (locked) => {
  hud.setVisible(locked && mode === 'playing');
  if (locked) menus.hide();
  else if (mode === 'playing') showPause();
};
input.onLockError = () => {
  if (mode === 'playing') showPause();
};

function showPause() {
  const hints = {
    match: '경기 시간은 멈춰 있습니다.',
    practice: '패링 연습 중 — 허수아비가 일정 간격으로 공격합니다.',
    online: '온라인 대전은 멈추지 않습니다! 계속하기를 눌러 경기로 돌아가세요.',
  };
  menus.showPause(hints[session?.kind] ?? '');
}

// ── 전투 이벤트 → 연출 ──
function contactPoint(attacker, defender) {
  const dx = attacker.position.x - defender.position.x;
  const dz = attacker.position.z - defender.position.z;
  const d = Math.hypot(dx, dz) || 1;
  const r = defender.radius + 0.15;
  return new THREE.Vector3(defender.position.x + (dx / d) * r, defender.position.y + 1.3, defender.position.z + (dz / d) * r);
}

function onHit({ attacker, defender, result }) {
  const playerDefends = defender === session.player;
  const point = contactPoint(attacker, defender);
  const fx = CONFIG.effects;
  effects.hitStop(result.hitStopMs);

  switch (result.outcome) {
    case OUTCOME.PARRIED:
      effects.flash('#ffffff', fx.parryFlashOpacity);
      effects.shake(fx.parryShake, 220);
      effects.burst(point, 0xfff1a8, 28, 6);
      sfx.parry();
      hud.popup(playerDefends ? '패링!' : '패링당함', playerDefends ? '#7fe6ff' : '#ff8a7a', { big: playerDefends });
      break;

    case OUTCOME.GUARDED:
      effects.burst(point, 0xffb347, 10, 3.5);
      if (playerDefends) effects.shake(fx.guardShake, 120);
      sfx.guard();
      break;

    case OUTCOME.HIT:
      effects.burst(point, 0xff5a4a, 12, 4);
      sfx.hit();
      if (playerDefends) {
        effects.flash('#ff2a2a', fx.hurtFlashOpacity);
        effects.shake(fx.hitShake, 200);
      } else {
        session.view.flashHurt();
        effects.shake(fx.guardShake, 100);
      }
      if (result.backAttack) hud.popup(playerDefends ? '백어택 당함' : '백어택!', '#ffcf4a');
      break;
  }
}

function onRoundEnd({ reason, winner }) {
  const won = winner === session.player;
  const lost = winner !== null && !won;
  let text;
  if (reason === 'ko') text = won ? 'K.O.!' : lost ? '쓰러졌다…' : '더블 K.O.';
  else text = won ? 'TIME — 판정승' : lost ? 'TIME — 판정패' : 'TIME — 무승부';
  hud.popup(text, won ? '#ffcf4a' : lost ? '#ff8a7a' : '#ffffff', { big: true, ms: 2200 });
}

function handleEvents(events) {
  const { player, opponent } = session;
  for (const ev of events) {
    switch (ev.type) {
      case 'state':
        if (ev.to === STATE.ATTACK_WINDUP && ev.fighter !== player) sfx.windup(ev.fighter.stats.windupMs);
        if (ev.to === STATE.ATTACK_ACTIVE) sfx.swing(ev.fighter === player ? 1 : 0.7);
        break;
      case 'hit':
        onHit(ev);
        break;
      case 'ko':
        sfx.ko();
        if (session.kind === 'practice') {
          if (ev.fighter === player) hud.popup('쓰러졌다…', '#ff8a7a', { big: true, ms: 1800 });
          else hud.popup('K.O.', '#ffcf4a', { big: true, ms: 1800 });
        }
        break;

      // ── 경기 흐름 ──
      case 'roundStart':
        session.brain?.reset();
        session.controller.reset();
        resetFrameState();
        hud.popup(`ROUND ${ev.round}`, '#ffffff', { big: true, ms: 1300 });
        break;
      case 'fight':
        session.controller.reset(); // 라운드 소개 중에 눌린 입력은 버린다
        sfx.bell();
        hud.popup('FIGHT!', '#ffcf4a', { big: true, ms: 900 });
        break;
      case 'roundEnd':
        onRoundEnd(ev);
        break;
      case 'matchEnd':
        resultAt = performance.now() + CONFIG.match.resultDelayMs;
        break;
      case 'disconnect':
        hud.popup('상대와의 연결이 끊겼습니다', '#ff8a7a', { big: true, ms: 1500 });
        resultAt = performance.now() + CONFIG.match.resultDelayMs;
        break;

      // ── 패링 연습: KO 후 자동 재시작 ──
      case 'reset':
        opponent.position.x = CONFIG.opponentSpawn.x;
        opponent.position.z = CONFIG.opponentSpawn.z;
        opponent.yaw = yawToward(opponent.position.x, opponent.position.z, player.position.x, player.position.z);
        session.brain.reset();
        hud.popup('다시!', '#ffffff');
        break;
    }
  }
}

// ── 게임 루프 ──
const clock = new THREE.Clock();
const SIM_DT = 1 / CONFIG.sim.stepHz;
const MAX_STEPS_PER_FRAME = 8;
let accumulator = 0;
let eyeHeight = CONFIG.player.eyeHeight;

function resetFrameState() {
  accumulator = 0;
  eyeHeight = CONFIG.player.eyeHeight;
}

function simulate(dt) {
  const { player, opponent, controller, brain, match, duel, online } = session;
  const control = () => {
    controller.update(dt, [opponent]);
    brain?.update(dt, player);
  };
  const ms = dt * 1000;
  const events = online ? online.step(ms, control) : match ? match.step(ms, control) : duel.step(ms, control);
  handleEvents(events);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  effects.update(dt);

  // 온라인 대전은 상대가 계속 움직이므로 일시정지 중에도 진행한다
  const online = session?.kind === 'online';
  if (session && mode === 'playing' && (input.locked || online)) {
    if (input.locked) session.controller.look();
    // 고정 간격 시뮬레이션. 히트스톱 중에는 멈춘다 (시점 회전은 계속 가능).
    // 온라인에선 멈추지 않는다 — 내 쪽만 멈추면 상대와 시간이 어긋난다 (번쩍임·흔들림 연출은 그대로)
    if (effects.frozen && !online) {
      accumulator = 0;
    } else {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME && !effects.frozen) {
        simulate(SIM_DT);
        accumulator -= SIM_DT;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
    }
  }

  if (resultAt !== null && performance.now() >= resultAt) {
    resultAt = null;
    showResult();
  }

  renderer.clear();
  if (session) renderFirstPerson(dt);
  else renderMenuOrbit();
}

/** 경기 중: 플레이어 눈 위치에서 1인칭으로 */
function renderFirstPerson(dt) {
  const { player, opponent, controller, view } = session;
  const match = session.match ?? session.online;

  const targetEye = player.isDead ? CONFIG.camera.deadEyeHeight : CONFIG.player.eyeHeight;
  eyeHeight += (targetEye - eyeHeight) * (1 - Math.exp(-6 * dt));
  camera.position.set(player.position.x, player.position.y + eyeHeight, player.position.z);
  camera.rotation.set(controller.pitch, player.yaw, player.isDead ? 0.35 : 0);
  effects.applyShake(camera);

  view.update(opponent, dt);
  viewModel.update(
    dt,
    {
      speed: player.horizontalSpeed,
      onGround: player.onGround,
      justLanded: player.consumeLanded(),
      mouseDx: controller.lastMouse.dx,
      mouseDy: controller.lastMouse.dy,
    },
    { state: player.state, progress: player.stateProgress() },
  );
  hud.update(
    dt,
    player,
    opponent,
    match ? { timeLeftMs: match.timeLeftMs, wins: match.wins, roundsToWin: match.roundsToWin } : null,
  );

  // 월드 → (깊이 초기화) → 1인칭 칼 순서로 그린다
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(viewModel.scene, viewModel.camera);
}

/** 시작 화면 배경: 아레나 주위를 천천히 돈다 */
function renderMenuOrbit() {
  const t = performance.now() / 1000;
  camera.position.set(Math.sin(t * 0.12) * 12, 4, Math.cos(t * 0.12) * 12);
  camera.lookAt(0, 1, 0);
  renderer.render(scene, camera);
}

menus.setCurrentBuild(buildStore.getCurrent());
menus.show('start');
frame();
