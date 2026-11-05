// 매물 데이터의 규칙입니다. 화면과 무관해서 자동 테스트로 확인합니다.
import { formatManwon, toPyeong } from './format.js';

const LISTINGS_KEY = 'listings';

// 양식과 상세 화면이 함께 쓰는 항목 정의입니다. 위치(lat, lng)는 양식에서 따로 다룹니다.
export const FIELD_GROUPS = [
  { title: '기본', fields: [
    { key: 'visitDate', label: '임장일', kind: 'date' },
    { key: 'name', label: '매물명', required: true, placeholder: '예: ○○병원 앞 약국 임대' },
    { key: 'region', label: '지역', placeholder: '예: 서울 중구' },
  ] },
  { title: '거래', fields: [
    { key: 'dealType', label: '거래유형', placeholder: '임대, 양도 등' },
    { key: 'deposit', label: '보증금', kind: 'money' },
    { key: 'rent', label: '월세', kind: 'money' },
    { key: 'maintenance', label: '관리비', kind: 'money' },
    { key: 'premium', label: '권리금', kind: 'money' },
  ] },
  { title: '입지', fields: [
    { key: 'district', label: '상권', placeholder: '예: 종합병원' },
    { key: 'areaExclusive', label: '전용면적', kind: 'area' },
    { key: 'areaSupply', label: '공급면적', kind: 'area' },
    { key: 'shape', label: '형태', placeholder: '예: 조제위주' },
  ] },
  { title: '수익', fields: [
    { key: 'dispensing', label: '조제료(월)', kind: 'money-or-new' },
    { key: 'otc', label: '일반매출(일)', kind: 'money-or-new' },
    { key: 'netProfit', label: '예상 순수익(월)', kind: 'money-or-new', placeholder: '' },
  ] },
  { title: '임장', fields: [
    { key: 'review', label: '후기·디테일', kind: 'long' },
  ] },
  { title: '기타', fields: [
    { key: 'memo', label: '메모', kind: 'long', placeholder: '컨설팅비, 중개사 연락처 등' },
  ] },
];

const ALL_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields);

// 입력값을 다듬고 검사합니다. 위치는 숫자 쌍일 때만 받습니다.
export function cleanForm(raw) {
  const data = {};
  for (const f of ALL_FIELDS) data[f.key] = String(raw[f.key] ?? '').trim();
  data.locationMemo = String(raw.locationMemo ?? '').trim();
  data.address = String(raw.address ?? '').trim();
  data.categoryId = raw.categoryId || null;
  const located = Number.isFinite(raw.lat) && Number.isFinite(raw.lng);
  data.lat = located ? raw.lat : null;
  data.lng = located ? raw.lng : null;
  if (!data.name) return { ok: false, reason: 'name' };
  return { ok: true, data };
}

export function makeListingId(now, random) {
  return `${now.getTime().toString(36)}-${random}`;
}

// 새 매물이면 추가하고, 있으면 등록일을 지킨 채 바꿉니다. 원래 배열은 건드리지 않습니다.
export function upsertListing(items, data, { id, now, newId }) {
  const stamp = now.toISOString();
  const found = id ? items.find((x) => x.id === id) : null;
  if (found) return items.map((x) => (x.id === id ? { ...data, id, createdAt: x.createdAt, updatedAt: stamp } : x));
  return [...items, { ...data, id: newId, createdAt: stamp, updatedAt: stamp }];
}

export function removeListing(items, id) {
  return items.filter((x) => x.id !== id);
}

