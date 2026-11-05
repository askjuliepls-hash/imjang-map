// 임장 지도 — 2단계 뼈대: 카카오 지도·장소 검색·현재 위치·로그인·저장이
// 실제 기기에서 작동하는지 '연결 점검' 목록으로 보여줍니다.
import { KAKAO_JS_KEY, FIREBASE_CONFIG } from './config.js';
import { deviceLabel } from './lib/device.js';
import { formatWhen } from './lib/format.js';
import {
  kakaoLoadMessage, firebaseLoadMessage, authErrorMessage, firestoreErrorMessage, geoErrorMessage,
} from './lib/messages.js';

const VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 부근
const WAIT_MS = 15000;
const THIS_DEVICE = deviceLabel(navigator.userAgent, navigator.maxTouchPoints || 0);
const SAVED_NOW_REFRESH = '저장했어요. 새로고침해서 그대로 남아 있는지 확인해 보세요.';

const $ = (id) => document.getElementById(id);

// ---------- 연결 점검 ----------
const STATE_WORD = { wait: '대기', half: '진행 중', ok: '통과', fail: '실패' };
const CHECK_IDS = ['map', 'search', 'gps', 'login', 'persist', 'sync'];
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

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.textContent = label;
}

// 버튼 바로 근처에 결과를 보여줍니다. tone: 'fail' | 'info' | 'ok'
function showFormMsg(id, tone, text) {
  const el = $(id);
  el.dataset.tone = tone;
  el.textContent = text;
  el.hidden = false;
  // 점검 시트 안에서 안내가 화면 밖이면 보이는 곳까지 스크롤합니다.
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
}

function hideFormMsg(id) {
  $(id).hidden = true;
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

// ---------- 로그인·저장 ----------
let fb = null;
let auth = null;
let db = null;
let stopPing = null;
let savedThisSession = false;
let sawServerSnapshot = false;

function setLoginEnabled(on) {
  for (const id of ['email', 'password', 'loginBtn']) $(id).disabled = !on;
}

async function initFirebase() {
  if (!FIREBASE_CONFIG) {
    setCheck('login', 'fail', firebaseLoadMessage('no-config'));
    setLoginEnabled(false);
    return;
  }
  try {
    fb = await import('../vendor/firebase.js');
  } catch {
    setCheck('login', 'fail', firebaseLoadMessage('load-failed'));
    setLoginEnabled(false);
    return;
  }
  const app = fb.initializeApp(FIREBASE_CONFIG);
  auth = fb.getAuth(app);
  db = fb.getFirestore(app);
  fb.onAuthStateChanged(auth, (user) => (user ? onSignedIn(user) : onSignedOut()));
}

async function onLogin(ev) {
  ev.preventDefault();
  if (!auth) return;
  document.activeElement?.blur?.(); // 아이폰 키보드를 내려 결과 안내가 가려지지 않게
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) {
    const msg = '이메일과 비밀번호를 모두 입력해 주세요.';
    showFormMsg('loginMsg', 'fail', msg);
    setCheck('login', 'fail', msg);
    return;
  }
  hideFormMsg('loginMsg');
  setBusy($('loginBtn'), true, '로그인하는 중…');
  try {
    await fb.signInWithEmailAndPassword(auth, email, password);
    $('password').value = '';
  } catch (err) {
    const msg = authErrorMessage(err.code);
    showFormMsg('loginMsg', 'fail', msg);
    setCheck('login', 'fail', msg);
  } finally {
    setBusy($('loginBtn'), false, '로그인하기');
  }
}

function onSignedIn(user) {
  hideFormMsg('loginMsg');
  $('who').textContent = user.email || '로그인됨';
  $('logoutBtn').hidden = false;
  $('loginForm').hidden = true;
  $('account').hidden = false;
  setCheck('login', 'ok', `${user.email} 계정으로 로그인했어요.`);
  watchPing(user.uid);
}

function onSignedOut() {
  if (stopPing) {
    stopPing();
    stopPing = null;
  }
  $('who').textContent = '로그인 전';
  $('logoutBtn').hidden = true;
  $('loginForm').hidden = false;
  $('account').hidden = true;
  $('lastSave').textContent = '';
  hideFormMsg('saveMsg');
  if (checks.login === 'ok') setCheck('login', 'wait', '로그아웃됐어요. 다시 로그인해 주세요.');
}

function pingRef(uid) {
  return fb.doc(db, 'users', uid, 'meta', 'ping');
}

function watchPing(uid) {
  if (stopPing) stopPing();
  sawServerSnapshot = false;
  stopPing = fb.onSnapshot(pingRef(uid), { includeMetadataChanges: true }, (snap) => {
    const fromServer = !snap.metadata.fromCache;
    const pending = snap.metadata.hasPendingWrites;
    const firstFromServer = fromServer && !sawServerSnapshot;
    if (fromServer) sawServerSnapshot = true;

    if (!snap.exists()) {
      $('lastSave').textContent = '저장 기록 없음';
      if (firstFromServer) setCheck('persist', 'wait', "아직 저장한 적이 없어요. '테스트 저장하기'를 눌러보세요.");
      return;
    }
    const d = snap.data({ serverTimestamps: 'estimate' });
    const when = d.savedAt && typeof d.savedAt.toDate === 'function' ? d.savedAt.toDate() : null;
    $('lastSave').textContent = `마지막 저장 · ${when ? formatWhen(when, new Date()) : '-'} · ${d.device || '알 수 없는 기기'}${pending ? ' · 보내는 중' : ''}`;
    if (pending) return;

    if (firstFromServer && !savedThisSession) {
      setCheck('persist', 'ok', '새로 연 화면에서 저장한 값을 불러왔어요.');
    } else if (savedThisSession && checks.persist !== 'ok') {
      setCheck('persist', 'half', SAVED_NOW_REFRESH);
    }
    if (d.device && d.device !== THIS_DEVICE) {
      setCheck('sync', 'ok', `${d.device}에서 저장한 값이 ${THIS_DEVICE}에서도 보여요.`);
    }
  }, (err) => {
    const msg = firestoreErrorMessage(err.code);
    showFormMsg('saveMsg', 'fail', msg);
    setCheck('persist', 'fail', msg);
  });
}

async function onSave() {
  const user = auth?.currentUser;
  if (!user) return;
  setBusy($('saveBtn'), true, '저장하는 중…');
  hideFormMsg('saveMsg');
  savedThisSession = true;
  try {
    await fb.setDoc(pingRef(user.uid), {
      savedAt: fb.serverTimestamp(),
      device: THIS_DEVICE,
      app: VERSION,
    });
    if (checks.persist === 'ok') {
      showFormMsg('saveMsg', 'ok', '저장했어요.');
    } else {
      showFormMsg('saveMsg', 'info', SAVED_NOW_REFRESH);
      setCheck('persist', 'half', SAVED_NOW_REFRESH);
    }
  } catch (err) {
    const msg = firestoreErrorMessage(err.code);
    showFormMsg('saveMsg', 'fail', msg);
    setCheck('persist', 'fail', msg);
  } finally {
    setBusy($('saveBtn'), false, '테스트 저장하기');
  }
}

async function onLogout() {
  if (auth) await fb.signOut(auth);
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
$('loginForm').addEventListener('submit', onLogin);
$('saveBtn').addEventListener('click', onSave);
$('logoutBtn').addEventListener('click', onLogout);
$('sheetToggle').addEventListener('click', onToggleSheet);
window.addEventListener('resize', () => map?.relayout());

initMap();
initFirebase();
