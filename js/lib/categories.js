// 사용자가 직접 만드는 '내 분류'의 규칙입니다. 이름과 핀 색을 정하고, 매물 하나에 하나씩 넣습니다.

export const PALETTE = [
  { color: '#F96949', name: '주황' },
  { color: '#3F82D9', name: '파랑' },
  { color: '#3E9B62', name: '초록' },
  { color: '#8A63D2', name: '보라' },
  { color: '#E0A020', name: '노랑' },
  { color: '#E0619B', name: '분홍' },
  { color: '#5F6B7A', name: '진회색' },
];
export const NO_CATEGORY_COLOR = '#A9B2BC';
export const MAX_NAME = 20;

// 이름을 다듬고 검사합니다. 돌려주는 값: { ok: true, name } | { ok: false, reason: 'empty' | 'long' | 'same' }
export function checkName(list, raw, selfId = null) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > MAX_NAME) return { ok: false, reason: 'long' };
  if (list.some((c) => c.id !== selfId && c.name === name)) return { ok: false, reason: 'same' };
  return { ok: true, name };
}

export function upsertCategory(list, { id, name, color }, newId) {
  if (id && list.some((c) => c.id === id)) return list.map((c) => (c.id === id ? { ...c, name, color } : c));
  return [...list, { id: newId, name, color }];
}

export function removeCategory(list, id) {
  return list.filter((c) => c.id !== id);
}

// 분류를 지워도 매물은 남고 '분류 없음'이 됩니다.
export function clearCategoryFrom(items, id) {
  return items.map((x) => (x.categoryId === id ? { ...x, categoryId: null } : x));
}

export function categoryOf(item, list) {
  return list.find((c) => c.id === item.categoryId) || null;
}

export function pinColor(item, list) {
  return categoryOf(item, list)?.color || NO_CATEGORY_COLOR;
}

// 다음에 고를 색: 아직 안 쓴 색을 먼저 권합니다.
export function nextColor(list) {
  const used = new Set(list.map((c) => c.color));
  return (PALETTE.find((p) => !used.has(p.color)) || PALETTE[0]).color;
}

// 지도 거르기. filter: null(전체) | 'none'(분류 없음) | 분류 id
export function matchesFilter(item, list, filter) {
  if (!filter) return true;
  const cat = categoryOf(item, list);
  return filter === 'none' ? !cat : cat?.id === filter;
}

// 분류별 보기: 만든 순서대로, 매물이 없는 분류는 빼고, 분류 없음은 맨 끝에 묶습니다.
export function groupByCategory(items, list) {
  const groups = [];
  for (const c of list) {
    const inside = items.filter((x) => categoryOf(x, list)?.id === c.id);
    if (inside.length > 0) groups.push({ title: c.name, color: c.color, items: inside });
  }
  const rest = items.filter((x) => !categoryOf(x, list));
  if (rest.length > 0) groups.push({ title: '분류 없음', color: NO_CATEGORY_COLOR, items: rest });
  return groups;
}

// 지도 핀 그림
export function pinImageUrl(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 1C7.7 1 1 7.6 1 15.800c0 10.600 13.300 22.200 13.900 22.700.6.500 1.600.500 2.200 0C17.700 38 31 26.400 31 15.800 31 7.600 24.300 1 16 1z" fill="${color}" stroke="#ffffff" stroke-width="2"/><circle cx="16" cy="15.500" r="5" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
