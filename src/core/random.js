// 난수 도우미 (순수 함수). 테스트에서 같은 결과를 재현할 수 있도록 시드 난수를 지원한다.

/** 시드 기반 난수 생성기 (mulberry32). 0 이상 1 미만을 반환하는 함수를 돌려준다. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 표준 정규분포 난수 (평균 0, 표준편차 1) — Box-Muller */
export function gaussian(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randRange(rng, min, max) {
  return min + (max - min) * rng();
}
