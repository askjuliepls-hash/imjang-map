// 약국 임장노트 — 1단계 연결 점검: 홈 화면 앱·카카오 지도·장소 검색·현재 위치·이 기기 저장·백업 파일이
// 실제 기기에서 작동하는지 '연결 점검' 목록으로 보여줍니다. 2단계에서 매물 화면으로 바뀌며 빠지는 화면입니다.
import { KAKAO_JS_KEY } from './config.js';
import { isStandalone, openPlace, isAppleMobile } from './lib/device.js';
import { evaluatePersist, nextStep, restoreResults } from './lib/checks.js';
import { createStore } from './lib/store.js';
import { formatWhen } from './lib/format.js';
import { buildTestBackup, chooseExportPath, readBackupFile } from './lib/backup.js';
import {
  kakaoLoadMessage, geoErrorMessage, standaloneHelp, kakaoInappMessage,
  persistMessage, storeErrorMessage, exportHelp, exportFailMessage, importHelp, importErrorMessage, NOT_APP_YET,
} from './lib/messages.js';

const VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 부근
const WAIT_MS = 15000;
const RECORD = 'check'; // 저장 키 이름

const $ = (id) => document.getElementById(id);

const STANDALONE = isStandalone(window.navigator, window.matchMedia?.bind(window));
const PLACE = openPlace(navigator.userAgent, navigator.maxTouchPoints || 0, STANDALONE);
const store = createStore(() => window.localStorage);

// ---------- 연결 점검 ----------
const STATE_WORD = { wait: '대기', half: '진행 중', ok: '통과', fail: '실패' };
const NAMES = {
  standalone: '홈 화면 앱으로 열림',
  map: '지도',
  search: '장소 검색',
  gps: '내 위치',
  persist: '이 기기에 저장 후 유지',
  export: '백업 파일 내보내기',
  import: '백업 파일 가져오기',
};
const APPLE = isAppleMobile(navigator.userAgent, navigator.maxTouchPoints || 0);
const CHECK_IDS = Object.keys(NAMES);
const WAIT_HELP = {
  map: '지도를 불러오는 중이에요.',
  search: '지도 위 검색창에 아무 장소나 검색해 보세요.',
  gps: "지도 오른쪽 아래 '내 위치'를 눌러 보세요. 권한을 물으면 허용해 주세요.",
  persist: persistMessage('none'),
  export: exportHelp(APPLE),
  import: importHelp(),
};
const DONE_HELP = '이 화면을 캡처해서 Claude에게 보내 주세요.';
const FAILED_HELP = '빨간 표시의 안내를 확인하고, 안 되면 캡처를 Claude에게 보내 주세요.';
const SAVED_IDS = ['search', 'gps', 'export', 'import'];

const checks = Object.fromEntries(CHECK_IDS.map((id) => [id, 'wait']));
const messages = {};
// 앱을 닫았다 열어도 이어지는 기록입니다. 버전이 바뀌면 통째로 무시합니다.
let record = { version: VERSION, test: null, backup: null, results: {} };
let exportVia = '-';
let reopenNav = '-';
let persisted = '-';
let shareRefused = 0;

function setRow(id, state, msg) {
  checks[id] = state;
  if (msg) messages[id] = msg;
  const li = document.querySelector(`[data-check="${id}"]`);
  if (!li) return;
  li.dataset.state = state;
  li.querySelector('.state').textContent = STATE_WORD[state];
  if (msg) li.querySelector('.msg').textContent = msg;
}

// 결과 안내는 화면 밖 목록이 아니라 카드 맨 위에 보여 줍니다.
function announce(text, tone) {
  const el = $('nextMsg');
  el.dataset.tone = tone;
  el.textContent = text;
  el.hidden = false;
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
}

function saveRecord() {
  if (PLACE !== 'app') return { ok: true }; // 앱으로 열렸을 때만 기록합니다. Safari에 쓴 것은 아이콘에서 안 보여요.
  return store.write(RECORD, record);
}

function saveResults() {
  const results = {};
  for (const id of SAVED_IDS) {
    if (checks[id] === 'wait') continue;
    results[id] = { state: checks[id], msg: messages[id] };
    if (id === 'export') results[id].via = exportVia;
  }
  record.results = results;
  saveRecord();
}

function setCheck(id, state, msg) {
  setRow(id, state, msg);
  if (msg && (state === 'ok' || state === 'fail')) {
    announce(`${NAMES[id]}: ${msg}`, state === 'ok' ? 'ok' : 'fail');
  }
  if (SAVED_IDS.includes(id)) saveResults();
  render();
}

