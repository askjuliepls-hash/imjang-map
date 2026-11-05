import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backupFileName, buildTestBackup, chooseExportPath, parseBackup, readBackupFile, BACKUP_SCHEMA, MAX_BYTES, PROBE_TEXT,
} from '../../js/lib/backup.js';

const NONCE = 'abc123';
const enc = (s) => new TextEncoder().encode(s).buffer;
const good = () => JSON.parse(buildTestBackup({ nonce: NONCE, now: new Date(2026, 10, 5, 14, 32) }).text);
const reason = (obj) => parseBackup(enc(JSON.stringify(obj)), { nonce: NONCE }).reason;
const stubFile = (buffer, size = buffer.byteLength) => ({ size, arrayBuffer: async () => buffer });

test('왕복하면 글자 단위로 일치한다', () => {
  const { text } = buildTestBackup({ nonce: NONCE, now: new Date() });
  assert.deepEqual(parseBackup(enc(text), { nonce: NONCE }), { ok: true });
  assert.equal(JSON.parse(text).probe.text, PROBE_TEXT);
});

test('시험 파일임이 표시되고 형식 버전이 들어간다', () => {
  assert.equal(good().purpose, 'connection-test');
  assert.equal(good().schemaVersion, BACKUP_SCHEMA);
});

test('파일 이름은 폰의 날짜로 만든다(아침 9시 전에 전날이 되지 않음)', () => {
  assert.equal(backupFileName(new Date(2026, 10, 5, 0, 30)), 'imjang-test-2026-11-05.json');
});

test('경로 선택표: 아이폰·아이패드 앱에서 공유가 될 때만 공유', () => {
  assert.equal(chooseExportPath({ apple: true, isApp: true, canShare: true }), 'share');
  assert.equal(chooseExportPath({ apple: true, isApp: true, canShare: false }), 'download');
  assert.equal(chooseExportPath({ apple: false, isApp: true, canShare: true }), 'download');
  assert.equal(chooseExportPath({ apple: true, isApp: false, canShare: true }), 'download');
});

test('BOM이 있어도 통과한다', () => {
  const { text } = buildTestBackup({ nonce: NONCE, now: new Date() });
  assert.deepEqual(parseBackup(enc(`﻿${text}`), { nonce: NONCE }), { ok: true });
});

test('잘못된 파일마다 고유한 이유로 처리된다', () => {
  // EUC-KR로 저장된 '약국'
  assert.equal(parseBackup(new Uint8Array([0xbe, 0xe0, 0xb1, 0xb9]).buffer, { nonce: NONCE }).reason, 'encoding');
  assert.equal(parseBackup(enc('{ 잘린 파일'), { nonce: NONCE }).reason, 'bad-json');
  assert.equal(reason(null), 'other-app');
  assert.equal(reason(3), 'other-app');
  assert.equal(reason({ ...good(), app: 'other' }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: 0 }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: -1 }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: '1' }), 'other-app');
  assert.equal(reason({ ...good(), schemaVersion: BACKUP_SCHEMA + 1 }), 'newer');
  const { probe, ...noProbe } = good();
  assert.ok(probe);
  assert.equal(reason(noProbe), 'not-this-run');
  assert.equal(reason({ ...good(), probe: { nonce: 'other', text: PROBE_TEXT } }), 'not-this-run');
  assert.equal(reason({ ...good(), probe: { nonce: NONCE, text: '바뀐 글자' } }), 'probe-diff');
});

test('앞으로의 진짜 백업 형식은 더 높은 버전이면 newer다', () => {
  assert.equal(reason({ app: 'imjang-map', schemaVersion: BACKUP_SCHEMA + 1, items: [] }), 'newer');
});

test('이번에 내보낸 적이 없으면 올바른 파일도 이번 파일로 치지 않는다', () => {
  const { text } = buildTestBackup({ nonce: NONCE, now: new Date() });
  assert.equal(parseBackup(enc(text), { nonce: undefined }).reason, 'not-this-run');
});

test('빈 파일·크기 초과·읽기 실패', async () => {
  const opt = { nonce: NONCE };
  assert.equal((await readBackupFile(stubFile(new ArrayBuffer(0)), opt)).reason, 'empty');
  assert.equal((await readBackupFile(stubFile(new ArrayBuffer(1), MAX_BYTES + 1), opt)).reason, 'too-big');
  const broken = { size: 10, arrayBuffer: async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); } };
  assert.deepEqual(await readBackupFile(broken, opt), { ok: false, reason: 'read-failed', detail: 'NotFoundError' });
});

test('좋은 파일은 파일로도 통과한다', async () => {
  const { text } = buildTestBackup({ nonce: NONCE, now: new Date() });
  assert.deepEqual(await readBackupFile(stubFile(enc(text)), { nonce: NONCE }), { ok: true });
});
