import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPlaces, formatDistance } from '../../js/lib/places.js';

const CENTER = { lat: 37.42, lng: 127.127 }; // 성남 부근
const place = (id, name, address, lat, lng) => ({ id, place_name: name, address_name: address, road_address_name: '', y: String(lat), x: String(lng) });
const JINJU = place('1', '가짜약국', '경남 진주시 가짜동 1', 35.15, 128.1);
const SEOUL = place('2', '가짜약국', '서울 용산구 가짜동 2', 37.53, 126.96);
const SEONGNAM = place('3', '가짜약국', '경기 성남시 중원구 가짜동 3', 37.44, 127.14);
const NEAR_OTHER = place('4', '가짜다른약국', '경기 성남시 분당구 가짜동 5', 37.4, 127.11);

test('찾는 말이 맞는 곳만 지도에 가까운 순으로 보여 준다(근처의 다른 약국은 뺀다)', () => {
  const r = rankPlaces([JINJU, SEOUL, NEAR_OTHER, SEONGNAM], '가짜약국', CENTER);
  assert.deepEqual(r.map((x) => x.id), ['3', '2', '1']);
});

test('맞는 곳이 하나도 없으면 비슷한 결과라도 보여 준다', () => {
  const r = rankPlaces([NEAR_OTHER], '오타약국', CENTER);
  assert.deepEqual(r.map((x) => x.id), ['4']);
});

test('지역을 같이 적어도 맞는 결과로 친다', () => {
  const r = rankPlaces([NEAR_OTHER, SEONGNAM], '성남 가짜약국', CENTER);
  assert.deepEqual(r.map((x) => x.id), ['3']);
});

test('두 번 받은 결과는 한 번만 보여 준다', () => {
  assert.equal(rankPlaces([SEONGNAM, SEONGNAM, SEOUL], '가짜약국', CENTER).length, 2);
});

test('지도 중심을 모르면 받은 순서를 지킨다', () => {
  const r = rankPlaces([JINJU, SEOUL], '가짜약국', null);
  assert.deepEqual(r.map((x) => x.id), ['1', '2']);
  assert.equal(formatDistance(r[0].distance), '');
});

test('거리 표시', () => {
  assert.equal(formatDistance(850), '850m');
  assert.equal(formatDistance(2340), '2.3km');
  assert.equal(formatDistance(23400), '23km');
});
