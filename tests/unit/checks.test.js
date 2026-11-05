import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePersist, nextStep, restoreResults } from '../../js/lib/checks.js';

const IDS = ['standalone', 'map', 'search', 'gps'];
const ALL = ['standalone', 'map', 'search', 'gps', 'persist', 'export', 'import'];
const ok = (...ids) => Object.fromEntries(ids.map((i) => [i, 'ok']));

test('앱이 아니면 다음 할 일은 항상 홈 화면', () => {
  assert.deepEqual(nextStep(IDS, { map: 'ok', search: 'ok', gps: 'ok' }), { kind: 'row', id: 'standalone' });
  assert.deepEqual(nextStep(IDS, { standalone: 'fail', map: 'ok' }), { kind: 'row', id: 'standalone' });
});

test('순서대로 첫 번째 미통과 행을 고른다', () => {
  assert.deepEqual(nextStep(IDS, ok('standalone')), { kind: 'row', id: 'map' });
  assert.deepEqual(nextStep(IDS, ok('standalone', 'map')), { kind: 'row', id: 'search' });
  assert.deepEqual(nextStep(IDS, { ...ok('standalone', 'map', 'search'), gps: 'half' }), { kind: 'row', id: 'gps' });
});

test('지도 실패면 검색도 건너뛴다. 위치 실패도 건너뛴다', () => {
  assert.deepEqual(nextStep(IDS, { standalone: 'ok', map: 'fail', search: 'wait', gps: 'wait' }), { kind: 'row', id: 'gps' });
  assert.deepEqual(nextStep(ALL, { ...ok('standalone', 'map', 'search'), gps: 'fail' }), { kind: 'row', id: 'persist' });
});

test('저장·백업 실패는 그 자리에 머문다', () => {
  for (const id of ['persist', 'export', 'import']) {
    const states = { ...ok(...ALL), [id]: 'fail' };
    assert.deepEqual(nextStep(ALL, states), { kind: 'row', id });
  }
});

test('export half면 카드는 import다', () => {
  const states = { ...ok('standalone', 'map', 'search', 'gps', 'persist'), export: 'half' };
  assert.deepEqual(nextStep(ALL, states), { kind: 'row', id: 'import' });
});

test('전부 통과와 실패만 남은 경우', () => {
  assert.deepEqual(nextStep(IDS, ok(...IDS)), { kind: 'done' });
  assert.deepEqual(nextStep(IDS, { ...ok('standalone', 'map', 'search'), gps: 'fail' }), { kind: 'failed' });
  assert.deepEqual(nextStep(IDS, { standalone: 'ok', map: 'fail', search: 'wait', gps: 'ok' }), { kind: 'failed' });
});

const rec = (results, version = 'v1') => ({ version, results });

test('앱이 아니거나 버전이 다르면 기록을 무시한다', () => {
  const r = rec({ search: { state: 'ok', msg: 'x' } });
  assert.deepEqual(restoreResults(r, { version: 'v1', isApp: false }), { results: {}, versionChanged: false });
  assert.deepEqual(restoreResults(r, { version: 'v2', isApp: true }), { results: {}, versionChanged: true });
});

test('기록이 없으면 새 버전으로 치지 않는다', () => {
  assert.deepEqual(restoreResults(null, { version: 'v1', isApp: true }), { results: {}, versionChanged: false });
});

test('지도·홈 화면 결과는 복원하지 않는다', () => {
  const r = rec({ map: { state: 'ok' }, standalone: { state: 'ok' }, search: { state: 'ok', msg: 'x' } });
  assert.deepEqual(Object.keys(restoreResults(r, { version: 'v1', isApp: true }).results), ['search']);
});

test('gps·search half는 저장돼 있어도 대기로 복원한다', () => {
  const r = rec({ gps: { state: 'half', msg: '찾는 중' }, search: { state: 'half' } });
  assert.deepEqual(restoreResults(r, { version: 'v1', isApp: true }).results, {});
});

test('실패 결과는 복원한다', () => {
  const r = rec({ gps: { state: 'fail', msg: '거부' } });
  assert.deepEqual(restoreResults(r, { version: 'v1', isApp: true }).results, { gps: { state: 'fail', msg: '거부' } });
});

test('내보낸 뒤 가져오기를 기다리는 상태는 복원한다', () => {
  const r = rec({ export: { state: 'half', msg: '내보냈어요', via: 'share' } });
  assert.equal(restoreResults(r, { version: 'v1', isApp: true }).results.export.via, 'share');
});

test('가져오기는 통과만 복원한다', () => {
  const r = rec({ import: { state: 'fail', msg: 'x' } });
  assert.deepEqual(restoreResults(r, { version: 'v1', isApp: true }).results, {});
});

const saved = { code: '4821', savedAt: 'x', expectReload: false, reopenSeen: false, reopenNav: null };

test('시험 값이 없으면 대기', () => {
  assert.equal(evaluatePersist(null, 'navigate').state, 'wait');
});

test('다시 불러오기 표시가 있는 로드는 통과에 세지 않고 표시를 지운다', () => {
  const r = evaluatePersist({ ...saved, expectReload: true }, 'reload');
  assert.equal(r.state, 'half');
  assert.equal(r.phase, 'reloaded');
  assert.equal(r.test.expectReload, false);
  assert.equal(r.test.reopenSeen, false);
});

test('표시 없는 로드에서 통과하고 nav type이 남는다', () => {
  const r = evaluatePersist(saved, 'navigate');
  assert.equal(r.state, 'ok');
  assert.equal(r.test.reopenSeen, true);
  assert.equal(r.test.reopenNav, 'navigate');
});

test('한 번 통과하면 그 뒤로도 통과고 처음 nav type을 지킨다', () => {
  const r = evaluatePersist({ ...saved, reopenSeen: true, reopenNav: 'navigate' }, 'reload');
  assert.equal(r.state, 'ok');
  assert.equal(r.test.reopenNav, 'navigate');
});
