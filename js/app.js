// 약국 임장노트: 지도 위에 임장한 매물을 기록합니다. 데이터는 이 기기에만 저장합니다.
import { KAKAO_JS_KEY } from './config.js';
import { isStandalone, openPlace } from './lib/device.js';
import { createStore } from './lib/store.js';
import { rankPlaces, formatDistance } from './lib/places.js';
import {
  FIELD_GROUPS, cleanForm, upsertListing, removeListing, newestFirst, isLocated, summaryLine, fieldHint,
  detailGroups, regionFromAddress, createListingStore, makeListingId, groupByVisitDate, groupByRegion,
} from './lib/listings.js';
import {
  kakaoLoadMessage, geoErrorMessage, standaloneHelp, kakaoInappMessage, saveErrorMessage, loadErrorMessage,
} from './lib/messages.js';

const VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 부근
const WAIT_MS = 15000;

const $ = (id) => document.getElementById(id);

const STANDALONE = isStandalone(window.navigator, window.matchMedia?.bind(window));
const PLACE = openPlace(navigator.userAgent, navigator.maxTouchPoints || 0, STANDALONE);
const store = createStore(() => window.localStorage);
const listingStore = createListingStore(store);

let items = [];

// ---------- 안내 ----------
let toastTimer = null;

function toast(text, tone = 'ok') {
  const el = $('toast');
  el.dataset.tone = tone;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  // 실패 안내는 읽을 시간이 필요해서 저절로 닫지 않습니다.
  if (tone !== 'fail') toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- 지도 ----------
let kakao = null;
let map = null;
let searchMarker = null;
let meOverlay = null;
const pins = new Map();

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

function mapUnavailable(message) {
  showMapMessage('지도를 불러오지 못했어요', message);
  setSearchEnabled(false);
  renderLocationTools();
}

async function initMap() {
  if (!KAKAO_JS_KEY) {
    mapUnavailable(kakaoLoadMessage('no-key'));
    return;
  }
  try {
    kakao = await loadKakaoSdk(KAKAO_JS_KEY);
    const first = newestFirst(items).find(isLocated);
    const center = first || DEFAULT_CENTER;
    map = new kakao.maps.Map($('map'), {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: first ? 4 : 5,
    });
    let drawn = false;
    kakao.maps.event.addListener(map, 'tilesloaded', () => {
      drawn = true;
      $('mapMsg').hidden = true; // 시간 초과 뒤에 늦게 떠도 안내를 걷습니다.
    });
    kakao.maps.event.addListener(map, 'click', onMapClick);
    setTimeout(() => {
      if (!drawn) showMapMessage('지도 그림이 안 떴어요', kakaoLoadMessage('tiles-timeout'));
    }, WAIT_MS);
    renderPins();
    renderLocationTools();
  } catch (err) {
    kakao = null;
    map = null;
    // 지도가 없어도 매물 저장과 목록은 계속 씁니다.
    mapUnavailable(kakaoLoadMessage(err.message, location.origin));
  }
}

function renderPins() {
  if (!map) return;
  for (const m of pins.values()) m.setMap(null);
  pins.clear();
  for (const item of items.filter(isLocated)) {
    const marker = new kakao.maps.Marker({
      map,
      position: new kakao.maps.LatLng(item.lat, item.lng),
      title: item.name,
    });
    kakao.maps.event.addListener(marker, 'click', () => openDetail(item.id));
    pins.set(item.id, marker);
  }
}

function moveMapTo(lat, lng) {
  if (!map) return;
  const pos = new kakao.maps.LatLng(lat, lng);
  map.setLevel(3);
  map.panTo(pos);
}

// 카카오 검색은 한 번에 45건까지만 줍니다. 전국 순위만 받으면 내 근처 약국이 빠질 수 있어서,
// 전체 순위(모든 쪽)와 지도 근처 순위를 함께 받아 합칩니다.
function searchPlaces(q, done) {
  const S = kakao.maps.services.Status;
  const c = map?.getCenter();
  const center = c ? { lat: c.getLat(), lng: c.getLng() } : null;
  const got = [];
  let waiting = 0;
  let failed = false;
  const finish = () => {
    waiting -= 1;
    if (waiting > 0) return;
    if (failed && got.length === 0) done({ ok: false });
    else done({ ok: true, items: rankPlaces(got, q, center) });
  };
  const ask = (options, allPages) => {
    waiting += 1;
    new kakao.maps.services.Places().keywordSearch(q, (data, status, pagination) => {
      if (status === S.OK) {
        got.push(...data);
        if (allPages && pagination?.hasNextPage) {
          pagination.nextPage();
          return;
        }
      } else if (status !== S.ZERO_RESULT) {
        failed = true;
      }
      finish();
    }, options);
  };
  ask({ size: 15 }, true);
  if (c) ask({ size: 15, location: c, sort: kakao.maps.services.SortBy.DISTANCE }, false);
}

function placeButton(p, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  const name = document.createElement('strong');
  name.textContent = p.place_name;
  const addr = document.createElement('span');
  const far = formatDistance(p.distance);
  const where = p.road_address_name || p.address_name || '';
  addr.textContent = far ? `${far} · ${where}` : where;
  b.append(name, addr);
  b.addEventListener('click', () => onPick(p));
  const li = document.createElement('li');
  li.append(b);
  return li;
}

function placeHint() {
  const li = document.createElement('li');
  li.className = 'place-hint';
  li.textContent = "못 찾으면 '성남 가짜약국'처럼 지역을 같이 적어 보세요.";
  return li;
}

function onSearch(ev) {
  ev.preventDefault();
  const q = $('q').value.trim();
  if (!q || !kakao) return;
  if (cardPlace) hidePlaceCard();
  $('q').blur(); // 아이폰 키보드를 내려 결과가 보이게
  searchPlaces(q, (r) => {
    const ul = $('results');
    ul.replaceChildren();
    if (!r.ok) {
      ul.hidden = true;
      toast('검색 요청이 실패했어요. 잠시 뒤 다시 해 주세요.', 'fail');
      return;
    }
    if (r.items.length === 0) {
      ul.hidden = true;
      toast(`'${q}' 결과가 없어요.`, 'info');
      return;
    }
    for (const p of r.items) {
      ul.append(placeButton(p, () => {
        const lat = Number(p.y);
        const lng = Number(p.x);
        moveMapTo(lat, lng);
        const pos = new kakao.maps.LatLng(lat, lng);
        if (searchMarker) {
          searchMarker.setPosition(pos);
          searchMarker.setMap(map);
        } else {
          searchMarker = new kakao.maps.CustomOverlay({ position: pos, content: makeSearchDot(), map });
        }
        ul.hidden = true;
        showPlaceCard(p);
      }));
    }
    ul.append(placeHint());
    ul.scrollTop = 0;
    ul.hidden = false;
  });
}

// 약국을 먼저 찾고, 고른 약국으로 바로 매물을 추가합니다.
let cardPlace = null;

function showPlaceCard(p) {
  cardPlace = p;
  $('placeName').textContent = p.place_name;
  $('placeAddress').textContent = p.road_address_name || p.address_name || '';
  $('placeCard').hidden = false;
  $('addBtn').hidden = true;
}

function hidePlaceCard() {
  cardPlace = null;
  $('placeCard').hidden = true;
  if (!picking) $('addBtn').hidden = false;
}

function addFromPlace() {
  const p = cardPlace;
  if (!p) return;
  hidePlaceCard();
  searchMarker?.setMap(null); // 저장하면 핀이 그 자리에 생깁니다.
  openForm();
  $('f-name').value = p.place_name;
  setDraftLocation(Number(p.y), Number(p.x), '');
  applyAddress(p.road_address_name, p.address_name);
  formDirty = false; // 채워 준 내용이라 그냥 나가도 묻지 않습니다.
}

// 검색어를 지웁니다. 찾아 둔 결과와 표시도 함께 걷습니다.
function onClearSearch() {
  $('q').value = '';
  $('qClear').hidden = true;
  $('results').hidden = true;
  if (cardPlace) hidePlaceCard();
  searchMarker?.setMap(null);
  $('q').focus();
}

function makeSearchDot() {
  const dot = document.createElement('div');
  dot.className = 'search-dot';
  dot.setAttribute('aria-label', '검색한 장소');
  return dot;
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

function getPosition(onOk, onFail) {
  if (!('geolocation' in navigator)) {
    onFail('이 브라우저는 위치 기능을 지원하지 않아요.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onOk(pos.coords),
    (err) => onFail(geoErrorMessage(err.code)),
    { enableHighAccuracy: true, timeout: WAIT_MS, maximumAge: 0 },
  );
}

function onLocate() {
  toast('위치를 찾는 중이에요.', 'info');
  getPosition((c) => {
    $('toast').hidden = true;
    if (!map) return;
    moveMapTo(c.latitude, c.longitude);
    placeMe(new kakao.maps.LatLng(c.latitude, c.longitude));
  }, (msg) => toast(msg, 'fail'));
}

// ---------- 내 매물 목록 ----------
let view = 'date'; // 'date' 임장 날짜별 | 'region' 지역별

function listingRow(item, now) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'listing';
  const name = document.createElement('strong');
  name.textContent = item.name;
  b.append(name);
  const line = summaryLine(item, { view, now });
  if (line) {
    const sub = document.createElement('span');
    sub.textContent = line;
    b.append(sub);
  }
  b.addEventListener('click', () => openDetail(item.id));
  const li = document.createElement('li');
  li.append(b);
  return li;
}

function renderList() {
  $('count').textContent = `${items.length}개`;
  $('empty').hidden = items.length > 0;
  $('viewTabs').hidden = items.length === 0;
  for (const tab of $('viewTabs').querySelectorAll('button')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
  }
  const now = new Date();
  const groups = view === 'region' ? groupByRegion(items) : groupByVisitDate(items, now);
  const ul = $('list');
  ul.replaceChildren();
  for (const g of groups) {
    const head = document.createElement('li');
    head.className = 'list-head';
    const title = document.createElement('span');
    title.textContent = g.title;
    const count = document.createElement('span');
    count.textContent = `${g.items.length}개`;
    head.append(title, count);
    ul.append(head);
    for (const item of g.items) ul.append(listingRow(item, now));
  }
}

function setView(next) {
  view = next;
  store.write('view', next); // 다음에 열 때도 같은 보기로. 실패해도 지장 없습니다.
  renderList();
  $('sheetBody').scrollTop = 0;
}

function persistItems(next) {
  // 저장에 성공했을 때만 화면의 목록을 바꿉니다.
  const r = listingStore.save(next);
  if (!r.ok) return r;
  items = next;
  renderList();
  renderPins();
  return r;
}

// ---------- 양식 ----------
let editingId = null;
let draftLocation = null;
let formDirty = false;

function fieldInput(f) {
  const id = `f-${f.key}`;
  const box = document.createElement('div');
  box.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = f.required ? `${f.label} (필수)` : f.label;
  box.append(label);
  let input;
  if (f.kind === 'long') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else {
    input = document.createElement('input');
    if (f.kind === 'date') {
      input.type = 'date';
    } else {
      input.type = 'text';
      if (f.kind === 'money') input.inputMode = 'numeric';
      if (f.kind === 'area') input.inputMode = 'decimal';
    }
  }
  input.id = id;
  input.name = f.key;
  input.autocomplete = 'off';
  let placeholder = f.placeholder || '';
  let unit = '';
  if (f.kind === 'money') unit = '만원';
  if (f.kind === 'money-or-new') {
    unit = '만원';
    placeholder = "금액 또는 '신규'";
  }
  if (f.kind === 'area') unit = '㎡';
  input.placeholder = placeholder;
  if (unit) {
    const wrap = document.createElement('div');
    wrap.className = 'with-unit';
    const u = document.createElement('span');
    u.textContent = unit;
    wrap.append(input, u);
    box.append(wrap);
  } else {
    box.append(input);
  }
  if (f.kind === 'money' || f.kind === 'money-or-new' || f.kind === 'area') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.id = `h-${f.key}`;
    box.append(hint);
    input.addEventListener('input', () => { hint.textContent = fieldHint(f.kind, input.value); });
  }
  return box;
}

function buildForm() {
  const host = $('formFields');
  for (const g of FIELD_GROUPS) {
    const section = document.createElement('section');
    section.className = 'group';
    const h = document.createElement('h2');
    h.textContent = g.title;
    section.append(h);
    for (const f of g.fields) {
      const box = fieldInput(f);
      if (f.key === 'name') {
        const err = document.createElement('p');
        err.className = 'field-error';
        err.id = 'nameError';
        err.hidden = true;
        err.textContent = '매물명을 적어 주세요.';
        box.append(err);
        box.querySelector('input').addEventListener('input', () => { err.hidden = true; });
      }
      section.append(box);
    }
    if (g.title === '기본') section.append($('locationBox'));
    host.append(section);
  }
  $('locationBox').hidden = false;
}

function renderLocationTools() {
  const none = !kakao;
  $('locQ').disabled = none;
  $('locSearchBtn').disabled = none;
  $('locMapBtn').disabled = none;
}

// 주소를 고르기 전에는 검색 칸을, 고른 뒤에는 주소와 지우기(X)를 보여 줍니다.
function renderDraftLocation() {
  const on = !!draftLocation;
  $('locPick').hidden = on;
  $('locChosen').hidden = !on;
  $('locState').textContent = on ? (draftLocation.label || '') : '';
  $('locResults').hidden = true;
}

// 좌표를 주소로 바꿉니다. 도로명이 있으면 도로명을, 없으면 지번을 씁니다.
function lookupAddress(lat, lng, done) {
  if (!kakao) {
    done(null);
    return;
  }
  new kakao.maps.services.Geocoder().coord2Address(lng, lat, (data, status) => {
    if (status !== kakao.maps.services.Status.OK || !data?.[0]) {
      done(null);
      return;
    }
    done({ road: data[0].road_address?.address_name || '', jibun: data[0].address?.address_name || '' });
  });
}

// 주소 칸을 채우고, 지역이 비어 있거나 전에 자동으로 넣은 값이면 함께 바꿉니다.
let autoRegion = null;

function applyAddress(road, jibun) {
  const input = $('f-address');
  input.value = road || jibun || '';
  input.readOnly = !!input.value;
  const next = regionFromAddress(jibun || road);
  const region = $('f-region');
  if (next && (!region.value.trim() || region.value === autoRegion)) {
    region.value = next;
    autoRegion = next;
  }
  formDirty = true;
}

function fillAddressFromCoord(lat, lng, keepClean = false) {
  lookupAddress(lat, lng, (r) => {
    // 그사이 다른 곳을 찍었으면 늦게 온 답은 버립니다.
    if (draftLocation?.lat !== lat || draftLocation?.lng !== lng) return;
    const wasDirty = formDirty;
    if (r) {
      applyAddress(r.road, r.jibun);
      if (keepClean) formDirty = wasDirty; // 사용자가 쓴 내용이 아니니 '버릴까요'를 묻지 않습니다.
      return;
    }
    const input = $('f-address');
    input.readOnly = false;
    input.placeholder = '주소를 직접 적어 주세요';
    if (!keepClean) $('locState').textContent = '위치는 찍었지만 주소를 찾지 못했어요. 주소 칸에 직접 적어 주세요.';
  });
}

function setDraftLocation(lat, lng, label = '') {
  draftLocation = { lat, lng, label };
  formDirty = true;
  renderDraftLocation();
}

function openForm(item = null) {
  editingId = item?.id ?? null;
  $('formTitle').textContent = item ? '매물 수정' : '매물 추가';
  const form = $('listingForm');
  form.reset();
  for (const g of FIELD_GROUPS) {
    for (const f of g.fields) {
      const input = form.elements[f.key];
      input.value = item?.[f.key] ?? '';
      const hint = $(`h-${f.key}`);
      if (hint) hint.textContent = fieldHint(f.kind, input.value);
    }
  }
  form.elements.locationMemo.value = item?.locationMemo ?? '';
  form.elements.address.value = item?.address ?? '';
  form.elements.address.readOnly = !!item?.address;
  form.elements.address.placeholder = '';
  autoRegion = null;
  draftLocation = item && isLocated(item) ? { lat: item.lat, lng: item.lng, label: '' } : null;
  renderDraftLocation();
  // 주소 기능을 넣기 전에 저장한 매물은 위치만 있으니 이때 채워 줍니다.
  if (draftLocation && !item.address) fillAddressFromCoord(item.lat, item.lng, true);
  $('locQ').value = '';
  $('formMsg').hidden = true;
  $('nameError').hidden = true;
  formDirty = false;
  $('detailScreen').hidden = true;
  $('formScreen').hidden = false;
  $('formScreen').scrollTop = 0;
}

function closeForm() {
  $('formScreen').hidden = true;
}

// 확인 창: 화면 어디를 보고 있든 가운데에 뜹니다.
let modalYes = null;

function askConfirm(text, yesLabel, noLabel, onYes) {
  $('modalText').textContent = text;
  $('modalYes').textContent = yesLabel;
  $('modalNo').textContent = noLabel;
  modalYes = onYes;
  $('modal').hidden = false;
}

function closeModal() {
  $('modal').hidden = true;
  modalYes = null;
}

function onCancelForm() {
  if (formDirty) {
    askConfirm('작성 중인 내용은 저장되지 않아요. 나갈까요?', '나가기', '계속 쓰기', closeForm);
    return;
  }
  closeForm();
}

function showFormMsg(text) {
  const el = $('formMsg');
  el.textContent = text;
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest' });
}

function onSaveListing(ev) {
  ev.preventDefault();
  // 이 기기에 오래 남도록 부탁합니다. 사파리에서 사용자에게 뜨는 창은 없어요.
  try {
    navigator.storage?.persist?.()?.catch?.(() => {});
  } catch { /* 없어도 저장은 됩니다 */ }
  const raw = Object.fromEntries(new FormData($('listingForm')).entries());
  raw.lat = draftLocation?.lat;
  raw.lng = draftLocation?.lng;
  const r = cleanForm(raw);
  if (!r.ok) {
    // 칸으로 옮겨 가므로 안내도 그 칸 바로 아래에 둡니다.
    $('nameError').hidden = false;
    $('f-name').focus();
    $('f-name').scrollIntoView({ block: 'center' });
    return;
  }
  const now = new Date();
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('');
  const next = upsertListing(items, r.data, { id: editingId, now, newId: makeListingId(now, random) });
  const saved = persistItems(next);
  if (!saved.ok) {
    // 양식을 닫지 않아서 입력한 내용은 그대로 남습니다.
    showFormMsg(saveErrorMessage(saved.reason, saved.detail));
    return;
  }
  const located = r.data.lat !== null;
  closeForm();
  toast('저장했어요.');
  if (located) moveMapTo(r.data.lat, r.data.lng);
}

// 양식 안의 위치 찍기 세 가지
function onLocSearch() {
  const q = $('locQ').value.trim();
  if (!q || !kakao) return;
  document.activeElement?.blur?.();
  searchPlaces(q, (r) => {
    const ul = $('locResults');
    ul.replaceChildren();
    if (!r.ok || r.items.length === 0) {
      ul.hidden = true;
      $('locState').textContent = r.ok ? `'${q}' 결과가 없어요.` : '검색 요청이 실패했어요. 잠시 뒤 다시 해 주세요.';
      return;
    }
    for (const p of r.items) {
      ul.append(placeButton(p, () => {
        setDraftLocation(Number(p.y), Number(p.x), p.place_name);
        applyAddress(p.road_address_name, p.address_name);
        ul.hidden = true;
      }));
    }
    ul.append(placeHint());
    ul.scrollTop = 0;
    ul.hidden = false;
    ul.scrollIntoView({ block: 'nearest' });
  });
}

function onLocHere() {
  $('locState').textContent = '위치를 찾는 중이에요. 권한을 물으면 허용해 주세요.';
  getPosition(
    (c) => {
      setDraftLocation(c.latitude, c.longitude, `현재 위치 (오차 약 ${Math.round(c.accuracy)}m)`);
      fillAddressFromCoord(c.latitude, c.longitude);
    },
    (msg) => { $('locState').textContent = msg; },
  );
}

// 지도에서 고르기: 양식을 잠시 내리고 지도를 눌러 고릅니다.
let picking = false;
let pickPos = null;
let pickOverlay = null;
let pickAddress = null;

function onLocMap() {
  if (!map) return;
  picking = true;
  $('toast').hidden = true;
  hidePlaceCard();
  pickPos = draftLocation ? { lat: draftLocation.lat, lng: draftLocation.lng } : null;
  pickAddress = null;
  $('pickText').textContent = '지도에서 약국 위치를 눌러 주세요.';
  $('formScreen').hidden = true;
  $('pickBar').hidden = false;
  $('sheet').hidden = true;
  $('addBtn').hidden = true;
  map.relayout();
  drawPick();
}

function drawPick() {
  $('pickOk').disabled = !pickPos;
  if (!pickPos) return;
  const pos = new kakao.maps.LatLng(pickPos.lat, pickPos.lng);
  if (pickOverlay) {
    pickOverlay.setPosition(pos);
    pickOverlay.setMap(map);
  } else {
    const dot = document.createElement('div');
    dot.className = 'search-dot';
    dot.id = 'pickDot';
    pickOverlay = new kakao.maps.CustomOverlay({ position: pos, content: dot, map });
  }
}

function endPick(ok) {
  picking = false;
  pickOverlay?.setMap(null);
  $('pickBar').hidden = true;
  $('sheet').hidden = false;
  $('addBtn').hidden = false;
  $('formScreen').hidden = false;
  map.relayout();
  if (ok && pickPos) {
    setDraftLocation(pickPos.lat, pickPos.lng, '');
    if (pickAddress) applyAddress(pickAddress.road, pickAddress.jibun);
    else fillAddressFromCoord(pickPos.lat, pickPos.lng);
  }
}

function onMapClick(mouseEvent) {
  $('results').hidden = true;
  if (!picking) {
    if (cardPlace) hidePlaceCard();
    return;
  }
  const ll = mouseEvent.latLng;
  const here = { lat: ll.getLat(), lng: ll.getLng() };
  pickPos = here;
  pickAddress = null;
  drawPick();
  $('pickText').textContent = '주소를 찾는 중이에요.';
  // 어디를 눌렀는지 바로 알 수 있게 주소를 보여 줍니다.
  lookupAddress(here.lat, here.lng, (r) => {
    if (pickPos !== here) return;
    pickAddress = r;
    $('pickText').textContent = r ? (r.road || r.jibun) : '주소를 찾지 못했어요. 이 위치로 해도 돼요.';
  });
}

// ---------- 상세 ----------
let detailId = null;

function openDetail(id) {
  const item = items.find((x) => x.id === id);
  if (!item) return;
  detailId = id;
  $('detailTitle').textContent = item.name;
  const host = $('detailBody');
  host.replaceChildren();
  const groups = detailGroups(item);
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'group';
    const h = document.createElement('h2');
    h.textContent = g.title;
    section.append(h);
    for (const row of g.rows) {
      const line = document.createElement('div');
      line.className = row.long ? 'row long' : 'row';
      const k = document.createElement('span');
      k.textContent = row.label;
      const v = document.createElement('p');
      v.textContent = row.value;
      if (row.strong) v.className = 'strong';
      line.append(k, v);
      section.append(line);
    }
    host.append(section);
  }
  if (groups.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '아직 적은 내용이 없어요.';
    host.append(p);
  }
  if (!isLocated(item)) {
    const memo = document.createElement('p');
    memo.className = 'muted';
    memo.textContent = '아직 지도에 위치가 없어요.';
    host.prepend(memo);
  }
  $('mapViewBtn').hidden = !(isLocated(item) && map);
  $('detailMsg').hidden = true;
  $('detailScreen').hidden = false;
  $('detailScreen').scrollTop = 0;
}

