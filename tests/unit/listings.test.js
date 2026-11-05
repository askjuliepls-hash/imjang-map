import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_GROUPS, cleanForm, upsertListing, removeListing, newestFirst, isLocated, summaryLine, fieldHint, detailGroups,
  formatVisitDate, groupByVisitDate, groupByRegion, regionOf, listingFacts, sideLabel,
  regionFromAddress, createListingStore,
} from '../../js/lib/listings.js';
import { createStore, KEY_PREFIX } from '../../js/lib/store.js';
import { formatManwon, toPyeong, fromPyeong } from '../../js/lib/format.js';

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
  assert.equal(summaryLine(item), '위치 없음');
  assert.equal(sideLabel(item), '서울 중구');
  assert.deepEqual(listingFacts(item), [
    { label: '권리금', value: '1억 5,000만원' },
    { label: '보증금', value: '5,000만원' },
    { label: '월세', value: '300만원' },
  ]);
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

const NOW = new Date(2026, 10, 5);

test('임장일이 양식 맨 위이고 예상 순수익은 수익 묶음에 있다', () => {
  assert.equal(FIELD_GROUPS[0].fields[0].key, 'visitDate');
  const profit = FIELD_GROUPS.find((g) => g.title === '수익').fields.map((f) => f.key);
  assert.ok(profit.includes('netProfit'));
  assert.equal(cleanForm({ name: 'A', netProfit: ' 800 ' }).data.netProfit, '800');
});

test('상세에 예상 순수익이 금액으로 보인다', () => {
  const g = detailGroups({ name: 'A', netProfit: '1200' }).find((x) => x.title === '수익');
  assert.deepEqual(g.rows[0], { label: '예상 순수익(월)', value: '1,200만원', strong: true });
});

test('임장 날짜 표시', () => {
  assert.equal(formatVisitDate('2026-11-05', NOW), '11월 5일 (목)');
  assert.equal(formatVisitDate('2025-01-02', NOW), '2025년 1월 2일 (목)');
  assert.equal(formatVisitDate('', NOW), '');
});

const L = (id, visitDate, region, createdAt = '2026-11-01T00:00:00Z', address = '') => ({ id, visitDate, region, createdAt, address });

test('임장 날짜별: 최근 날짜부터, 임장일 없는 매물은 맨 끝', () => {
  const g = groupByVisitDate([L('old', '2026-10-01', ''), L('none', '', ''), L('new', '2026-11-05', ''), L('new2', '2026-11-05', '', '2026-11-03T00:00:00Z')], NOW);
  assert.deepEqual(g.map((x) => x.title), ['11월 5일 (목)', '10월 1일 (목)', '임장 전']);
  assert.deepEqual(g[0].items.map((x) => x.id), ['new2', 'new']);
  assert.deepEqual(g[2].items.map((x) => x.id), ['none']);
});

test('지역별: 가나다순, 같은 지역 안에서는 최근 임장부터, 모르면 맨 끝', () => {
  const g = groupByRegion([L('a', '2026-10-01', '서울 중구'), L('b', '2026-11-01', '서울 중구'), L('c', '', '경기 성남시 중원구'), L('d', '', '')]);
  assert.deepEqual(g.map((x) => x.title), ['경기 성남시 중원구', '서울 중구', '지역 없음']);
  assert.deepEqual(g[1].items.map((x) => x.id), ['b', 'a']);
});

test('지역 칸이 비어 있으면 주소에서 읽는다', () => {
  assert.equal(regionOf(L('a', '', '', 'x', '경기 성남시 중원구 가짜대로 10')), '경기 성남시 중원구');
  assert.equal(groupByRegion([L('a', '', '', 'x', '서울 중구 가짜대로 1')])[0].title, '서울 중구');
});

test('묶음 제목과 겹치는 정보는 목록 줄에서 뺀다', () => {
  const item = L('a', '2026-11-05', '서울 중구');
  item.lat = 37;
  item.lng = 127;
  assert.equal(summaryLine(item, { view: 'date', now: NOW }), '');
  assert.equal(summaryLine(item, { view: 'region', now: NOW }), '');
  assert.equal(summaryLine(item, { view: 'category', now: NOW }), '11월 5일 (목)');
  assert.equal(sideLabel(item, { view: 'date', now: NOW }), '서울 중구');
  assert.equal(sideLabel(item, { view: 'region', now: NOW }), '11월 5일 (목)');
  assert.equal(sideLabel(item, { view: 'category', now: NOW }), '서울 중구');
});

test('평을 ㎡로 바꾸고, 다시 평으로 봐도 같다', () => {
  assert.equal(fromPyeong('25'), '82.65');
  assert.equal(toPyeong(fromPyeong('25')), '25.0');
  assert.equal(fromPyeong('넓음'), '');
  assert.equal(fromPyeong('0'), '');
});

test('목록 금액은 적은 것만, 예상 순수익까지 보여 준다', () => {
  assert.deepEqual(listingFacts({ netProfit: '800' }), [{ label: '예상 순수익', value: '800만원' }]);
  assert.deepEqual(listingFacts({}), []);
});
