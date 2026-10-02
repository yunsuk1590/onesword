// 허수아비 → fighter 명령 (Phase 2 패링 연습용)
// 제자리에서 플레이어 쪽으로 천천히 돌고, 가까이 있으면 일정 간격으로 공격한다.
// 플레이어와 같은 Fighter·같은 상태 머신을 쓴다.

import { CONFIG } from '../config.js';
import { STATE } from '../core/stateMachine.js';
import { yawToward, turnToward } from '../core/physics.js';

export class DummyController {
  constructor(fighter) {
    this.fighter = fighter;
    this.timer = 0;
  }

  reset() {
    this.timer = 0;
  }

  update(dt, target) {
    const f = this.fighter;
    const cfg = CONFIG.dummy;

    if (f.state === STATE.IDLE && !target.isDead) {
      const desired = yawToward(f.position.x, f.position.z, target.position.x, target.position.z);
      f.yaw = turnToward(f.yaw, desired, cfg.turnSpeed * dt);

      const dist = Math.hypot(target.position.x - f.position.x, target.position.z - f.position.z);
      if (dist <= cfg.engageRange) {
        this.timer += dt * 1000;
        if (this.timer >= cfg.attackIntervalMs && f.tryAttack()) this.timer = 0;
      }
    }

    // 허수아비는 밀리지 않는다 (장애물 없이 중력만 적용)
    f.step(dt, 0, 0);
  }
}
