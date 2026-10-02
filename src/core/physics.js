// 이동·충돌 관련 순수 함수 (Three.js와 무관)
//
// 좌표계 규칙: Y가 위, yaw = 0일 때 정면은 -Z 방향.
//   정면 벡터 = (-sin(yaw), -cos(yaw)), 오른쪽 벡터 = (cos(yaw), -sin(yaw))

/**
 * 입력 키 상태와 시선 방향(yaw)으로 수평 이동 방향(단위 벡터)을 구한다.
 * 대각선 이동이 더 빨라지지 않도록 정규화한다.
 */
export function computeMoveVector({ forward, back, left, right }, yaw) {
  let f = (forward ? 1 : 0) - (back ? 1 : 0);
  let s = (right ? 1 : 0) - (left ? 1 : 0);
  if (f === 0 && s === 0) return { x: 0, z: 0 };

  const len = Math.hypot(f, s);
  f /= len;
  s /= len;

  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: -sin * f + cos * s,
    z: -cos * f - sin * s,
  };
}

/**
 * 중력을 적용해 수직 위치·속도를 한 스텝 진행한다. 바닥은 y = 0.
 */
export function stepVertical(y, vy, dt, gravity) {
  const nextVy = vy - gravity * dt;
  const nextY = y + nextVy * dt;
  if (nextY <= 0) return { y: 0, vy: 0, onGround: true };
  return { y: nextY, vy: nextVy, onGround: false };
}

/**
 * 원형 아레나 밖으로 나가지 않도록 위치를 보정한다.
 */
export function clampToArena(x, z, arenaRadius, bodyRadius) {
  const max = arenaRadius - bodyRadius;
  const dist = Math.hypot(x, z);
  if (dist <= max) return { x, z };
  const k = max / dist;
  return { x: x * k, z: z * k };
}

/**
 * 원 A가 원 B와 겹치면 A를 B 밖으로 밀어낸다. (B는 고정)
 */
export function resolveCircleOverlap(ax, az, ar, bx, bz, br) {
  const dx = ax - bx;
  const dz = az - bz;
  const dist = Math.hypot(dx, dz);
  const minDist = ar + br;
  if (dist >= minDist) return { x: ax, z: az };
  // 중심이 완전히 겹친 경우: 임의 방향(+X)으로 밀어낸다
  if (dist < 1e-6) return { x: bx + minDist, z: bz };
  const k = minDist / dist;
  return { x: bx + dx * k, z: bz + dz * k };
}

/**
 * (fromX, fromZ)에서 (toX, toZ)를 바라보는 yaw 값.
 */
export function yawToward(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

/**
 * 현재 yaw를 목표 yaw 쪽으로 최대 maxDelta만큼 돌린다. 항상 짧은 쪽으로 돈다.
 */
export function turnToward(current, target, maxDelta) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxDelta) return current + diff;
  return current + Math.sign(diff) * maxDelta;
}
