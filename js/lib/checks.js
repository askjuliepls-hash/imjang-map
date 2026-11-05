// 연결 점검의 판정 규칙입니다. 화면과 무관한 순수 함수라 자동 테스트로 확인합니다.

// 실패해도 넘어가는 행입니다. 다시 할 곳이 지도 위에 있어서 카드가 붙잡고 있을 필요가 없어요.
const SKIP_ON_FAIL = new Set(['map', 'search', 'gps']);

// 지금 무엇을 안내할지 고릅니다.
// 돌려주는 값: { kind: 'row', id } | { kind: 'done' } | { kind: 'failed' }
export function nextStep(ids, states) {
  if (ids.includes('standalone') && states.standalone !== 'ok') return { kind: 'row', id: 'standalone' };
  for (const id of ids) {
    const state = states[id];
    if (state === 'ok') continue;
    if (state === 'fail' && SKIP_ON_FAIL.has(id)) continue;
    if (id === 'search' && states.map === 'fail') continue;
    if (id === 'export' && state === 'half') continue; // 내보낸 뒤에는 가져오기로 넘어갑니다.
    return { kind: 'row', id };
  }
  return ids.every((id) => states[id] === 'ok') ? { kind: 'done' } : { kind: 'failed' };
}

// 다시 열었을 때 이어서 보여 줄 결과를 고릅니다.
// 진행 중(half)을 되살리면 요청도 없이 '찾는 중'에 갇히므로 끝난 결과만 씁니다.
// 내보내기의 half는 '내보낸 뒤 가져오기를 기다리는 중'이라 예외입니다.
const RESTORABLE = { search: ['ok', 'fail'], gps: ['ok', 'fail'], export: ['half', 'ok'], import: ['ok'] };

export function restoreResults(record, { version, isApp }) {
  if (!isApp || !record) return { results: {}, versionChanged: false };
  if (record.version !== version) return { results: {}, versionChanged: true };
  const results = {};
  for (const [id, allowed] of Object.entries(RESTORABLE)) {
    const r = record.results?.[id];
    if (r && allowed.includes(r.state)) results[id] = r;
  }
  return { results, versionChanged: false };
}

// 저장 유지 판정. 다시 불러오기 표시가 있는 로드는 통과에 세지 않고, 표시 없이 열린 로드에서 통과합니다.
// 완전 종료를 코드로 증명할 방법은 없어서, 다시 열 때의 nav type을 진단 줄에 남깁니다.
export function evaluatePersist(test, navType) {
  if (!test) return { test: null, state: 'wait', phase: 'none' };
  if (test.reopenSeen) return { test, state: 'ok', phase: 'reopened' };
  if (test.expectReload) return { test: { ...test, expectReload: false }, state: 'half', phase: 'reloaded' };
  return { test: { ...test, reopenSeen: true, reopenNav: navType }, state: 'ok', phase: 'reopened' };
}