function helpFor(id) {
  if (id === 'standalone') return PLACE === 'kakao' ? messages.standalone : standaloneHelp(PLACE);
  if (checks[id] === 'half' && id !== 'import') return messages[id];
  return WAIT_HELP[id];
}

// 카드의 버튼: 큰 버튼은 많아야 하나이고, 나머지는 작게 둡니다.
function placeButtons(step) {
  const big = [];
  const small = [];
  if (PLACE === 'app') {
    const id = step.kind === 'row' ? step.id : null;
    if (id === 'persist') {
      if (checks.persist !== 'half') big.push('saveBtn');
      if (checks.persist === 'fail') small.push('exportBtn', 'importLabel', 'downloadBtn'); // 저장이 막혀도 백업은 됩니다.
    } else if (id === 'export') {
      big.push('exportBtn');
      small.push('importLabel', 'downloadBtn'); // 카톡이 취소로 보고해도 파일이 왔으면 바로 가져올 수 있게
    } else if (id === 'import') {
      big.push('importLabel');
      small.push('exportBtn', 'downloadBtn');
    } else if (step.kind !== 'row' && checks.export !== 'wait') {
      small.push('exportBtn', 'importLabel', 'downloadBtn');
    }
  }
  const alts = $('alts');
  for (const id of ['saveBtn', 'exportBtn', 'importLabel', 'downloadBtn']) {
    const el = $(id);
    el.hidden = !big.includes(id) && !small.includes(id);
    if (big.includes(id)) {
      el.className = 'btn primary';
      alts.before(el);
    } else if (small.includes(id)) {
      el.className = 'text-btn';
      alts.append(el);
    }
  }
  alts.hidden = small.length === 0;
}

function render() {
  const total = CHECK_IDS.length;
  const passed = CHECK_IDS.filter((c) => checks[c] === 'ok').length;
  const done = passed === total;
  $('score').textContent = done ? `${total}개 모두 통과` : `${total}개 중 ${passed}개 통과`;
  $('score').dataset.done = String(done);
  $('lead').textContent = `${total}개가 모두 통과하면 연결 확인이 끝나요.`;

  const step = nextStep(CHECK_IDS, checks);
  if (step.kind === 'done') {
    $('nextTitle').textContent = `${total}개 모두 통과했어요`;
    $('nextHelp').textContent = DONE_HELP;
  } else if (step.kind === 'failed') {
    $('nextTitle').textContent = '실패한 점검이 있어요';
    $('nextHelp').textContent = FAILED_HELP;
  } else {
    $('nextTitle').textContent = NAMES[step.id];
    $('nextHelp').textContent = helpFor(step.id);
  }
  placeButtons(step);
  $('next').hidden = false;
  updateDiag();
}

// ---------- 진단 줄: 폰에서만 알 수 있는 값을 캡처로 받는 통로 ----------
let safeProbe = null;

function safeArea() {
  if (!safeProbe) {
    safeProbe = document.createElement('div');
    safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.append(safeProbe);
  }
  const cs = getComputedStyle(safeProbe);
  return `${parseFloat(cs.paddingTop) || 0}/${parseFloat(cs.paddingBottom) || 0}`;
}

function updateDiag() {
  const media = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || '-';
  const rec = store.read(RECORD);
  const parts = [
    PLACE,
    `standalone ${String(window.navigator.standalone)}`,
    `display-mode ${String(media)}`,
    `${window.innerWidth}×${window.innerHeight}`,
    `screen ${window.screen?.height}`,
    `안전영역 위/아래 ${safeArea()}`,
    `문서 ${document.documentElement.scrollHeight}`,
    `nav ${nav}`,
    `다시 열기 nav ${reopenNav}`,
    `persisted ${persisted}`,
    `내보내기 경로 ${exportVia}`,
    `기록 ${rec.ok ? (rec.data ? '있음' : '없음') : rec.reason}`,
  ];
  // 앱 밖에서는 판별이 맞았는지 볼 수 있게 원본 값을 덧붙입니다.
  if (PLACE !== 'app') parts.push(navigator.userAgent);
  $('diag').textContent = parts.join(' · ');
}

// ---------- 지도 ----------
let kakao = null;
let map = null;
let searchMarker = null;
let meOverlay = null;

function showMapMessage(title, detail) {
  const box = $('mapMsg');
  const t = document.createElement('strong');
  t.textContent = title;
  const d = document.createElement('span');
  d.textContent = detail;
  box.replaceChildren(t, d);
  box.hidden = false;
}

