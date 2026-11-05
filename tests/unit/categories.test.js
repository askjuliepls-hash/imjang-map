import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkName, upsertCategory, removeCategory, clearCategoryFrom, categoryOf, pinColor, nextColor, matchesFilter,
  groupByCategory, pinImageUrl, PALETTE, NO_CATEGORY_COLOR, MAX_NAME,
} from '../../js/lib/categories.js';

const CATS = [{ id: 'a', name: '후보', color: PALETTE[0].color }, { id: 'b', name: '제외', color: PALETTE[6].color }];

test('이름 검사: 빈 이름, 너무 긴 이름, 같은 이름', () => {
  assert.equal(checkName(CATS, '   ').reason, 'empty');
  assert.equal(checkName(CATS, 'x'.repeat(MAX_NAME + 1)).reason, 'long');
  assert.equal(checkName(CATS, ' 후보 ').reason, 'same');
  assert.deepEqual(checkName(CATS, ' 재방문 '), { ok: true, name: '재방문' });
});

test('자기 이름은 그대로 저장할 수 있다', () => {
  assert.deepEqual(checkName(CATS, '후보', 'a'), { ok: true, name: '후보' });
});

test('새 분류는 추가되고 있는 분류는 바뀐다', () => {
  const added = upsertCategory(CATS, { name: '재방문', color: '#000' }, 'new');
  assert.equal(added.length, 3);
  assert.equal(added[2].id, 'new');
  const edited = upsertCategory(CATS, { id: 'a', name: '유력', color: '#111' }, 'x');
  assert.equal(edited.length, 2);
  assert.deepEqual(edited[0], { id: 'a', name: '유력', color: '#111' });
  assert.equal(CATS[0].name, '후보', '원래 목록은 그대로');
});

test('분류를 지워도 매물은 남고 분류 없음이 된다', () => {
  const items = [{ id: '1', categoryId: 'a' }, { id: '2', categoryId: 'b' }];
  assert.deepEqual(removeCategory(CATS, 'a').map((c) => c.id), ['b']);
  assert.deepEqual(clearCategoryFrom(items, 'a'), [{ id: '1', categoryId: null }, { id: '2', categoryId: 'b' }]);
});

test('핀 색은 분류 색, 분류가 없거나 지워졌으면 회색', () => {
  assert.equal(pinColor({ categoryId: 'a' }, CATS), PALETTE[0].color);
  assert.equal(pinColor({}, CATS), NO_CATEGORY_COLOR);
  assert.equal(pinColor({ categoryId: '없는 분류' }, CATS), NO_CATEGORY_COLOR);
  assert.equal(categoryOf({ categoryId: '없는 분류' }, CATS), null);
});

test('아직 안 쓴 색을 먼저 권한다', () => {
  assert.equal(nextColor([]), PALETTE[0].color);
  assert.equal(nextColor(CATS), PALETTE[1].color);
  const all = PALETTE.map((p, i) => ({ id: String(i), name: String(i), color: p.color }));
  assert.equal(nextColor(all), PALETTE[0].color);
});

test('지도 거르기: 전체, 분류 없음, 특정 분류', () => {
  const candidate = { categoryId: 'a' };
  const plain = {};
  assert.equal(matchesFilter(candidate, CATS, null), true);
  assert.equal(matchesFilter(candidate, CATS, 'a'), true);
  assert.equal(matchesFilter(candidate, CATS, 'b'), false);
  assert.equal(matchesFilter(candidate, CATS, 'none'), false);
  assert.equal(matchesFilter(plain, CATS, 'none'), true);
});

test('분류별 보기: 만든 순서대로, 빈 분류는 빼고, 분류 없음은 맨 끝', () => {
  const items = [{ id: '1' }, { id: '2', categoryId: 'b' }, { id: '3', categoryId: '지워진 분류' }];
  const g = groupByCategory(items, CATS);
  assert.deepEqual(g.map((x) => x.title), ['제외', '분류 없음']);
  assert.deepEqual(g[1].items.map((x) => x.id), ['1', '3']);
});

test('핀 그림에 색이 들어간다', () => {
  assert.ok(decodeURIComponent(pinImageUrl('#123456')).includes('#123456'));
  assert.ok(pinImageUrl('#123456').startsWith('data:image/svg+xml'));
});
