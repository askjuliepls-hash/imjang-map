import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backupFileName, buildBackup, chooseExportPath, parseBackup, readBackupFile, needsReminder, formatBackupTime,
  backupPrint, countChanges,
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

test('마지막 백업에서 7일이 지났고 바꾼 내용이 있을 때만 알린다', () => {
  const day = (n) => new Date(2026, 10, n).toISOString();
  const now = new Date(2026, 10, 20);
  assert.equal(needsReminder({ count: 3, lastBackupAt: day(10), dirtySince: day(19), now }), true, '10일 전 백업, 어제 바꿈');
  assert.equal(needsReminder({ count: 3, lastBackupAt: day(10), dirtySince: null, now }), false, '10일 전 백업, 바꾼 내용 없음');
  assert.equal(needsReminder({ count: 3, lastBackupAt: day(18), dirtySince: day(19), now }), false, '2일 전 백업');
  assert.equal(needsReminder({ count: 3, lastBackupAt: null, dirtySince: day(12), now }), true, '백업한 적 없고 처음 바꾼 지 8일');
  assert.equal(needsReminder({ count: 3, lastBackupAt: null, dirtySince: day(15), now }), false, '백업한 적 없고 처음 바꾼 지 5일');
  assert.equal(needsReminder({ count: 0, lastBackupAt: null, dirtySince: day(1), now }), false, '매물이 없음');
});

test('매물 1000개 백업도 가져오기 한도 안에 든다', () => {
  const fat = { name: '○○대학병원 문전약국', review: '유동인구 많고 처방전 수 많음. '.repeat(20), lat: 37.5, lng: 127 };
  const listings = Array.from({ length: 1000 }, (_, i) => ({ ...fat, id: String(i) }));
  const { text } = buildBackup({ listings, categories: [], now: NOW });
  assert.ok(new TextEncoder().encode(text).length < MAX_BYTES);
});

test('백업 뒤 바뀐 건수는 누른 횟수가 아니라 내용을 비교해 구한다', () => {
  const A = { id: 'a', name: '가', review: '', lat: null, lng: null, createdAt: 'x', updatedAt: 't1' };
  const B = { id: 'b', name: '나', createdAt: 'y', updatedAt: 't1' };
  const C = [{ id: 'c', name: '후보', color: '#F96949' }];
  const base = backupPrint({ listings: [A, B], categories: C });
  const count = (listings, categories = C) => countChanges(base, { listings, categories });
  assert.equal(count([A, B]), 0, '그대로');
  assert.equal(count([B, A]), 0, '순서만 다름');
  assert.equal(count([A, B, { id: 'n', name: '새' }]), 1, '추가');
  assert.equal(count([A]), 1, '삭제');
  assert.equal(count([{ ...A, name: '다' }, B]), 1, '수정');
  assert.equal(count([{ ...A, name: '다' }, { id: 'n', name: '새' }]), 3, '수정 + 추가 + 삭제');
  assert.equal(count([{ ...A, updatedAt: 't2' }, B]), 0, '저장 시각만 다름');
  assert.equal(count([{ ...A, rent: '' }, B]), 0, '빈 칸이 늘어남');
  assert.equal(count([{ name: '가', id: 'a', createdAt: 'x' }, B]), 0, '칸 순서만 다름');
  assert.equal(count([A, B], []), 1, '분류만 지움');
  assert.equal(count([A, B], [{ ...C[0], name: '유력' }]), 1, '분류 이름만 바꿈');
  assert.equal(count([{ ...A, categoryId: 'n' }, B], []), 1, '매물과 분류가 같이 바뀌어도 매물 수만큼');
  assert.equal(count([], []), 0, '매물이 없으면 내보낼 것도 없음');
});

test('백업한 적이 없으면 매물 수만큼이고 분류는 더하지 않는다', () => {
  const listings = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: `약국 ${i}` }));
  assert.equal(countChanges(null, { listings, categories: [{ id: 'c', name: '후보', color: '#F96949' }] }), 9);
  assert.equal(countChanges(null, { listings: [], categories: [{ id: 'c', name: '후보', color: '#F96949' }] }), 0);
});

test('지문은 글자 하나만 달라도, 글자 순서만 달라도 다르다', () => {
  const print = (name) => backupPrint({ listings: [{ id: 'a', name }], categories: [] }).listings.a;
  assert.equal(new Set(Array.from({ length: 2000 }, (_, i) => print(`약국 ${i}`))).size, 2000);
  assert.notEqual(print('가나'), print('나가'));
  assert.equal(print('가나'), print('가나'));
});

test('백업 시각 표시', () => {
  assert.equal(formatBackupTime(new Date(2026, 10, 5, 14, 2).toISOString()), '2026.11.05 14:02');
  assert.equal(formatBackupTime('x'), '');
});
