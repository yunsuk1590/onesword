// 빌드 편집 화면: 스탯 15칸 분배, 이름 붙여 저장, 저장된 빌드 불러오기·삭제

import { STAT_KEYS, STAT_LABELS, buildTotal, changeStat, deriveStats, describeStat, validateBuild, defaultBuild } from '../core/stats.js';
import { DEFAULT_BUILD_NAME } from '../game/buildStore.js';
import { CONFIG } from '../config.js';

const STAT_HINTS = {
  attack: '한 번 맞힐 때 대미지',
  defense: '받는 대미지 감소',
  attackSpeed: '후딜레이 감소 — 막히거나 헛쳐도 덜 위험',
  moveSpeed: '이동 속도 — 등 뒤 잡기, 거리 조절',
  range: '칼이 닿는 거리 (칼도 길어짐)',
};

export class BuildEditor {
  /**
   * @param {import('../game/buildStore.js').BuildStore} store
   * @param {{ onClose: () => void }} handlers
   */
  constructor(store, { onClose }) {
    this.store = store;
    this.onClose = onClose;
    this.nameInput = document.getElementById('build-name');
    this.pointsEl = document.getElementById('build-points');
    this.rowsEl = document.getElementById('build-rows');
    this.msgEl = document.getElementById('build-msg');
    this.listEl = document.getElementById('build-list');
    this.build = defaultBuild();
    this.rows = {};

    this.#createRows();
    document.getElementById('build-use').addEventListener('click', () => this.#save(true));
    document.getElementById('build-save').addEventListener('click', () => this.#save(false));
    document.getElementById('build-reset').addEventListener('click', () => {
      this.build = defaultBuild();
      this.#render();
    });
    document.getElementById('build-back').addEventListener('click', () => this.onClose());
  }

  /** 화면을 열 때 현재 선택된 빌드로 채운다 */
  open() {
    const current = this.store.getCurrent();
    this.build = { ...current.stats };
    this.nameInput.value = current.name === DEFAULT_BUILD_NAME ? '' : current.name;
    this.#message('');
    this.#render();
  }

  #createRows() {
    const { max } = CONFIG.stats;
    for (const key of STAT_KEYS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `
        <div class="stat-name"><b>${STAT_LABELS[key]}</b><small>${STAT_HINTS[key]}</small></div>
        <button class="step" data-delta="-1" aria-label="${STAT_LABELS[key]} 내리기">−</button>
        <div class="stat-pips">${'<span></span>'.repeat(max)}</div>
        <button class="step" data-delta="1" aria-label="${STAT_LABELS[key]} 올리기">+</button>
        <div class="stat-value"></div>`;
      row.querySelectorAll('.step').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.build = changeStat(this.build, key, Number(btn.dataset.delta));
          this.#message('');
          this.#render();
        });
      });
      this.rowsEl.appendChild(row);
      this.rows[key] = {
        pips: [...row.querySelectorAll('.stat-pips span')],
        value: row.querySelector('.stat-value'),
        minus: row.querySelector('[data-delta="-1"]'),
        plus: row.querySelector('[data-delta="1"]'),
      };
    }
  }

  #render() {
    const { total, min, max } = CONFIG.stats;
    const used = buildTotal(this.build);
    const stats = deriveStats(this.build);
    const left = total - used;

    this.pointsEl.textContent = `남은 칸 ${left} / ${total}`;
    this.pointsEl.classList.toggle('done', left === 0);

    for (const key of STAT_KEYS) {
      const r = this.rows[key];
      const lv = this.build[key];
      r.pips.forEach((p, i) => p.classList.toggle('on', i < lv));
      r.value.textContent = describeStat(key, stats);
      r.minus.disabled = lv <= min;
      r.plus.disabled = lv >= max || left <= 0;
    }
    this.#renderList();
  }

  #renderList() {
    const current = this.store.getCurrent().name;
    const builds = this.store.list();
    if (builds.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '저장된 빌드가 없습니다';
      this.listEl.replaceChildren(li);
      return;
    }
    this.listEl.replaceChildren(
      ...builds.map((b) => {
        const li = document.createElement('li');
        if (b.name === current) li.classList.add('current');
        const load = document.createElement('button');
        load.className = 'link';
        load.textContent = `${b.name}  ${STAT_KEYS.map((k) => b.stats[k]).join('·')}`;
        load.title = '불러오기';
        load.addEventListener('click', () => {
          this.build = { ...b.stats };
          this.nameInput.value = b.name;
          this.#message(`'${b.name}' 불러옴`);
          this.#render();
        });
        const del = document.createElement('button');
        del.className = 'link danger';
        del.textContent = '삭제';
        del.addEventListener('click', () => {
          this.store.remove(b.name);
          this.#message(`'${b.name}' 삭제됨`);
          this.#render();
        });
        li.append(load, del);
        return li;
      }),
    );
  }

  #save(useNow) {
    const errors = validateBuild(this.build);
    if (errors.length) return this.#message(errors[0], true);
    const result = this.store.save(this.nameInput.value, this.build);
    if (!result.ok) return this.#message(result.error, true);
    this.nameInput.value = result.name;
    if (useNow) {
      this.store.setCurrent(result.name);
      this.onClose();
      return;
    }
    this.#message(`'${result.name}' 저장됨`);
    this.#render();
  }

  #message(text, isError = false) {
    this.msgEl.textContent = text;
    this.msgEl.classList.toggle('error', isError);
  }
}
