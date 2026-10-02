// 3인칭으로 보이는 캐릭터 모델 (상대방 표시용)
// 캡슐 몸통 + 정면을 알려주는 바이저 + 손에 든 칼.
// 전투 상태에 따라 칼 자세와 색을 바꿔 '텔레그래프'를 보여준다.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { STATE } from '../core/stateMachine.js';

// 칼 피벗 자세 (몸 기준 위치 m, 회전 라디안 — 회전 순서 YXZ: 먼저 앞뒤로 눕히고 좌우로 돌린다)
const POSE = {
  idle: { p: [0.48, 1.08, -0.15], r: [-0.5, 0, 0] },
  // 예비동작: 칼을 오른쪽 뒤 위로 크게 들어올림 — 멀리서도 읽히도록 과장
  windup: { p: [0.5, 1.4, -0.05], r: [-1.1, -1.9, 0] },
  // 판정 끝: 왼쪽 앞으로 수평 베기
  follow: { p: [0.15, 1.15, -0.45], r: [-1.45, 1.3, 0] },
  // 방어: 칼을 몸 앞에 가로로
  guard: { p: [0.35, 1.35, -0.55], r: [-1.35, 1.45, 0] },
  // 경직: 칼이 위로 튕겨 올라감
  stagger: { p: [0.55, 1.4, 0.0], r: [0.6, -0.4, 0] },
};

const COLOR = {
  steel: new THREE.Color(0xcfd5dc),
  windup: new THREE.Color(0xff6a00),
  active: new THREE.Color(0xfff4d6),
  parry: new THREE.Color(0x5ad8ff),
  guard: new THREE.Color(0x4a7ab0),
  visorNormal: new THREE.Color(0x66e0ff),
  visorWindup: new THREE.Color(0xff6a00),
  visorStagger: new THREE.Color(0xffd84a),
  hurt: new THREE.Color(0xff2a2a),
};

/**
 * @param {number} bodyColor
 * @param {{ reach?: number }} [options] reach: 칼 길이 배율 (공격범위 스탯 / 기본 사거리)
 */
