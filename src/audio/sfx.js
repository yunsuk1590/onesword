// 효과음 — 외부 음원 없이 Web Audio API로 직접 합성

import { CONFIG } from '../config.js';

export class Sfx {
  constructor() {
    this.ctx = null;
  }

  /** 브라우저 정책상 사용자 클릭 이후에만 소리를 낼 수 있다 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = CONFIG.audio.masterVolume;
      this.master.connect(this.ctx.destination);
      this.noise = makeNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get #ready() {
    return this.ctx && this.ctx.state === 'running';
  }

  /** 칼 휘두르는 바람 소리 */
  swing(volume = 1) {
    if (!this.#ready) return;
    this.#noise({ dur: 0.18, gain: 0.35 * volume, type: 'bandpass', freq: 500, freqEnd: 2600, q: 1.2 });
  }

  /** 상대 예비동작 소리 — 패링 타이밍을 귀로도 잡을 수 있게 (텔레그래프 보조) */
  windup(durationMs) {
    if (!this.#ready) return;
    const d = durationMs / 1000;
    this.#tone({ type: 'triangle', freq: 260, freqEnd: 620, dur: d, gain: 0.07, attack: d * 0.8 });
  }

  /** 맞았을 때 — 둔탁한 타격음 */
  hit() {
    if (!this.#ready) return;
    this.#tone({ type: 'sine', freq: 150, freqEnd: 45, dur: 0.18, gain: 0.7 });
    this.#noise({ dur: 0.09, gain: 0.45, type: 'lowpass', freq: 1800, freqEnd: 400, q: 0.7 });
  }

  /** 방어 — 낮은 금속음 */
  guard() {
    if (!this.#ready) return;
    this.#tone({ type: 'triangle', freq: 330, dur: 0.16, gain: 0.25 });
    this.#tone({ type: 'triangle', freq: 495, dur: 0.12, gain: 0.15 });
    this.#noise({ dur: 0.05, gain: 0.3, type: 'highpass', freq: 2000, q: 0.7 });
  }

  /** 패링 성공 — 날카롭고 길게 울리는 금속음 (가장 강한 피드백) */
  parry() {
    if (!this.#ready) return;
    this.#noise({ dur: 0.06, gain: 0.7, type: 'highpass', freq: 2500, q: 0.7 });
    this.#tone({ type: 'sine', freq: 220, freqEnd: 90, dur: 0.15, gain: 0.5 });
    for (const [f, g] of [
      [1240, 0.18],
      [1860, 0.14],
      [2710, 0.1],
      [3950, 0.07],
    ]) {
      this.#tone({ type: 'sine', freq: f, dur: 0.75, gain: g, attack: 0.002 });
    }
  }

  /** 라운드 시작 종소리 */
  bell() {
    if (!this.#ready) return;
    this.#tone({ type: 'sine', freq: 880, dur: 1.2, gain: 0.25, attack: 0.003 });
    this.#tone({ type: 'sine', freq: 1320, dur: 0.9, gain: 0.12, attack: 0.003 });
    this.#tone({ type: 'sine', freq: 2210, dur: 0.5, gain: 0.06, attack: 0.003 });
  }

  ko() {
    if (!this.#ready) return;
    this.#tone({ type: 'sawtooth', freq: 220, freqEnd: 55, dur: 0.7, gain: 0.15 });
    this.#tone({ type: 'sine', freq: 110, freqEnd: 40, dur: 0.6, gain: 0.4 });
  }

  // ── 합성 도우미 ──
  #tone({ type, freq, freqEnd, dur, gain, attack = 0.005 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  #noise({ dur, gain, type, freq, freqEnd, q = 1 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t0);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }
}

function makeNoiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
