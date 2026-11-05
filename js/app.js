// 약국 임장노트 — 1단계 연결 점검: 홈 화면 앱·카카오 지도·장소 검색·현재 위치가
// 실제 기기에서 작동하는지 '연결 점검' 목록으로 보여줍니다.
import { KAKAO_JS_KEY } from './config.js';
import { isStandalone, openPlace } from './lib/device.js';
import { nextStep, restoreResults } from './lib/checks.js';
import { createStore } from './lib/store.js';
import {
  kakaoLoadMessage, geoErrorMessage, standaloneHelp, kakaoInappMessage,
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
const NAMES = { standalone: '홈 화면 앱으로 열림', map: '지도', search: '장소 검색', gps: '내 위치' };
const CHECK_IDS = Object.keys(NAMES);
const WAIT_HELP = {
  map: '지도를 불러오는 중이에요.',
  search: '지도 위 검색창에 아무 장소나 검색해 보세요.',
  gps: "지도 오른쪽 아래 '내 위치'를 눌러 보세요. 권한을 물으면 허용해 주세요.",
};
const DONE_HELP = '1부 확인이 끝났어요. 저장·백업 점검은 다음 버전에서 해요.';
const FAILED_HELP = '빨간 표시의 안내를 확인하고, 안 되면 캡처를 Claude에게 보내 주세요.';
const SAVED_IDS = ['search', 'gps'];

const checks = Object.fromEntries(CHECK_IDS.map((id) => [id, 'wait']));
const messages = {};

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

function saveResults() {
  if (PLACE !== 'app') return; // 앱으로 열렸을 때만 기록합니다. Safari에 쓴 것은 아이콘에서 안 보여요.
  const results = {};
  for (const id of SAVED_IDS) {
    if (checks[id] === 'ok' || checks[id] === 'fail') results[id] = { state: checks[id], msg: messages[id] };
  }
  store.write(RECORD, { version: VERSION, results });
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
  if (checks[id] === 'half') return messages[id];
  return WAIT_HELP[id];
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
  if (PLACE !== 'app') return;
  const rec = store.read(RECORD);
  const { results, versionChanged } = restoreResults(rec.ok ? rec.data : null, { version: VERSION, isApp: true });
  for (const [id, r] of Object.entries(results)) setRow(id, r.state, r.msg);
  if (versionChanged) {
    announce('새 버전이라 처음부터 다시 확인해요.', 'info');
    saveResults(); // 옛 기록을 지금 버전으로 바꿔 둡니다.
  }
}

$('ver').textContent = VERSION;
$('searchForm').addEventListener('submit', onSearch);
$('locate').addEventListener('click', onLocate);
$('sheetToggle').addEventListener('click', onToggleSheet);
window.addEventListener('resize', () => {
  map?.relayout();
  updateDiag();
});

restore();
render();
initMap();

window.__appStarted = true;
window.__onAppStarted?.();