export function createFighterView(bodyColor, { reach = 1 } = {}) {
  const { radius, height } = CONFIG.player;
  const group = new THREE.Group(); // 위치·방향
  const rig = new THREE.Group(); // 기울어짐·쓰러짐 연출
  group.add(rig);

  // 몸통
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7, emissive: COLOR.hurt, emissiveIntensity: 0 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, height - radius * 2, 6, 16), bodyMat);
  body.position.y = height / 2;
  body.castShadow = true;
  rig.add(body);

  // 바이저 — 캐릭터 정면(-Z)을 표시. 백어택 판정의 기준이 되므로 눈에 잘 띄게.
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COLOR.visorNormal.clone(), emissiveIntensity: 0.9 });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.3, 0.12, 0.12), visorMat);
  visor.position.set(0, height - 0.32, -radius * 0.82);
  rig.add(visor);

  // 칼
  const swordPivot = new THREE.Group();
  swordPivot.rotation.order = 'YXZ';
  const bladeMat = new THREE.MeshStandardMaterial({ color: COLOR.steel, metalness: 0.3, roughness: 0.35, emissive: 0x000000 });
  // 칼날 원점을 아래 끝에 두어, 길이를 늘려도 손잡이 쪽은 그대로
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.02).translate(0, 0.475, 0), bladeMat);
  blade.position.y = 0.08;
  blade.scale.y = reach;
  blade.castShadow = true;
  const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a6d3b }));
  hilt.position.y = 0.06;
  swordPivot.add(blade, hilt);
  rig.add(swordPivot);

  const pose = { p: [...POSE.idle.p], r: [...POSE.idle.r] };
  let hurt = 0;
  let glow = 0;
  let time = 0;

  return {
    group,

    /** 맞았을 때 몸이 빨갛게 번쩍 */
    flashHurt() {
      hurt = 1;
    },

    /**
     * @param {import('../game/fighter.js').Fighter} fighter
     * @param {number} dt
     */
    update(fighter, dt) {
      time += dt;
      group.position.set(fighter.position.x, fighter.position.y, fighter.position.z);
      group.rotation.y = fighter.yaw;

      const state = fighter.state;
      const t = fighter.stateProgress();
      let target = POSE.idle;
      let lambda = 12;
      let glowColor = null;
      let glowTarget = 0;
      let visorColor = COLOR.visorNormal;
      let lean = 0;

      switch (state) {
        case STATE.ATTACK_WINDUP:
          target = lerpPose(POSE.idle, POSE.windup, 1 - (1 - t) ** 3);
          lambda = 40;
          glowColor = COLOR.windup;
          glowTarget = 0.4 + 2.4 * t; // 판정 직전으로 갈수록 밝아짐 → 패링 타이밍 신호
          visorColor = COLOR.visorWindup;
          lean = -0.08 * t; // 살짝 뒤로 젖히며 힘을 모음
          break;
        case STATE.ATTACK_ACTIVE:
          target = lerpPose(POSE.windup, POSE.follow, 1 - (1 - t) ** 2);
          lambda = 60;
          glowColor = COLOR.active;
          glowTarget = 2.5;
          visorColor = COLOR.visorWindup;
          lean = 0.12;
          break;
        case STATE.ATTACK_RECOVERY:
          target = lerpPose(POSE.follow, POSE.idle, t);
          lambda = 20;
          lean = 0.12 * (1 - t);
          break;
        case STATE.PARRY_WINDOW:
          target = POSE.guard;
          lambda = 35;
          glowColor = COLOR.parry;
          glowTarget = 2;
          break;
        case STATE.GUARD:
          target = POSE.guard;
          lambda = 25;
          glowColor = COLOR.guard;
          glowTarget = 0.4;
          break;
        case STATE.STAGGERED:
        case STATE.STUNNED:
          target = POSE.stagger;
          lambda = 25;
          // 바이저가 노랗게 깜빡임 = 반격 찬스
          visorColor = COLOR.visorStagger;
          lean = -0.3 + Math.sin(time * 40) * 0.03 * (1 - t);
          break;
        case STATE.DEAD:
          target = POSE.stagger;
          lambda = 6;
          break;
      }

      // 쓰러짐: 뒤로 넘어간다
      const dead = state === STATE.DEAD;
      rig.rotation.x = damp(rig.rotation.x, dead ? 1.45 : -lean, dead ? 5 : 18, dt);
      rig.position.y = damp(rig.position.y, dead ? radius : 0, 5, dt);

      dampPose(pose, target, lambda, dt);
      swordPivot.position.set(pose.p[0], pose.p[1], pose.p[2]);
      swordPivot.rotation.set(pose.r[0], pose.r[1], pose.r[2]);

      glow = damp(glow, glowTarget, glowTarget > glow ? 40 : 10, dt);
      if (glowColor) bladeMat.emissive.copy(glowColor);
      bladeMat.emissiveIntensity = glow;

      const blink = state === STATE.STAGGERED ? 0.6 + 0.4 * Math.sign(Math.sin(time * 30)) : 1;
      visorMat.emissive.lerp(visorColor, 1 - Math.exp(-30 * dt));
      visorMat.emissiveIntensity = (dead ? 0.1 : 1.2) * blink;

      hurt = damp(hurt, 0, 8, dt);
      bodyMat.emissiveIntensity = hurt * 0.9;
    },
  };
}

function lerpPose(a, b, t) {
  return {
    p: a.p.map((v, i) => v + (b.p[i] - v) * t),
    r: a.r.map((v, i) => v + (b.r[i] - v) * t),
  };
}

function dampPose(cur, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  for (let i = 0; i < 3; i++) {
    cur.p[i] += (target.p[i] - cur.p[i]) * k;
    cur.r[i] += (target.r[i] - cur.r[i]) * k;
  }
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
