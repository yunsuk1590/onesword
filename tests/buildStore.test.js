import { describe, it, expect } from 'vitest';
import { BuildStore, DEFAULT_BUILD_NAME } from '../src/game/buildStore.js';
import { defaultBuild } from '../src/core/stats.js';

/** localStorage 흉내 */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const tyrant = { attack: 5, defense: 4, attackSpeed: 1, moveSpeed: 2, range: 3 };

describe('BuildStore', () => {
  it('저장된 게 없으면 현재 빌드는 기본형', () => {
    const store = new BuildStore(fakeStorage());
    expect(store.list()).toEqual([]);
    expect(store.getCurrent()).toEqual({ name: DEFAULT_BUILD_NAME, stats: defaultBuild() });
  });

  it('저장하고 선택하면 다시 불러올 수 있다 (새 인스턴스에서도)', () => {
    const storage = fakeStorage();
    const store = new BuildStore(storage);
    expect(store.save('내 폭군', tyrant).ok).toBe(true);
    store.setCurrent('내 폭군');
    const reopened = new BuildStore(storage);
    expect(reopened.getCurrent()).toEqual({ name: '내 폭군', stats: tyrant });
  });

  it('같은 이름으로 저장하면 덮어쓴다', () => {
    const store = new BuildStore(fakeStorage());
    store.save('A', defaultBuild());
    store.save('A', tyrant);
    expect(store.list()).toEqual([{ name: 'A', stats: tyrant }]);
  });

  it('규칙에 맞지 않는 빌드나 빈 이름은 저장되지 않는다', () => {
    const store = new BuildStore(fakeStorage());
    expect(store.save('', tyrant).ok).toBe(false);
    expect(store.save('   ', tyrant).ok).toBe(false);
    expect(store.save('반쪽', { ...tyrant, range: 2 }).ok).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('이름 앞뒤 공백은 지우고 16자로 자른다', () => {
    const store = new BuildStore(fakeStorage());
    const r = store.save('  아주아주아주아주아주아주긴빌드이름입니다  ', tyrant);
    expect(r.ok).toBe(true);
    expect(r.name.length).toBe(16);
  });

  it('선택된 빌드를 지우면 기본형으로 돌아간다', () => {
    const store = new BuildStore(fakeStorage());
    store.save('A', tyrant);
    store.setCurrent('A');
    store.remove('A');
    expect(store.getCurrent().name).toBe(DEFAULT_BUILD_NAME);
  });

  it('저장소 데이터가 깨져 있어도 기본형으로 동작한다', () => {
    const store = new BuildStore(fakeStorage({ 'onesword.builds.v1': '{망가진 json' }));
    expect(store.list()).toEqual([]);
    expect(store.getCurrent().name).toBe(DEFAULT_BUILD_NAME);
  });

  it('규칙에 맞지 않는 항목은 불러올 때 걸러진다 (수동 조작 방지)', () => {
    const raw = JSON.stringify({
      builds: [
        { name: '정상', stats: tyrant },
        { name: '치트', stats: { attack: 5, defense: 5, attackSpeed: 5, moveSpeed: 5, range: 5 } },
      ],
      current: '치트',
    });
    const store = new BuildStore(fakeStorage({ 'onesword.builds.v1': raw }));
    expect(store.list().map((b) => b.name)).toEqual(['정상']);
    expect(store.getCurrent().name).toBe(DEFAULT_BUILD_NAME);
  });

  it('저장소를 쓸 수 없으면 저장 실패를 알린다', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const store = new BuildStore(broken);
    expect(store.save('A', tyrant).ok).toBe(false);
  });
});
