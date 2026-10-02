import { describe, it, expect } from 'vitest';
import {
  computeMoveVector,
  stepVertical,
  clampToArena,
  resolveCircleOverlap,
  yawToward,
  turnToward,
} from '../src/core/physics.js';

const none = { forward: false, back: false, left: false, right: false };

describe('computeMoveVector', () => {
  it('입력이 없으면 움직이지 않는다', () => {
    expect(computeMoveVector(none, 0)).toEqual({ x: 0, z: 0 });
  });

  it('yaw 0에서 W는 -Z 방향', () => {
    const v = computeMoveVector({ ...none, forward: true }, 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
  });

  it('yaw 0에서 D는 +X 방향', () => {
    const v = computeMoveVector({ ...none, right: true }, 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.z).toBeCloseTo(0);
  });

  it('왼쪽으로 90도 돌면(yaw = π/2) W는 -X 방향', () => {
    const v = computeMoveVector({ ...none, forward: true }, Math.PI / 2);
    expect(v.x).toBeCloseTo(-1);
    expect(v.z).toBeCloseTo(0);
  });

  it('대각선 이동도 길이 1로 정규화된다', () => {
    const v = computeMoveVector({ ...none, forward: true, right: true }, 0.7);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1);
  });

  it('반대 방향 키를 동시에 누르면 상쇄된다', () => {
    expect(computeMoveVector({ forward: true, back: true, left: true, right: true }, 1)).toEqual({ x: 0, z: 0 });
  });
});

describe('stepVertical', () => {
  it('공중에서는 중력으로 속도가 줄어든다', () => {
    const r = stepVertical(1, 0, 0.1, 10);
    expect(r.vy).toBeCloseTo(-1);
    expect(r.onGround).toBe(false);
  });

  it('바닥 아래로는 내려가지 않고 착지한다', () => {
    const r = stepVertical(0.01, -5, 0.1, 10);
    expect(r).toEqual({ y: 0, vy: 0, onGround: true });
  });

  it('점프 후 다시 바닥으로 돌아온다', () => {
    let s = { y: 0, vy: 6, onGround: false };
    let maxY = 0;
    for (let i = 0; i < 200 && !(i > 0 && s.onGround); i++) {
      s = stepVertical(s.y, s.vy, 1 / 120, 18);
      maxY = Math.max(maxY, s.y);
    }
    expect(s.onGround).toBe(true);
    expect(maxY).toBeGreaterThan(0.9);
    expect(maxY).toBeLessThan(1.1);
  });
});

describe('clampToArena', () => {
  it('안쪽 위치는 그대로', () => {
    expect(clampToArena(3, 4, 15, 0.4)).toEqual({ x: 3, z: 4 });
  });

  it('바깥 위치는 경계 안으로 끌려온다 (몸 반지름 고려)', () => {
    const r = clampToArena(20, 0, 15, 0.4);
    expect(r.x).toBeCloseTo(14.6);
    expect(r.z).toBeCloseTo(0);
  });
});

describe('resolveCircleOverlap', () => {
  it('겹치지 않으면 그대로', () => {
    expect(resolveCircleOverlap(2, 0, 0.4, 0, 0, 0.4)).toEqual({ x: 2, z: 0 });
  });

  it('겹치면 두 반지름 합만큼 떨어지도록 밀어낸다', () => {
    const r = resolveCircleOverlap(0.5, 0, 0.4, 0, 0, 0.4);
    expect(r.x).toBeCloseTo(0.8);
    expect(r.z).toBeCloseTo(0);
  });

  it('중심이 완전히 같아도 밀어낸다', () => {
    const r = resolveCircleOverlap(0, 0, 0.4, 0, 0, 0.4);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(0.8);
  });
});

describe('yawToward', () => {
  it('바라보는 yaw의 정면 벡터가 목표를 향한다', () => {
    const yaw = yawToward(1, 2, 4, -2);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    expect(fx).toBeCloseTo(3 / 5);
    expect(fz).toBeCloseTo(-4 / 5);
  });
});

describe('turnToward', () => {
  it('차이가 작으면 목표에 바로 도달', () => {
    expect(turnToward(0, 0.1, 0.5)).toBeCloseTo(0.1);
  });

  it('최대 회전량만큼만 돈다', () => {
    expect(turnToward(0, 1, 0.2)).toBeCloseTo(0.2);
    expect(turnToward(0, -1, 0.2)).toBeCloseTo(-0.2);
  });

  it('±π 경계를 넘어 짧은 쪽으로 돈다', () => {
    // 3.0 → -3.0 은 +쪽으로 약 0.28rad만 돌면 된다
    const r = turnToward(3.0, -3.0, 0.1);
    expect(r).toBeCloseTo(3.1);
  });
});
