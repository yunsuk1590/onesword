// 원소드 — 모든 게임 수치는 이 파일에서만 관리한다.
// 밸런스 조정은 이 파일만 고치면 되도록 한다.

export const CONFIG = {
  // ── 캐릭터 기본 ──
  player: {
    maxHp: 100,
    moveSpeed: 7, // m/s (이동속도 3칸)
    damageTakenMul: 0.85, // 받는 대미지 배율 (방어력 3칸)
    jumpPower: 6, // 점프 초기 수직 속도 (m/s)
    radius: 0.4, // 충돌 원 반지름
    height: 1.8, // 캡슐 전체 높이
    eyeHeight: 1.6, // 1인칭 카메라 높이
  },

  // ── 전투 ──
  attack: {
    damage: 13, // 공격력 3칸
    windupMs: 350, // 예비동작 (텔레그래프). 250은 반응하기에 너무 빡빡해서 상향
    activeMs: 100, // 판정 구간
    // 후딜레이. 막혔을 때 반응해서 반격하면 들어가도록 길게 잡음 (남은 550ms > 반응 ~150 + 예비동작 350).
    // Phase 4에서 공격속도 스탯으로 줄일 수 있다.
    recoveryMs: 450,
    range: 2.2, // 두 캐릭터 중심 사이 거리 기준
    arcDeg: 70, // 정면 부채꼴 전체 각도 (상대 몸 반지름만큼 여유를 더 준다)
    moveSpeedMul: 0.4, // 공격 중 이동 속도 배율
    inputBufferMs: 150, // 공격 불가 상태에서 누른 좌클릭을 이만큼 기억했다가 실행
  },
  guard: {
    damageTaken: 0.2, // 정면 방어 시 받는 대미지 비율
    moveSpeedMul: 0.5,
    hitStopMs: 40,
  },
  parry: {
    windowMs: 180, // 우클릭을 누른 순간부터 패링 유효 시간
    // 이전 패링 시도 후 이 시간이 지나야 다시 패링 판정이 생김 (그 전엔 일반 방어만).
    // 패링에 성공하면 즉시 초기화된다 → 실패한 시도(헛패링)만 이만큼 묶인다.
    retryCooldownMs: 1000,
    // 패링당한 공격자의 경직 시간. 반격 = 사람 반응(~300ms) + 예비동작(350ms)이 넉넉히 들어가도록.
    // (700ms는 반응이 조금만 늦어도 반격이 막히고, 반격의 후딜레이에 역으로 맞는 문제가 있었음)
    attackerStaggerMs: 1000,
    hitStopMs: 80,
  },
  hit: {
    // 방어 없이 맞았을 때의 경직 시간은 고정값이 아니라 "공격자에게 남은 판정+후딜레이 시간"으로 자동 계산한다.
    // → 맞은 쪽과 때린 쪽이 항상 동시에 행동 가능해져서, 공격속도가 빠른 빌드도 무한 연속기를 만들 수 없다.
    hitStopMs: 55,
  },
  // ── 스탯 커스터마이징 ──
  // 5종 스탯에 1~5칸씩, 총 15칸을 나눈다. 3칸 = 위의 기본 수치 (모두 3칸이면 기본 캐릭터).
  // 표의 n번째 값 = n칸일 때의 수치.
  stats: {
    total: 15,
    min: 1,
    max: 5,
    defaultLevel: 3,
    // 예비동작 하한선: 텔레그래프가 너무 짧아지면 반응 패링이 불가능해지고 모든 빌드가 공격속도로 몰린다
    minWindupMs: 280,
    // 단계마다 체감이 확실히 나도록 간격을 넓게 잡았다 (사용자 피드백).
    table: {
      // 기본 방어(85%) 상대 확정 타수: 17 / 12 / 10 / 7 / 6
      // 높은 단계를 더 많이 깎음 → 단계 차이는 유지하면서 저공격 빌드가 덜 불리하도록
      attack: { damage: [7, 10, 13, 17, 21] },
      defense: { damageTakenMul: [1.2, 1.0, 0.85, 0.72, 0.6] },
      // 공격속도는 주로 후딜레이를 줄인다 (막혀도 덜 위험). 예비동작은 조금만.
      // 막혔을 때 남는 시간(판정 100 + 후딜): 750 / 650 / 550 / 450 / 360
      //   → 1~3칸은 막히면 반격당하고, 5칸은 막혀도 거의 안전 (반격엔 반응 ~150 + 예비동작 350 = 500 필요)
      attackSpeed: { windupMs: [420, 385, 350, 315, 285], recoveryMs: [650, 550, 450, 350, 260] },
      moveSpeed: { moveSpeed: [4.8, 5.8, 7, 8.6, 10.2] },
      range: { range: [1.7, 1.95, 2.2, 2.5, 2.85] },
    },
  },

  backAttack: {
    damageMul: 1.5,
    angleDeg: 90, // 등 뒤 90° 부채꼴(좌우 45°) 안에서 맞으면 백어택 — 방어·패링 불가
  },
  // ── 경기 ──
  match: {
    roundsToWin: 2, // 3판 2선승
    roundTimeSec: 90, // 시간 초과 시 남은 체력 비율이 높은 쪽 승리 (같으면 무승부 라운드)
    maxRounds: 5, // 무승부가 반복될 때의 안전장치. 이후엔 승수로 판정
    introMs: 1600, // 'ROUND n' 표시 후 'FIGHT!'까지 (이동·공격 불가)
    roundEndMs: 2800, // 라운드 종료 후 다음 라운드까지
    resultDelayMs: 1200, // 경기 종료 후 결과 화면까지
  },

  // ── 아레나 ──
  arena: {
    radius: 15,
    wallHeight: 1.2, // 낮은 벽 (시각용, 실제 경계는 radius로 처리)
  },

  // ── 물리 / 시뮬레이션 ──
  physics: {
    gravity: 18, // m/s² — 점프 높이 ≈ jumpPower² / (2·gravity) = 1m
  },
  sim: {
    stepHz: 120, // 전투 판정은 고정 간격으로 진행 (프레임레이트와 무관하게 타이밍 일정)
  },

  // ── 카메라 / 마우스 ──
  camera: {
    fov: 75,
    mouseSensitivity: 0.0022, // 픽셀당 라디안
    maxPitchDeg: 85,
    maxMouseDeltaPerEvent: 250, // 브라우저의 튀는 마우스 입력 방지
    deadEyeHeight: 0.5, // 쓰러졌을 때 카메라 높이
  },

  // ── 1인칭 칼 모델 ──
  viewModel: {
    fov: 60,
    basePosition: { x: 0.36, y: -0.4, z: -0.62 },
    baseRotation: { x: -0.7, y: -0.25, z: 0.3 },
    bobFrequency: 11, // 걸을 때 흔들림 속도 (rad/s)
    bobAmount: 0.022, // 걸을 때 흔들림 크기
    swayAmount: 0.0009, // 마우스 이동에 따른 칼 지연 정도
    swayMax: 0.06,
    landDip: 0.07, // 착지 시 칼이 내려가는 정도
  },

  // ── 연출 ──
  effects: {
    parryShake: 0.03, // 화면 흔들림 (라디안)
    hitShake: 0.022,
    guardShake: 0.01,
    parryFlashOpacity: 0.55,
    hurtFlashOpacity: 0.35,
  },
  audio: {
    masterVolume: 0.5,
  },

  // ── AI 봇 ──
  // 봇은 플레이어와 같은 Fighter·같은 판정을 쓴다. 난이도는 '반응·판단 능력'만 다르다.
  bot: {
    preferredRangeRatio: 0.77, // 압박 시 유지하려는 거리 = 자기 공격범위 × 이 비율
    strafeSpeedMul: 0.45, // 옆걸음 속도 비율
    strafeFlipMs: [900, 2400], // 옆걸음 방향을 바꾸는 간격 (최소, 최대)
    stanceRerollMs: [500, 1300], // 미리 방어 자세를 취할지 다시 정하는 간격
    attackGapMs: [350, 1000], // 공격 후 다음 공격을 고려하기까지 간격
    attackTurnMul: 0.35, // 공격 중 회전 속도 배율 → 공격 중엔 옆·뒤로 돌아갈 틈이 생김
    // 등 뒤 돌기: 시도 확률 = 난이도별 flankChance × (내 이동속도 / 기본 이동속도)²  → 빠른 빌드일수록 자주
    flankTimeoutMs: 1800, // 방어 중인 상대 등 뒤를 노릴 때, 이 시간 안에 못 잡으면 포기
    flankMaxChance: 0.6, // 상대 예비동작을 보고 옆으로 돌아 피할 확률의 상한
    // 봇 빌드 프리셋 (각 15칸)
    builds: {
      balanced: { label: '균형형', stats: { attack: 3, defense: 3, attackSpeed: 3, moveSpeed: 3, range: 3 } },
      tyrant: { label: '폭군형', stats: { attack: 5, defense: 3, attackSpeed: 1, moveSpeed: 3, range: 3 } },
      spiro: { label: '스피로형', stats: { attack: 2, defense: 3, attackSpeed: 4, moveSpeed: 5, range: 1 } },
      lancer: { label: '장검형', stats: { attack: 3, defense: 2, attackSpeed: 2, moveSpeed: 3, range: 5 } },
      fortress: { label: '철벽형', stats: { attack: 2, defense: 5, attackSpeed: 3, moveSpeed: 2, range: 3 } },
    },
    difficulties: {
      // reactionMs: 상대 움직임을 보고 행동하기까지 (± jitter). 예비동작(350ms)보다 느리면 반응 방어 불가
      // parryChance: 상대 예비동작을 보고 타이밍 패링을 시도할 확률 / parryErrorMs: 타이밍 오차(표준편차)
      // dodgeChance: 뒤로 빠져서 헛치게 만들 확률 / guardStance: 가까이 있을 때 미리 방어 자세를 취할 확률
      // punishChance: 상대 빈틈(헛친 공격·막힌 공격·패링당한 경직)에 반격할 확률
      // aggression: 사거리 안에서 초당 공격 시도 확률 / turnSpeed: 회전 속도(rad/s)
      // retreatChance: 맞은 뒤 거리를 벌릴 확률 / smart: 상대가 방어 중이면 공격 자제, 패링 쿨타임 확인
      // flankChance: 등 뒤 돌기 성향 (방어 중인 상대에겐 초당 시도 확률, 예비동작엔 옆으로 돌아 피할 확률)
      easy: {
        label: '쉬움', color: 0x4f9d5d,
        reactionMs: 420, reactionJitterMs: 80, parryChance: 0.1, parryErrorMs: 90, dodgeChance: 0.05,
        guardStance: 0.2, punishChance: 0.25, aggression: 0.6, turnSpeed: 4, retreatChance: 0.2, smart: false, flankChance: 0.05,
      },
      normal: {
        label: '보통', color: 0x3f7fbf,
        reactionMs: 300, reactionJitterMs: 60, parryChance: 0.3, parryErrorMs: 60, dodgeChance: 0.1,
        guardStance: 0.3, punishChance: 0.5, aggression: 0.8, turnSpeed: 7, retreatChance: 0.3, smart: false, flankChance: 0.15,
      },
      hard: {
        label: '어려움', color: 0xb0463c,
        reactionMs: 220, reactionJitterMs: 40, parryChance: 0.55, parryErrorMs: 35, dodgeChance: 0.2,
        guardStance: 0.35, punishChance: 0.8, aggression: 1.0, turnSpeed: 11, retreatChance: 0.4, smart: true, flankChance: 0.3,
      },
      302: {
        label: '302명', color: 0x6a2fa0,
        reactionMs: 160, reactionJitterMs: 25, parryChance: 0.85, parryErrorMs: 18, dodgeChance: 0.25,
        guardStance: 0.3, punishChance: 0.97, aggression: 1.2, turnSpeed: 18, retreatChance: 0.35, smart: true, flankChance: 0.4,
      },
    },
  },

  // ── 허수아비 (패링 연습 모드 상대) ──
  dummy: {
    turnSpeed: 2.5, // rad/s — 느리게 돌아서 등 뒤로 돌아가 백어택 연습 가능
    attackIntervalMs: 1600, // 대기 상태에서 이만큼 지나면 공격
    engageRange: 3.2, // 플레이어가 이 거리 안에 있을 때만 공격
  },

  // ── KO 후 재시작 (패링 연습 모드 전용. 대전은 라운드 시스템이 처리) ──
  ko: {
    resetDelayMs: 2500,
  },

  // ── 온라인 대전 (P2P, PeerJS) ──
  online: {
    protocolVersion: 1, // 서로 다른 버전끼리는 접속을 막는다
    peerPrefix: 'onesword-v1-', // PeerJS 공개 서버에서 다른 서비스와 겹치지 않도록 붙이는 접두어
    codeLength: 6,
    codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // 헷갈리는 글자(I, O, 0, 1) 제외
    snapshotIntervalMs: 33, // 내 상태를 상대에게 보내는 간격 (상태가 바뀌면 즉시 추가로 보냄)
    clockIntervalMs: 200, // 호스트가 남은 시간을 알려주는 간격
    remoteSmoothing: 20, // 상대 위치를 부드럽게 따라가는 정도 (클수록 즉각적)
    predictedStaggerMs: 300, // 내가 패링한 상대를 확인 전까지 경직 상태로 보여주는 시간
    joinTimeoutMs: 12000,
    opponentColor: 0xc98a2a,
  },

  // 시작 위치 (서로 마주 봄)
  playerSpawn: { x: 0, z: 5 },
  opponentSpawn: { x: 0, z: -5 },
};
