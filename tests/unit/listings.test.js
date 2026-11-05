import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanForm, upsertListing, removeListing, newestFirst, isLocated, summaryLine, fieldHint, detailGroups,
  regionFromAddress, createListingStore,
} from '../../js/lib/listings.js';
import { createStore, KEY_PREFIX } from '../../js/lib/store.js';
import { formatManwon, toPyeong } from '../../js/lib/format.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const T1 = new Date('2026-11-05T01:00:00Z');
const T2 = new Date('2026-11-06T01:00:00Z');

test('매물명이 없으면 저장하지 않는다', () => {
  assert.deepEqual(cleanForm({ name: '   ' }), { ok: false, reason: 'name' });
});

test('앞뒤 공백을 다듬고 위치는 숫자 쌍일 때만 받는다', () => {
  const { data } = cleanForm({ name: ' 약국 ', region: ' 서울 중구 ', lat: 37.5, lng: 127 });
  assert.equal(data.name, '약국');
  assert.equal(data.region, '서울 중구');
  assert.deepEqual([data.lat, data.lng], [37.5, 127]);
  const none = cleanForm({ name: '약국', lat: 37.5 }).data;
  assert.deepEqual([none.lat, none.lng], [null, null]);
});

test('새 매물은 추가되고 수정은 등록일을 지킨다', () => {
  const first = upsertListing([], { name: 'A' }, { now: T1, newId: 'a' });
  assert.equal(first.length, 1);
  const edited = upsertListing(first, { name: 'B' }, { id: 'a', now: T2, newId: 'x' });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].id, 'a');
  assert.equal(edited[0].name, 'B');
  assert.equal(edited[0].createdAt, T1.toISOString());
  assert.equal(edited[0].updatedAt, T2.toISOString());
  assert.equal(first[0].name, 'A', '원래 배열은 그대로');
});

test('삭제는 그 매물만 지운다', () => {
  assert.deepEqual(removeListing([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }]);
});

test('최근에 등록한 매물이 먼저 온다', () => {
  const items = [{ id: 'old', createdAt: T1.toISOString() }, { id: 'new', createdAt: T2.toISOString() }];
  assert.deepEqual(newestFirst(items).map((x) => x.id), ['new', 'old']);
});

test('금액 표시', () => {
  assert.equal(formatManwon('5000'), '5,000만원');
  assert.equal(formatManwon('15000'), '1억 5,000만원');
  assert.equal(formatManwon('20000'), '2억');
  assert.equal(formatManwon('5,000'), '5,000만원');
  assert.equal(formatManwon('0'), '0만원');
  assert.equal(formatManwon('신규'), '신규');
  assert.equal(formatManwon(''), '');
});

test('㎡를 평으로 바꾼다', () => {
  assert.equal(toPyeong('33'), '10.0');
  assert.equal(toPyeong('45.5'), '13.8');
  assert.equal(toPyeong('넓음'), '');
  assert.equal(toPyeong('0'), '');
});

test('입력칸 힌트', () => {
  assert.equal(fieldHint('money', '15000'), '1억 5,000만원');
  assert.equal(fieldHint('money-or-new', '신규'), '');
  assert.equal(fieldHint('area', '33'), '약 10.0평');
  assert.equal(fieldHint('text', 'x'), '');
});

test('목록 한 줄과 위치 표시', () => {
  const item = { region: '서울 중구', deposit: '5000', rent: '300', premium: '15000', lat: null, lng: null };
  assert.equal(summaryLine(item), '서울 중구 · 5,000만원 / 300만원 · 권리금 1억 5,000만원 · 위치 없음');
  assert.equal(isLocated(item), false);
  assert.equal(isLocated({ lat: 37, lng: 127 }), true);
  assert.equal(summaryLine({ lat: 37, lng: 127 }), '');
});

test('상세 화면은 입력한 칸만 보여 준다', () => {
  const groups = detailGroups({ name: 'A', deposit: '5000', areaExclusive: '33', memo: '메모' });
  assert.deepEqual(groups.map((g) => g.title), ['거래', '입지', '기타']);
  assert.equal(groups[0].rows[0].value, '5,000만원');
  assert.equal(groups[1].rows[0].value, '33㎡ (약 10.0평)');
});

test('주소에서 시·구까지가 지역이다', () => {
  assert.equal(regionFromAddress('서울 중구 가짜대로 1'), '서울 중구');
  assert.equal(regionFromAddress('경기 성남시 중원구 가짜동 3'), '경기 성남시 중원구');
  assert.equal(regionFromAddress('경기 평택시 가짜동 4-4'), '경기 평택시');
  assert.equal(regionFromAddress(''), '');
});

test('저장하면 한글까지 같은 값으로 다시 읽힌다', () => {
  const s = fakeStorage();
  const a = createListingStore(createStore(() => s));
  assert.deepEqual(a.load(), { ok: true, items: [] });
  assert.equal(a.save([{ id: 'a', name: '○○약국 ☕' }]).ok, true);
  const b = createListingStore(createStore(() => s));
  assert.deepEqual(b.load().items, [{ id: 'a', name: '○○약국 ☕' }]);
});

test('읽지 못한 데이터는 덮어쓰지 않는다', () => {
  const key = `${KEY_PREFIX}listings`;
  const s = fakeStorage({ [key]: '{깨진 값' });
  const ls = createListingStore(createStore(() => s));
  assert.equal(ls.load().reason, 'corrupt');
  const r = ls.save([{ id: 'new' }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'blocked');
  assert.equal(s.m.get(key), '{깨진 값');
});

test('읽기 전에는 막지 않지만 공간 부족은 그대로 알린다', () => {
  const s = fakeStorage();
  s.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  const ls = createListingStore(createStore(() => s));
  ls.load();
  assert.equal(ls.save([{ id: 'a' }]).reason, 'quota');
});

test('주소를 저장한다', () => {
  assert.equal(cleanForm({ name: '약국', address: ' 서울 중구 가짜대로 1 ' }).data.address, '서울 중구 가짜대로 1');
});

test('상세 화면에 주소가 보인다', () => {
  const groups = detailGroups({ name: 'A', address: '서울 중구 가짜대로 1' });
  assert.deepEqual(groups[0].rows[0], { label: '주소', value: '서울 중구 가짜대로 1', long: false });
});
