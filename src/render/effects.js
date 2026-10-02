// 히트스톱, 화면 흔들림, 번쩍임, 불꽃 파편

import * as THREE from 'three';

const SPARK_POOL = 64;
const SPARK_GRAVITY = 9;

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} flashEl 화면 전체를 덮는 번쩍임용 요소
   */
  constructor(scene, flashEl) {
    this.freezeMs = 0;
    this.shakeAmp = 0;
    this.shakeTotal = 0;
    this.shakeLeft = 0;
    this.flashEl = flashEl;
    this.flashOpacity = 0;

    // 불꽃 파편 — 미리 만들어 두고 재사용
    const geo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
    this.sparks = [];
    for (let i = 0; i < SPARK_POOL; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      mesh.visible = false;
      scene.add(mesh);
      this.sparks.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1 });
    }
    this.nextSpark = 0;
  }

  /** 시뮬레이션을 잠깐 멈춘다 (타격감) */
  hitStop(ms) {
    this.freezeMs = Math.max(this.freezeMs, ms);
  }

  get frozen() {
    return this.freezeMs > 0;
  }

  shake(amplitude, durationMs) {
    if (amplitude < this.shakeAmp * (this.shakeLeft / (this.shakeTotal || 1))) return;
    this.shakeAmp = amplitude;
    this.shakeTotal = durationMs;
    this.shakeLeft = durationMs;
  }

  flash(cssColor, opacity) {
    this.flashEl.style.background = cssColor;
    this.flashOpacity = Math.max(this.flashOpacity, opacity);
  }

  /** 접촉 지점에서 파편을 사방으로 튀긴다 */
  burst(position, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const s = this.sparks[this.nextSpark];
      this.nextSpark = (this.nextSpark + 1) % SPARK_POOL;
      s.mesh.position.copy(position);
      s.mesh.material.color.set(color);
      s.mesh.visible = true;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      s.vel.copy(dir).multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      s.maxLife = 0.25 + Math.random() * 0.25;
      s.life = s.maxLife;
    }
  }

  update(dt) {
    this.freezeMs = Math.max(0, this.freezeMs - dt * 1000);
    this.shakeLeft = Math.max(0, this.shakeLeft - dt * 1000);

    this.flashOpacity = Math.max(0, this.flashOpacity - dt * 3.5);
    this.flashEl.style.opacity = this.flashOpacity.toFixed(3);

    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= SPARK_GRAVITY * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      const k = s.life / s.maxLife;
      s.mesh.scale.setScalar(0.4 + k);
      s.mesh.material.opacity = k;
    }
  }

  /** 카메라 회전을 위치·방향 설정 뒤에 살짝 흔든다 */
  applyShake(camera) {
    if (this.shakeLeft <= 0) return;
    const k = (this.shakeLeft / this.shakeTotal) * this.shakeAmp;
    camera.rotation.x += (Math.random() - 0.5) * 2 * k;
    camera.rotation.y += (Math.random() - 0.5) * 2 * k;
  }
}
