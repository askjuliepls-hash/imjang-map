// 백업 파일을 만들고 검사합니다. 파일은 읽고 비교만 하고, 교체는 사용자가 확인한 뒤에 합니다.
export const BACKUP_APP = 'imjang-map';
export const BACKUP_SCHEMA = 1;
export const BACKUP_EXT = '.json';
export const MAX_BYTES = 20 * 1024 * 1024; // 이 기기 저장 한도(약 5MB, 한글은 파일에서 약 3배)보다 넉넉히. 동영상을 고른 경우를 통째로 읽기 전에 막습니다.
export const REMIND_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');
const DAY = 24 * 60 * 60 * 1000;

// 같은 날 여러 번 백업해도 구별되게 시각까지 넣습니다. 폰의 시간으로 만듭니다.
export function backupFileName(now) {
  return `imjang-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${BACKUP_EXT}`;
}

export function buildBackup({ listings, categories, now }) {
  const body = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA,
    exportedAt: now.toISOString(),
    count: listings.length,
    listings,
    categories,
  };
  return { fileName: backupFileName(now), text: JSON.stringify(body, null, 2) };
}

// 아이폰·아이패드 앱에서 공유가 될 때만 공유 창을 씁니다.
// 안드로이드 크롬은 허용 목록에 json이 없는데도 canShare가 true를 줄 수 있어 시도하지 않습니다.
export function chooseExportPath({ apple, isApp, canShare }) {
  return apple && isApp && canShare ? 'share' : 'download';
}

const finite = (v) => (Number.isFinite(v) ? v : null);

// 파일에서 온 값은 믿지 않습니다. 모양을 검사하고, 지도와 화면이 쓰는 값만 안전하게 맞춥니다.
function cleanListings(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name) return null;
    if (seen.has(raw.id)) return null;
    seen.add(raw.id);
    const item = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__proto__') continue;
      if (typeof v === 'string' || typeof v === 'number' || v === null) item[k] = v;
    }
    item.lat = finite(raw.lat);
    item.lng = finite(raw.lng);
    if (item.lat === null || item.lng === null) {
      item.lat = null;
      item.lng = null;
    }
    out.push(item);
  }
  return out;
}

function cleanCategories(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name) return null;
    // 색은 핀 그림에 그대로 들어가니 형식이 맞을 때만 받습니다.
    if (typeof raw.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(raw.color)) return null;
    out.push({ id: raw.id, name: raw.name, color: raw.color });
  }
  return out;
}

// 돌려주는 값: { ok: true, listings, categories, exportedAt } | { ok: false, reason }
export function parseBackup(buffer) {
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
  if (data.purpose) return { ok: false, reason: 'test-file' }; // 연결 점검 때 만든 시험 파일
  const listings = cleanListings(data.listings);
  const categories = cleanCategories(data.categories);
  if (!listings || !categories) return { ok: false, reason: 'bad-shape' };
  if (Number.isInteger(data.count) && data.count !== listings.length) return { ok: false, reason: 'bad-shape' };
  return { ok: true, listings, categories, exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '' };
}

// file.type과 file.name은 판정에 쓰지 않습니다.
export async function readBackupFile(file) {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'too-big' };
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: 'read-failed', detail: e?.name || String(e) };
  }
  return parseBackup(buffer);
}

// 마지막 백업에서 며칠이 지났고 그 뒤 바꾼 내용이 있을 때만 알립니다.
// 백업한 적이 없으면 처음 바꾼 때부터 셉니다.
export function needsReminder({ count, dirtySince, lastBackupAt, now, days = REMIND_DAYS }) {
  if (!count || !dirtySince) return false;
  const since = new Date(lastBackupAt || dirtySince).getTime();
  return Number.isFinite(since) && now.getTime() - since >= days * DAY;
}

// 몇 번 눌렀는지가 아니라 내용을 마지막 백업과 비교합니다. 매물마다 짧은 지문만 남겨 저장 공간을 거의 쓰지 않습니다.
function hashText(text) {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

// 저장 시각과 빈 칸은 빼고 봅니다. 고쳤다가 원래대로 돌리면 바뀐 게 없습니다.
function printOf(value) {
  const parts = Object.keys(value)
    .filter((k) => k !== 'updatedAt' && value[k] !== '' && value[k] !== null && value[k] !== undefined)
    .sort()
    .map((k) => [k, value[k]]);
  return hashText(JSON.stringify(parts));
}

export function backupPrint({ listings, categories }) {
  return {
    listings: Object.fromEntries(listings.map((x) => [x.id, printOf(x)])),
    categories: categories.map(printOf).join(),
  };
}

// 마지막 백업과 달라진 매물 수. 매물은 그대로이고 분류만 바뀌었으면 1건입니다.
export function countChanges(base, { listings, categories }) {
  if (listings.length === 0) return 0; // 매물이 없으면 내보낼 것도 없습니다.
  const now = backupPrint({ listings, categories });
  const was = base?.listings ?? {};
  const ids = new Set(Object.keys(now.listings));
  const changed = [...ids].filter((id) => was[id] !== now.listings[id]).length;
  const removed = Object.keys(was).filter((id) => !ids.has(id)).length;
  if (changed + removed > 0) return changed + removed;
  return now.categories === (base?.categories ?? '') ? 0 : 1;
}

// 화면에 보여 줄 시각. '2026-11-05T05:32:00Z' → '2026.11.05 14:32'(폰의 시간)
export function formatBackupTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