function setSearchEnabled(on) {
  $('q').disabled = !on;
  $('searchBtn').disabled = !on;
}

function loadKakaoSdk(key) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), WAIT_MS);
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('load-failed'));
    };
    s.onload = () => {
      const k = window.kakao;
      if (!k || !k.maps || typeof k.maps.load !== 'function') {
        clearTimeout(timer);
        reject(new Error('sdk-missing'));
        return;
      }
      k.maps.load(() => {
        clearTimeout(timer);
        resolve(k);
      });
    };
    document.head.append(s);
  });
}

function mapFailedBeforeDrawing(message, title, detail) {
  setRow('search', 'wait', '지도가 먼저 떠야 검색할 수 있어요.');
  setCheck('map', 'fail', message);
  showMapMessage(title, detail);
  setSearchEnabled(false);
}

async function initMap() {
  if (!KAKAO_JS_KEY) {
    mapFailedBeforeDrawing(kakaoLoadMessage('no-key'), '지도 준비 전이에요', '카카오 키를 넣으면 여기에 지도가 보여요.');
    return;
  }
  try {
    kakao = await loadKakaoSdk(KAKAO_JS_KEY);
  } catch (err) {
    mapFailedBeforeDrawing(kakaoLoadMessage(err.message, location.origin), '지도를 불러오지 못했어요', '아래 연결 점검의 안내를 확인해 주세요.');
    return;
  }
  map = new kakao.maps.Map($('map'), {
    center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
    level: 5,
  });
  let drawn = false;
  kakao.maps.event.addListener(map, 'tilesloaded', () => {
    if (drawn) return;
    drawn = true;
    $('mapMsg').hidden = true; // 시간 초과 뒤에 늦게 떠도 안내를 걷습니다.
    // 지도가 뜬 것은 눈에 보이니 결과 줄을 쓰지 않습니다. 새 버전 안내를 덮지 않으려는 뜻도 있어요.
    setRow('map', 'ok', '카카오 지도가 떴어요.');
    render();
  });
  kakao.maps.event.addListener(map, 'click', () => {
    $('results').hidden = true;
  });
  setTimeout(() => {
    if (drawn) return;
    setCheck('map', 'fail', kakaoLoadMessage('tiles-timeout'));
    showMapMessage('지도 그림이 안 떴어요', '아래 연결 점검의 안내를 확인해 주세요.');
  }, WAIT_MS);
}

function renderResults(items) {
  const ul = $('results');
  ul.replaceChildren();
  for (const p of items) {
    const b = document.createElement('button');
    b.type = 'button';
    const name = document.createElement('strong');
    name.textContent = p.place_name;
    const addr = document.createElement('span');
    addr.textContent = p.road_address_name || p.address_name || '';
    b.append(name, addr);
    b.addEventListener('click', () => {
      const pos = new kakao.maps.LatLng(Number(p.y), Number(p.x));
      map.setLevel(3);
      map.panTo(pos);
      if (searchMarker) {
        searchMarker.setPosition(pos);
        searchMarker.setMap(map);
      } else {
        searchMarker = new kakao.maps.Marker({ map, position: pos });
      }
      ul.hidden = true;
    });
    const li = document.createElement('li');
    li.append(b);
    ul.append(li);
  }
  ul.hidden = items.length === 0;
}

function onSearch(ev) {
  ev.preventDefault();
  const q = $('q').value.trim();
  if (!q || !kakao) return;
  $('q').blur(); // 아이폰 키보드를 내려 결과가 보이게
  const places = new kakao.maps.services.Places();
  const S = kakao.maps.services.Status;
  places.keywordSearch(q, (data, status, pagination) => {
    if (status === S.OK) {
      renderResults(data.slice(0, 5));
      const total = pagination?.totalCount ?? data.length;
      setCheck('search', 'ok', `'${q}' 결과 ${total}건을 받았어요.`);
    } else if (status === S.ZERO_RESULT) {
      renderResults([]);
      setCheck('search', 'ok', `검색은 작동해요. '${q}' 결과는 없어요.`);
    } else {
      renderResults([]);
      setCheck('search', 'fail', '검색 요청이 실패했어요. 카카오맵 사용 설정과 도메인 등록을 확인해 주세요.');
    }
  }, { size: 5 });
}

function placeMe(ll) {
  if (meOverlay) {
    meOverlay.setPosition(ll);
    return;
  }
  const dot = document.createElement('div');
  dot.className = 'me-dot';
  dot.setAttribute('aria-label', '내 위치');
  meOverlay = new kakao.maps.CustomOverlay({ position: ll, content: dot, map });
}

