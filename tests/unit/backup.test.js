import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backupFileName, buildBackup, chooseExportPath, parseBackup, readBackupFile, needsReminder, formatBackupTime,
  BACKUP_SCHEMA, MAX_BYTES,
} from '../../js/lib/backup.js';

const NOW = new Date(2026, 10, 5, 0, 30);
const enc = (s) => new TextEncoder().encode(s).buffer;
const LISTINGS = [
  { id: 'a', name: '○○약국 "임대" ☕\n둘째 줄', premium: '15000', lat: 37.5, lng: 127, categoryId: 'c1', address: '서울 중구' },
  { id: 'b', name: '위치 없는 약국', lat: null, lng: null, categoryId: null },
];
const CATS = [{ id: 'c1', name: '후보', color: '#F96949' }];
const good = () => JSON.parse(buildBackup({ listings: LISTINGS, categories: CATS, now: NOW }).text);
const reason = (obj) => parseBackup(enc(JSON.stringify(obj))).reason;

test('왕복하면 매물과 분류가 글자까지 그대로다', () => {
  const r = parseBackup(enc(buildBackup({ listings: LISTINGS, categories: CATS, now: NOW }).text));
  assert.equal(r.ok, true);
  assert.deepEqual(r.listings, LISTINGS);
  assert.deepEqual(r.categories, CATS);
  assert.equal(r.exportedAt, NOW.toISOString());
});

test('파일 이름은 폰의 날짜와 시각으로 만든다(아침 9시 전에 전날이 되지 않음)', () => {
  assert.equal(backupFileName(NOW), 'imjang-backup-2026-11-05-0030.json');
});

test('경로 선택표: 아이폰·아이패드 앱에서 공유가 될 때만 공유', () => {
  assert.equal(chooseExportPath({ apple: true, isApp: true, canShare: true }), 'share');
  assert.equal(chooseExportPath({ apple: true, isApp: true, canShare: false }), 'download');
  assert.equal(chooseExportPath({ apple: false, isApp: true, canShare: true }), 'download');
  assert.equal(chooseExportPath({ apple: true, isApp: false, canShare: true }), 'download');
});

test('BOM이 있어도 읽는다', () => {
  assert.equal(parseBackup(enc(`﻿${JSON.stringify(good())}`)).ok, true);
});

test('잘못된 파일마다 이유가 다르다', () => {
  // EUC-KR로 저장된 '약국'
  assert.equal(parseBackup(new Uint8Array([0xbe, 0xe0, 0xb1, 0xb9]).buffer).reason, 'encoding');
  assert.equal(parseBackup(enc('{ 잘린 파일')).reason, 'bad-json');
  assert.equal(reason(null), 'other-app');
  assert.equal(reason(3), 'other-app');
  assert.equal(reason({ ...good(), app: 'other' }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: 0 }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: '1' }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: BACKUP_SCHEMA + 1 }), 'newer');
});

test('연결 점검 때 만든 시험 파일은 거절한다', () => {
  assert.equal(reason({ app: 'imjang-map', schemaVersion: 1, purpose: 'connection-test', probe: {} }), 'test-file');
});

test('모양이 틀리면 거절한다', () => {
  assert.equal(reason({ ...good(), listings: 'x' }), 'bad-shape');
  assert.equal(reason({ ...good(), listings: [null] }), 'bad-shape');
  assert.equal(reason({ ...good(), listings: [{ id: 'a' }], count: 1 }), 'bad-shape');
  assert.equal(reason({ ...good(), listings: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }], count: 2 }), 'bad-shape');
  assert.equal(reason({ ...good(), count: 99 }), 'bad-shape', '개수가 안 맞으면 잘린 파일');
  assert.equal(reason({ ...good(), categories: [{ id: 'c', name: 'x' }] }), 'bad-shape');
});

test('핀 색은 형식이 맞아야 받는다(그림에 그대로 들어가는 값)', () => {
  assert.equal(reason({ ...good(), categories: [{ id: 'c', name: 'x', color: '"/><script>' }] }), 'bad-shape');
  assert.equal(reason({ ...good(), categories: [{ id: 'c', name: 'x', color: 'red' }] }), 'bad-shape');
});

test('좌표가 숫자 쌍이 아니면 위치 없음으로 둔다', () => {
  const r = parseBackup(enc(JSON.stringify({ ...good(), count: 1, listings: [{ id: 'a', name: 'x', lat: '37', lng: 127 }] })));
  assert.equal(r.ok, true);
  assert.equal(r.listings[0].lat, null);
  assert.equal(r.listings[0].lng, null);
});

test('분류가 없는 옛 파일도 읽는다', () => {
  const { categories, ...old } = good();
  assert.ok(categories);
  const r = parseBackup(enc(JSON.stringify(old)));
  assert.equal(r.ok, true);
  assert.deepEqual(r.categories, []);
});

test('예상 밖의 값(객체 등)은 들어오지 않는다', () => {
  const raw = '{"app":"imjang-map","schemaVersion":1,"listings":[{"id":"a","name":"x","__proto__":{"bad":1},"memo":{"a":1},"lat":null,"lng":null}]}';
  const r = parseBackup(enc(raw));
  assert.equal(r.ok, true);
  assert.equal(r.listings[0].memo, undefined);
  assert.equal({}.bad, undefined);
});

const stubFile = (buffer, size = buffer.byteLength) => ({ size, arrayBuffer: async () => buffer });

test('빈 파일·크기 초과·읽기 실패', async () => {
  assert.equal((await readBackupFile(stubFile(new ArrayBuffer(0)))).reason, 'empty');
  assert.equal((await readBackupFile(stubFile(new ArrayBuffer(1), MAX_BYTES + 1))).reason, 'too-big');
  const broken = { size: 10, arrayBuffer: async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); } };
  assert.deepEqual(await readBackupFile(broken), { ok: false, reason: 'read-failed', detail: 'NotFoundError' });
});

test('바뀐 내용이 7일 넘게 백업 안 되면 알린다', () => {
  const day = (n) => new Date(2026, 10, n).toISOString();
  const now = new Date(2026, 10, 10);
  assert.equal(needsReminder({ count: 3, dirtySince: day(3), now }), true);
  assert.equal(needsReminder({ count: 3, dirtySince: day(5), now }), false);
  assert.equal(needsReminder({ count: 3, dirtySince: null, now }), false, '백업 뒤 바뀐 게 없음');
  assert.equal(needsReminder({ count: 0, dirtySince: day(1), now }), false, '매물이 없음');
});

test('매물 1000개 백업도 가져오기 한도 안에 든다', () => {
  const fat = { name: '○○대학병원 문전약국', review: '유동인구 많고 처방전 수 많음. '.repeat(20), lat: 37.5, lng: 127 };
  const listings = Array.from({ length: 1000 }, (_, i) => ({ ...fat, id: String(i) }));
  const { text } = buildBackup({ listings, categories: [], now: NOW });
  assert.ok(new TextEncoder().encode(text).length < MAX_BYTES);
});

test('백업 시각 표시', () => {
  assert.equal(formatBackupTime(new Date(2026, 10, 5, 14, 2).toISOString()), '2026.11.05 14:02');
  assert.equal(formatBackupTime('x'), '');
});
