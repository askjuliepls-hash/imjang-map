// 장소 검색 결과를 쓰기 좋게 정리합니다. 카카오 응답을 받아 순서만 정하는 순수 함수입니다.

function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

// 찾는 말의 낱말이 이름이나 주소에 모두 들어 있으면 맞는 결과로 칩니다. 예: '성남 가짜약국'
function matches(place, words) {
  const hay = `${place.place_name} ${place.address_name} ${place.road_address_name}`.replace(/\s+/g, ' ');
  return words.every((w) => hay.includes(w));
}

// 겹친 결과를 없애고 지도 중심에 가까운 순으로 정렬합니다.
// 근처 검색은 이름이 비슷하기만 한 약국도 돌려주므로, 찾는 말이 맞는 결과가 있으면 그것만 보여 줍니다.
export function rankPlaces(places, query, center) {
  const words = String(query ?? '').trim().split(/\s+/).filter(Boolean);
  const seen = new Set();
  const ranked = [];
  for (const p of places) {
    const key = p.id || `${p.place_name}|${p.x}|${p.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const distance = center ? distanceMeters(center, { lat: Number(p.y), lng: Number(p.x) }) : NaN;
    ranked.push({ ...p, distance, matched: matches(p, words) });
  }
  const hits = ranked.filter((p) => p.matched);
  const list = hits.length > 0 ? hits : ranked;
  list.sort((a, b) => (Number.isFinite(a.distance) && Number.isFinite(b.distance) ? a.distance - b.distance : 0));
  return list;
}
