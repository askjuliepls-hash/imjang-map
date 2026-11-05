import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SCHEMA_VERSION, KEY_PREFIX } from '../../js/lib/store.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    cleared: false,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    clear() { this.cleared = true; m.clear(); },
  };
}
const named = (name) => Object.assign(new Error(name), { name });

test('저장하면 한글·이모지까지 같은 값으로 읽힌다', () => {
  const s = fakeStorage();
  const st = createStore(() => s);
  const value = { text: '약국 임장 ☕🏥 "따옴표"\n줄바꿈' };
  assert.deepEqual(st.write('check', value), { ok: true });
  assert.deepEqual(st.read('check'), { ok: true, data: value });
});

test('값에 schemaVersion이 들어간다', () => {
  const s = fakeStorage();
  createStore(() => s).write('check', 1);
  assert.equal(JSON.parse(s.m.get(`${KEY_PREFIX}check`)).schemaVersion, SCHEMA_VERSION);
});

test('없으면 ok+null이다', () => {
  assert.deepEqual(createStore(() => fakeStorage()).read('none'), { ok: true, data: null });
});

test('깨졌으면 corrupt이고 원래 값을 지우지 않는다', () => {
  for (const bad of ['{깨진', 'null', '3', '{"data":1}', '{"schemaVersion":"1","data":1}']) {
    const s = fakeStorage({ [`${KEY_PREFIX}check`]: bad });
    const r = createStore(() => s).read('check');
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, 'corrupt', bad);
    assert.equal(s.m.get(`${KEY_PREFIX}check`), bad);
  }
});

test('앱보다 높은 버전이면 읽기에서 newer로 거절한다', () => {
  const s = fakeStorage({ [`${KEY_PREFIX}check`]: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, data: 1 }) });
  assert.equal(createStore(() => s).read('check').reason, 'newer');
});

test('공간 부족이면 quota이고 예외가 밖으로 안 나간다', () => {
  const s = fakeStorage();
  s.setItem = () => { throw named('QuotaExceededError'); };
  assert.equal(createStore(() => s).write('check', 1).reason, 'quota');
});

test('접근 예외·null·TypeError면 unavailable이고 예외가 밖으로 안 나간다', () => {
  const thrower = createStore(() => { throw named('SecurityError'); });
  assert.equal(thrower.read('x').reason, 'unavailable');
  assert.equal(thrower.write('x', 1).reason, 'unavailable');
  const nothing = createStore(() => null);
  assert.equal(nothing.read('x').reason, 'unavailable');
  assert.equal(nothing.write('x', 1).reason, 'unavailable');
  const s = fakeStorage();
  s.setItem = () => { throw new TypeError('no'); };
  assert.equal(createStore(() => s).write('x', 1).reason, 'unavailable');
});

test('다시 읽은 값이 다르면 성공이라고 하지 않는다', () => {
  const s = fakeStorage();
  s.setItem = () => {}; // 조용히 안 쓰는 저장소
  assert.equal(createStore(() => s).write('x', 1).reason, 'verify-failed');
});

test('다른 앱의 키를 안 건드리고 clear()를 안 부른다', () => {
  const s = fakeStorage({ other: 'keep' });
  const st = createStore(() => s);
  st.write('x', 1);
  st.read('x');
  assert.equal(s.m.get('other'), 'keep');
  assert.equal(s.cleared, false);
});