function onDeleteConfirmed() {
  const r = persistItems(removeListing(items, detailId));
  if (!r.ok) {
    const el = $('detailMsg');
    el.textContent = saveErrorMessage(r.reason, r.detail);
    el.hidden = false;
    return;
  }
  $('detailScreen').hidden = true;
  toast('삭제했어요.');
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
function showPlaceNotice() {
  if (PLACE === 'app') return;
  // 저장 공간이 달라서, 아이콘이 아닌 곳에 저장한 내용은 아이콘에서 보이지 않습니다.
  const text = PLACE === 'kakao' ? kakaoInappMessage(navigator.userAgent) : standaloneHelp(PLACE);
  $('placeHelp').textContent = text;
  $('placeNotice').hidden = false;
}

function loadItems() {
  const r = listingStore.load();
  if (r.ok) {
    items = r.items;
    return;
  }
  // 읽지 못하면 덮어쓰지 않도록 추가·저장을 막고 알립니다.
  const el = $('loadMsg');
  el.textContent = loadErrorMessage(r.reason, r.detail);
  el.hidden = false;
  $('addBtn').disabled = true;
}

$('ver').textContent = VERSION;
$('searchForm').addEventListener('submit', onSearch);
$('q').addEventListener('input', () => { $('qClear').hidden = !$('q').value; });
$('qClear').addEventListener('click', onClearSearch);
$('locate').addEventListener('click', onLocate);
$('sheetToggle').addEventListener('click', onToggleSheet);
$('addBtn').addEventListener('click', () => openForm());
$('placeAdd').addEventListener('click', addFromPlace);
$('placeClose').addEventListener('click', hidePlaceCard);
$('formClose').addEventListener('click', onCancelForm);
$('modalNo').addEventListener('click', closeModal);
$('modalYes').addEventListener('click', () => {
  const run = modalYes;
  closeModal();
  run?.();
});
$('listingForm').addEventListener('submit', onSaveListing);
$('listingForm').addEventListener('input', () => { formDirty = true; });
$('locSearchBtn').addEventListener('click', onLocSearch);
$('locQ').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault(); // 검색칸에서 엔터를 눌러도 양식이 저장되지 않게
    onLocSearch();
  }
});
$('locHereBtn').addEventListener('click', onLocHere);
$('locMapBtn').addEventListener('click', onLocMap);
$('locClear').addEventListener('click', () => {
  draftLocation = null;
  $('f-address').value = '';
  $('locQ').value = '';
  // 주소에서 자동으로 넣은 지역이면 함께 지웁니다. 직접 적은 지역은 둡니다.
  if ($('f-region').value === autoRegion) $('f-region').value = '';
  autoRegion = null;
  formDirty = true;
  renderDraftLocation();
});
$('pickOk').addEventListener('click', () => endPick(true));
$('pickCancel').addEventListener('click', () => endPick(false));
$('detailClose').addEventListener('click', () => { $('detailScreen').hidden = true; });
$('editBtn').addEventListener('click', () => openForm(items.find((x) => x.id === detailId)));
$('mapViewBtn').addEventListener('click', () => {
  const item = items.find((x) => x.id === detailId);
  $('detailScreen').hidden = true;
  if (item) moveMapTo(item.lat, item.lng);
});
$('deleteBtn').addEventListener('click', () => {
  askConfirm('이 매물을 삭제할까요? 되돌릴 수 없어요.', '삭제', '취소', onDeleteConfirmed);
});
window.addEventListener('resize', () => map?.relayout());

const savedView = store.read('view');
if (savedView.ok && (savedView.data === 'date' || savedView.data === 'region')) view = savedView.data;
for (const tab of $('viewTabs').querySelectorAll('button')) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
}

buildForm();
loadItems();
showPlaceNotice();
renderList();
renderDraftLocation();
renderLocationTools();
initMap();

window.__appStarted = true;
window.__onAppStarted?.();