export function newestFirst(items) {
  return [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function isLocated(item) {
  return Number.isFinite(item.lat) && Number.isFinite(item.lng);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// '2026-11-05' → '2026년 11월 5일 (목)'. 해가 바뀌어도 헷갈리지 않게 연도를 늘 보여 줍니다.
export function formatVisitDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

// 좁은 자리에 쓰는 짧은 날짜. '2026-11-05' → '2026.11.05'
export function shortVisitDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? value.replaceAll('-', '.') : '';
}

// 달력 한 달치 칸. 일요일부터 시작하고 빈칸은 null입니다. month는 1~12입니다.
export function monthCells(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const cells = Array(new Date(year, month - 1, 1).getDay()).fill(null);
  const days = new Date(year, month, 0).getDate();
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// 임장한 날짜들. 달력에 표시합니다.
export function visitDates(items) {
  return new Set(items.map((x) => x.visitDate).filter(Boolean));
}

// 지역 칸이 비어 있으면 주소에서 읽습니다.
export function regionOf(item) {
  return item.region || regionFromAddress(item.address);
}

const byVisitThenNewest = (a, b) => String(b.visitDate || '').localeCompare(String(a.visitDate || ''))
  || String(b.createdAt).localeCompare(String(a.createdAt));

function collect(items, keyOf) {
  const map = new Map();
  for (const item of [...items].sort(byVisitThenNewest)) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// 임장 날짜별: order 'new' 최신순 | 'old' 오래된순. 임장일이 없는 매물은 늘 맨 끝에 묶습니다.
// date를 주면 그날 매물만 돌려줍니다.
export function groupByVisitDate(items, { order = 'new', date = null } = {}) {
  const map = collect(items, (x) => x.visitDate || '');
  if (date) return map.has(date) ? [{ title: formatVisitDate(date) || date, items: map.get(date) }] : [];
  const keys = [...map.keys()].filter(Boolean).sort((a, b) => (order === 'old' ? a.localeCompare(b) : b.localeCompare(a)));
  const groups = keys.map((k) => ({ title: formatVisitDate(k) || k, items: map.get(k) }));
  if (map.has('')) groups.push({ title: '임장일 없음', items: map.get('') });
  return groups;
}

// 지역별: 가나다순으로, 지역을 모르는 매물은 맨 끝에 묶습니다.
export function groupByRegion(items) {
  const map = collect(items, regionOf);
  const keys = [...map.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  const groups = keys.map((k) => ({ title: k, items: map.get(k) }));
  if (map.has('')) groups.push({ title: '지역 없음', items: map.get('') });
  return groups;
}

// 이름 줄 오른쪽 끝에 붙는 글씨. 지역별 보기에서는 묶음 제목이 지역이니 임장 날짜를 보여 줍니다.
export function sideLabel(item, { view = 'date' } = {}) {
  if (view === 'region') return shortVisitDate(item.visitDate);
  return regionOf(item);
}

// 이름 아래 회색 글씨. 오른쪽 끝이나 묶음 제목과 겹치는 정보는 뺍니다.
export function summaryLine(item, { view = 'date' } = {}) {
  const parts = [];
  if (view === 'category' && item.visitDate) parts.push(formatVisitDate(item.visitDate));
  if (!isLocated(item)) parts.push('위치 없음');
  return parts.join(' · ');
}

// 목록에서 한눈에 비교할 금액들. 적은 것만 보여 줍니다.
export function listingFacts(item) {
  return [
    ['권리금', item.premium],
    ['보증금', item.deposit],
    ['월세', item.rent],
    ['예상 순수익', item.netProfit],
  ].filter(([, v]) => v).map(([label, v]) => ({ label, value: formatManwon(v) }));
}

export function fieldHint(kind, value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (kind === 'money' || kind === 'money-or-new') {
    const text = formatManwon(v);
    return text === v ? '' : text;
  }
  if (kind === 'area') {
    const py = toPyeong(v);
    return py ? `약 ${py}평` : '';
  }
  return '';
}

// 상세 화면: 입력한 칸만 묶음별로 보여 줍니다.
export function detailGroups(item) {
  const fields = (g) => (g.title === '기본' ? [...g.fields, { key: 'address', label: '주소' }, { key: 'locationMemo', label: '상세 위치' }] : g.fields);
  return FIELD_GROUPS.map((g) => ({
    title: g.title,
    rows: fields(g)
      .filter((f) => f.key !== 'name' && item[f.key])
      .map((f) => {
        const v = item[f.key];
        if (f.kind === 'money' || f.kind === 'money-or-new') return { label: f.label, value: formatManwon(v), strong: true };
        if (f.kind === 'area') {
          const py = toPyeong(v);
          return { label: f.label, value: py ? `${v}㎡ (약 ${py}평)` : v };
        }
        return { label: f.label, value: v, long: f.kind === 'long' };
      }),
  })).filter((g) => g.rows.length > 0);
}

// 주소에서 시·구까지를 지역으로 씁니다.
// 예: '서울 중구 가짜대로 1' → '서울 중구', '경기 성남시 중원구 가짜동 3' → '경기 성남시 중원구'
export function regionFromAddress(address) {
  const w = String(address ?? '').trim().split(/\s+/);
  const n = /시$/.test(w[1] || '') && /구$/.test(w[2] || '') ? 3 : 2;
  return w.slice(0, n).join(' ');
}

// 저장 묶음. 읽기에 실패하면 쓰지 않습니다. 읽지 못한 데이터를 빈 목록으로 덮어쓰면 모두 잃기 때문입니다.
export function createListingStore(store, key = LISTINGS_KEY) {
  let blocked = null;
  return {
    load() {
      const r = store.read(key);
      if (!r.ok) {
        blocked = r.reason;
        return r;
      }
      blocked = null;
      return { ok: true, items: Array.isArray(r.data?.items) ? r.data.items : [] };
    },
    // 사용자가 확인하고 백업 파일로 교체할 때만 씁니다. 읽지 못하던 값은 그때 덮입니다.
    unblock() {
      blocked = null;
    },
    save(items) {
      if (blocked) return { ok: false, reason: 'blocked', detail: blocked };
      return store.write(key, { items });
    },
  };
}