// 위치 확인은 지도와 따로 동작합니다. 지도가 없어도 위치 권한·정확도는 점검됩니다.
function onLocate() {
  if (!('geolocation' in navigator)) {
    setCheck('gps', 'fail', '이 브라우저는 위치 기능을 지원하지 않아요.');
    return;
  }
  setCheck('gps', 'half', '위치를 찾는 중이에요. 권한을 물으면 허용해 주세요.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setCheck('gps', 'ok', `현재 위치를 찾았어요. 오차 약 ${Math.round(accuracy)}m.`);
      if (map) {
        const ll = new kakao.maps.LatLng(latitude, longitude);
        map.setLevel(3);
        map.panTo(ll);
        placeMe(ll);
      }
    },
    (err) => setCheck('gps', 'fail', geoErrorMessage(err.code)),
    { enableHighAccuracy: true, timeout: WAIT_MS, maximumAge: 0 },
  );
}

// ---------- 이 기기에 저장 ----------
function makeCode() {
  const n = new Uint16Array(1);
  crypto.getRandomValues(n);
  return String(1000 + (n[0] % 9000));
}

function onSaveTest() {
  // 결과는 기다리지 않습니다. 사파리에서 사용자에게 뜨는 창도 없어요.
  try {
    navigator.storage?.persist?.()?.catch?.(() => {});
  } catch { /* 없어도 저장은 됩니다 */ }
  const test = { code: makeCode(), savedAt: new Date().toISOString(), expectReload: false, reopenSeen: false, reopenNav: null };
  record.test = test;
  const r = saveRecord();
  if (!r.ok) {
    record.test = null;
    setCheck('persist', 'fail', storeErrorMessage(r.reason, r.detail));
    return;
  }
  setRow('persist', 'half', persistMessage('saved', test.code));
  announce(`코드 ${test.code}을 적어 두세요.`, 'info');
  render();
}

// 다시 불러오기 버튼(일반 script)이 reload 직전에 부릅니다.
window.__beforeReload = () => {
  if (record.test && !record.test.reopenSeen) {
    record.test.expectReload = true;
    saveRecord();
  }
};

function applyPersist() {
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || '-';
  const before = record.test;
  const r = evaluatePersist(before, nav);
  record.test = r.test;
  if (r.test?.reopenNav) reopenNav = r.test.reopenNav;
  const when = r.test ? formatWhen(new Date(r.test.savedAt), new Date()) : '';
  setRow('persist', r.state, persistMessage(r.phase, r.test?.code, when));
  if (r.test === before) return; // 바뀐 게 없으면 쓰지 않습니다.
  if (r.phase === 'reopened') announce(`${NAMES.persist}: ${messages.persist}`, 'ok');
  saveRecord();
}

// ---------- 백업 파일 ----------
function makeNonce() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function exported(via) {
  exportVia = via;
  if (checks.export === 'ok') {
    saveResults();
    announce('내보냈어요.', 'info');
    render();
    return;
  }
  setRow('export', 'half', "내보냈어요. '가져오기'에서 그 파일을 고르면 확인이 끝나요.");
  saveResults();
  announce(messages.export, 'info');
  render();
}

function exportFailed(name) {
  const msg = exportFailMessage(name);
  if (checks.export === 'ok') { // 이미 통과했으면 내리지 않습니다.
    announce(msg, 'info');
    return;
  }
  setCheck('export', 'fail', msg);
}

function downloadFile(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  exported('download');
}

// 공유 창은 눌렀을 때 바로 열어야 해서, 이 함수 안에서는 기다리는 일을 하지 않습니다.
function onExport(forceDownload = false) {
  try {
    if (!record.backup) record.backup = { nonce: makeNonce() };
    saveRecord(); // 공유 창이 페이지를 다시 읽어도 파일과 맞춰 볼 수 있게 먼저 저장합니다.
    const { fileName, text } = buildTestBackup({ nonce: record.backup.nonce, now: new Date() });
    if (forceDownload) {
      downloadFile(text, fileName);
      return;
    }
    const file = new File([text], fileName, { type: 'application/json' });
    let canShare = false;
    try {
      canShare = !!navigator.canShare?.({ files: [file] });
    } catch { /* 못 하는 것으로 칩니다 */ }
    if (chooseExportPath({ apple: APPLE, isApp: PLACE === 'app', canShare }) === 'download') {
      downloadFile(text, fileName);
      return;
    }
    navigator.share({ files: [file] }).then(() => exported('share')).catch((e) => {
      const name = e?.name || String(e);
      if (name === 'AbortError') { // 이 이름은 파일 읽기 실패에도 쓰여서 '취소'로 단정하지 않습니다.
        announce('공유 창이 닫혔어요. 다시 누르면 돼요.', 'info');
      } else if (name === 'NotAllowedError' && shareRefused === 0) {
        shareRefused += 1;
        announce('한 번 더 눌러 주세요.', 'info');
      } else if (name === 'InvalidStateError') {
        announce('공유 창이 안 보이면 앱을 닫았다 다시 열어 주세요.', 'info');
      } else {
        exportFailed(name);
      }
    });
  } catch (e) {
    exportFailed(e?.name || String(e));
  }
}

