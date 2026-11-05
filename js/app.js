// 약국 임장노트 — 1단계 연결 점검: 카카오 지도·장소 검색·현재 위치가
// 실제 기기에서 작동하는지 '연결 점검' 목록으로 보여줍니다.
import { KAKAO_JS_KEY } from './config.js';
import { kakaoLoadMessage, geoErrorMessage } from './lib/messages.js';

const VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 부근
const WAIT_MS = 15000;

const $ = (id) => document.getElementById(id);

// ---------- 연결 점검 ----------
const STATE_WORD = { wait: '대기', half: '진행 중', ok: '통과', fail: '실패' };
const CHECK_IDS = ['map', 'search', 'gps'];
const checks = Object.fromEntries(CHECK_IDS.map((id) => [id, 'wait']));

function setCheck(id, state, msg) {
  checks[id] = state;
  const li = document.querySelector(`[data-check="${id}"]`);
  if (li) {
    li.dataset.state = state;
    li.querySelector('.state').textContent = STATE_WORD[state];
    if (msg) li.querySelector('.msg').textContent = msg;
  }
  const passed = CHECK_IDS.filter((c) => checks[c] === 'ok').length;
  const total = CHECK_IDS.length;
  const done = passed === total;
  $('score').textContent = done ? `${total}개 모두 통과` : `${total}개 중 ${passed}개 통과`;
  $('score').dataset.done = String(done);
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

async function initMap() {
  if (!KAKAO_JS_KEY) {
    setCheck('map', 'fail', kakaoLoadMessage('no-key'));
    setCheck('search', 'wait', '지도가 먼저 떠야 검색할 수 있어요.');
    showMapMessage('지도 준비 전이에요', '카카오 키를 넣으면 여기에 지도가 보여요.');
    setSearchEnabled(false);
    return;
  }
  try {
    kakao = await loadKakaoSdk(KAKAO_JS_KEY);
  } catch (err) {
    setCheck('map', 'fail', kakaoLoadMessage(err.message, location.origin));
    setCheck('search', 'wait', '지도가 먼저 떠야 검색할 수 있어요.');
    showMapMessage('지도를 불러오지 못했어요', '아래 연결 점검의 안내를 확인해 주세요.');
    setSearchEnabled(false);
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
    setCheck('map', 'ok', '카카오 지도가 떴어요.');
  });
  kakao.maps.event.addListener(map, 'click', () => {
    $('results').hidden = true;
  });
  setTimeout(() => {
    if (!drawn) setCheck('map', 'fail', kakaoLoadMessage('tiles-timeout'));
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
$('ver').textContent = VERSION;
$('searchForm').addEventListener('submit', onSearch);
$('locate').addEventListener('click', onLocate);
$('sheetToggle').addEventListener('click', onToggleSheet);
window.addEventListener('resize', () => map?.relayout());

initMap();
