// 백업 파일을 만들고 검사합니다. 1단계의 파일은 왕복만 증명하는 시험 파일이고, 진짜 백업(2단계)과 구분합니다.
// 2단계의 복원은 purpose가 있는 파일을 거절해야 합니다.
export const BACKUP_APP = 'imjang-map';
export const BACKUP_SCHEMA = 1;
export const BACKUP_EXT = '.json';
export const MAX_BYTES = 1024 * 1024; // 설계값. 시험 파일은 1KB 미만이고, 동영상을 고른 경우를 통째로 읽기 전에 막습니다.
export const PROBE_TEXT = '약국 임장 ☕🏥 "따옴표"\n줄바꿈';

const pad = (n) => String(n).padStart(2, '0');

// toISOString은 한국에서 아침 9시 전에 전날이 되므로 폰의 날짜로 만듭니다.
export function backupFileName(now) {
  return `imjang-test-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${BACKUP_EXT}`;
}

export function buildTestBackup({ nonce, now }) {
  const body = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA,
    purpose: 'connection-test',
    exportedAt: now.toISOString(),
    probe: { nonce, text: PROBE_TEXT },
  };
  return { fileName: backupFileName(now), text: JSON.stringify(body, null, 2) };
}

// 아이폰·아이패드 앱에서 공유가 될 때만 공유 창을 씁니다.
// 안드로이드 크롬은 허용 목록에 json이 없는데도 canShare가 true를 줄 수 있어 시도하지 않습니다.
export function chooseExportPath({ apple, isApp, canShare }) {
  return apple && isApp && canShare ? 'share' : 'download';
}

// 파일을 고쳐 쓰지 않습니다. 읽고 비교만 합니다. 돌려주는 값: { ok: true } | { ok: false, reason, detail? }
export function parseBackup(buffer, { nonce }) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, reason: 'encoding' };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  if (data === null || typeof data !== 'object' || data.app !== BACKUP_APP) return { ok: false, reason: 'other-app' };
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) return { ok: false, reason: 'other-app' };
  if (data.schemaVersion > BACKUP_SCHEMA) return { ok: false, reason: 'newer' };
  if (!data.probe || !nonce || data.probe.nonce !== nonce) return { ok: false, reason: 'not-this-run' };
  if (data.probe.text !== PROBE_TEXT) return { ok: false, reason: 'probe-diff' };
  return { ok: true };
}

// file.type과 file.name은 판정에 쓰지 않습니다.
export async function readBackupFile(file, { nonce }) {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'too-big' };
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: 'read-failed', detail: e?.name || String(e) };
  }
  return parseBackup(buffer, { nonce });
}