async function onImportPicked(ev) {
  const input = ev.target;
  try {
    const file = input.files?.[0];
    if (!file) return;
    const r = await readBackupFile(file, { nonce: record.backup?.nonce });
    const stamp = new Date().toTimeString().slice(0, 8);
    if (r.ok) {
      const msg = `${file.name}을 ${stamp}에 읽어 확인했어요. 글자까지 모두 같아요.`;
      setRow('export', 'ok', '내보낸 파일을 다시 읽어 확인했어요.');
      setCheck('import', 'ok', msg);
      return;
    }
    const msg = importErrorMessage(r.reason, r.detail);
    if (checks.import === 'ok') { // 이미 통과했으면 내리지 않고 무엇을 골랐는지만 알립니다.
      announce(`${file.name} (${stamp}): ${msg}`, 'info');
    } else if (r.reason === 'not-this-run') {
      setRow('import', 'half', msg);
      saveResults();
      announce(msg, 'info');
      render();
    } else {
      setCheck('import', 'fail', msg);
    }
  } catch (e) {
    setCheck('import', 'fail', importErrorMessage('read-failed', e?.name || String(e)));
  } finally {
    input.value = ''; // 같은 파일을 다시 고를 수 있게 비웁니다.
  }
}

// ---------- 시트 접기 ----------
function onToggleSheet() {
  const sheet = $('sheet');
  const collapsed = sheet.dataset.collapsed !== 'true';
  sheet.dataset.collapsed = String(collapsed);
  $('sheetToggle').setAttribute('aria-expanded', String(!collapsed));
  requestAnimationFrame(() => map?.relayout());
}

// ---------- 시작 ----------
function restore() {
  if (PLACE === 'app') {
    setRow('standalone', 'ok', '홈 화면 앱으로 열렸어요.');
  } else if (PLACE === 'kakao') {
    setRow('standalone', 'fail', kakaoInappMessage(navigator.userAgent));
  }
  if (PLACE !== 'app') {
    for (const id of ['persist', 'export', 'import']) setRow(id, 'wait', NOT_APP_YET);
    return;
  }
  const rec = store.read(RECORD);
  if (!rec.ok) {
    setRow('persist', 'fail', storeErrorMessage(rec.reason, rec.detail));
    announce(`${NAMES.persist}: ${messages.persist}`, 'fail');
    return; // 깨진 값은 지우지 않습니다. 이번 회차는 메모리로 동작해요.
  }
  const { results, versionChanged } = restoreResults(rec.data, { version: VERSION, isApp: true });
  for (const [id, r] of Object.entries(results)) {
    setRow(id, r.state, r.msg);
    if (id === 'export' && r.via) exportVia = r.via;
  }
  if (versionChanged) {
    saveRecord(); // 옛 기록을 지금 버전으로 바꿔 둡니다.
  } else if (rec.data) {
    record = { ...record, ...rec.data, results: rec.data.results || {} };
  }
  applyPersist();
  if (versionChanged) announce('새 버전이라 처음부터 다시 확인해요.', 'info');
  navigator.storage?.persisted?.().then((v) => {
    persisted = String(v);
    updateDiag();
  }).catch(() => {});
}

$('ver').textContent = VERSION;
$('searchForm').addEventListener('submit', onSearch);
$('locate').addEventListener('click', onLocate);
$('sheetToggle').addEventListener('click', onToggleSheet);
$('saveBtn').addEventListener('click', onSaveTest);
$('exportBtn').addEventListener('click', () => onExport());
$('downloadBtn').addEventListener('click', () => onExport(true));
$('importFile').addEventListener('change', onImportPicked);
window.addEventListener('resize', () => {
  map?.relayout();
  updateDiag();
});

restore();
render();
initMap();

window.__appStarted = true;
window.__onAppStarted?.();
