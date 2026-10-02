// 빌드 저장/불러오기 (localStorage)
// 저장소가 막혀 있거나(시크릿 모드 등) 데이터가 깨져 있어도 게임은 기본 빌드로 계속 동작한다.

import { defaultBuild, validateBuild, STAT_KEYS } from '../core/stats.js';

const STORAGE_KEY = 'onesword.builds.v1';
export const DEFAULT_BUILD_NAME = '기본형';
const MAX_NAME_LENGTH = 16;

export class BuildStore {
  /** @param {Storage | null} [storage] 테스트에서는 가짜 저장소를 넣는다 */
  constructor(storage = safeLocalStorage()) {
    this.storage = storage;
  }

  /** 저장된 빌드 목록 [{ name, stats }] */
  list() {
    return this.#read().builds;
  }

  /** 현재 선택된 빌드. 없거나 깨졌으면 기본형. */
  getCurrent() {
    const data = this.#read();
    const found = data.builds.find((b) => b.name === data.current);
    return found ?? { name: DEFAULT_BUILD_NAME, stats: defaultBuild() };
  }

  setCurrent(name) {
    const data = this.#read();
    data.current = name;
    this.#write(data);
  }

  /**
   * 같은 이름이 있으면 덮어쓴다.
   * @returns {{ ok: boolean, error?: string }}
   */
  save(name, stats) {
    const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) return { ok: false, error: '빌드 이름을 입력하세요' };
    const errors = validateBuild(stats);
    if (errors.length) return { ok: false, error: errors[0] };

    const data = this.#read();
    const entry = { name: trimmed, stats: pickStats(stats) };
    const i = data.builds.findIndex((b) => b.name === trimmed);
    if (i >= 0) data.builds[i] = entry;
    else data.builds.push(entry);
    if (!this.#write(data)) return { ok: false, error: '브라우저 저장소에 저장할 수 없습니다' };
    return { ok: true, name: trimmed };
  }

  remove(name) {
    const data = this.#read();
    data.builds = data.builds.filter((b) => b.name !== name);
    if (data.current === name) data.current = null;
    this.#write(data);
  }

  #read() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return { builds: [], current: null };
      const parsed = JSON.parse(raw);
      const builds = Array.isArray(parsed.builds)
        ? parsed.builds.filter((b) => typeof b?.name === 'string' && validateBuild(b.stats).length === 0)
        : [];
      return { builds, current: typeof parsed.current === 'string' ? parsed.current : null };
    } catch {
      return { builds: [], current: null };
    }
  }

  #write(data) {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(data));
      return Boolean(this.storage);
    } catch {
      return false;
    }
  }
}

function pickStats(stats) {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, stats[k]]));
}

function safeLocalStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
