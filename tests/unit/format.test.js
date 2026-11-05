import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatWhen } from '../../js/lib/format.js';

// 날짜는 현지 시각 구성요소로 만들어서 실행 환경의 시간대와 무관하게 검사합니다.
const now = new Date(2026, 10, 5, 14, 30, 0); // 2026-11-05 14:30:00

test('시각은 두 자리로 맞춘다', () => {
  assert.equal(formatClock(new Date(2026, 0, 1, 9, 5, 7)), '09:05:07');
});

test('오늘이면 "오늘"을 붙인다', () => {
  assert.equal(formatWhen(new Date(2026, 10, 5, 14, 2, 33), now), '오늘 14:02:33');
});

test('올해 다른 날이면 월·일', () => {
  assert.equal(formatWhen(new Date(2026, 10, 4, 23, 59, 59), now), '11월 4일 23:59:59');
});

test('다른 해면 연도까지', () => {
  assert.equal(formatWhen(new Date(2025, 11, 31, 8, 0, 0), now), '2025년 12월 31일 08:00:00');
});

test('같은 날짜 숫자라도 달이 다르면 오늘이 아니다', () => {
  assert.equal(formatWhen(new Date(2026, 9, 5, 14, 0, 0), now), '10월 5일 14:00:00');
});
