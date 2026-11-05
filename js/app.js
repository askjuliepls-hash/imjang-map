// 약국 임장노트: 지도 위에 임장한 매물을 기록합니다. 데이터는 이 기기에만 저장합니다.
import { KAKAO_JS_KEY } from './config.js';
import { isStandalone, openPlace } from './lib/device.js';
import { createStore } from './lib/store.js';
import {
  FIELD_GROUPS, cleanForm, upsertListing, removeListing, newestFirst, isLocated, summaryLine, fieldHint,
  detailGroups, regionFromAddress, createListingStore, makeListingId,
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
const listingStore = createListingStore(createStore(() => window.localStorage));

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

function searchPlaces(q, done) {
  const places = new kakao.maps.services.Places();
  const S = kakao.maps.services.Status;
  places.keywordSearch(q, (data, status) => {
    if (status === S.OK) done({ ok: true, items: data.slice(0, 5) });
    else if (status === S.ZERO_RESULT) done({ ok: true, items: [] });
    else done({ ok: false });
  }, { size: 5 });
}

function placeButton(p, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  const name = document.createElement('strong');
  name.textContent = p.place_name;
  const addr = document.createElement('span');
  addr.textContent = p.road_address_name || p.address_name || '';
  b.append(name, addr);
  b.addEventListener('click', () => onPick(p));
  const li = document.createElement('li');
  li.append(b);
  return li;
}

function onSearch(ev) {
  ev.preventDefault();
  const q = $('q').value.trim();
  if (!q || !kakao) return;
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
      }));
    }
    ul.hidden = false;
  });
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
function renderList() {
  $('count').textContent = `${items.length}개`;
  $('empty').hidden = items.length > 0;
  const ul = $('list');
  ul.replaceChildren();
  for (const item of newestFirst(items)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'listing';
    const name = document.createElement('strong');
    name.textContent = item.name;
    b.append(name);
    const line = summaryLine(item);
    if (line) {
      const sub = document.createElement('span');
      sub.textContent = line;
      b.append(sub);
    }
    b.addEventListener('click', () => openDetail(item.id));
    const li = document.createElement('li');
    li.append(b);
    ul.append(li);
  }
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

function renderDraftLocation() {
  const on = !!draftLocation;
  $('locState').textContent = on ? (draftLocation.label || '위치를 찍었어요.') : '아직 위치가 없어요. 나중에 찍어도 돼요.';
  $('locClear').hidden = !on;
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
  draftLocation = item && isLocated(item) ? { lat: item.lat, lng: item.lng, label: '위치를 찍었어요.' } : null;
  renderDraftLocation();
  $('locResults').hidden = true;
  $('locQ').value = '';
  $('formMsg').hidden = true;
  $('nameError').hidden = true;
  $('discardBar').hidden = true;
  formDirty = false;
  $('detailScreen').hidden = true;
  $('formScreen').hidden = false;
  $('formScreen').scrollTop = 0;
}

function closeForm() {
  $('formScreen').hidden = true;
}

function onCancelForm() {
  if (formDirty) {
    $('discardBar').hidden = false;
    $('discardBar').scrollIntoView({ block: 'nearest' });
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
        setDraftLocation(Number(p.y), Number(p.x), `${p.place_name} 위치를 찍었어요.`);
        const region = $('f-region');
        if (!region.value.trim()) region.value = regionFromAddress(p.address_name || p.road_address_name);
        ul.hidden = true;
      }));
    }
    ul.hidden = false;
    ul.scrollIntoView({ block: 'nearest' });
  });
}

function onLocHere() {
  $('locState').textContent = '위치를 찾는 중이에요. 권한을 물으면 허용해 주세요.';
  getPosition(
    (c) => setDraftLocation(c.latitude, c.longitude, `현재 위치를 찍었어요. 오차 약 ${Math.round(c.accuracy)}m.`),
    (msg) => { $('locState').textContent = msg; },
  );
}

// 지도에서 고르기: 양식을 잠시 내리고 지도를 눌러 고릅니다.
let picking = false;
let pickPos = null;
let pickOverlay = null;

function onLocMap() {
  if (!map) return;
  picking = true;
  $('toast').hidden = true;
  pickPos = draftLocation ? { lat: draftLocation.lat, lng: draftLocation.lng } : null;
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
  if (ok && pickPos) setDraftLocation(pickPos.lat, pickPos.lng, '지도에서 위치를 찍었어요.');
}

function onMapClick(mouseEvent) {
  $('results').hidden = true;
  if (!picking) return;
  const ll = mouseEvent.latLng;
  pickPos = { lat: ll.getLat(), lng: ll.getLng() };
  drawPick();
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
  const memo = document.createElement('p');
  memo.className = 'muted';
  const loc = isLocated(item) ? '지도에 위치가 있어요.' : '아직 지도에 위치가 없어요.';
  memo.textContent = item.locationMemo ? `${loc} 위치 메모: ${item.locationMemo}` : loc;
  host.prepend(memo);
  $('mapViewBtn').hidden = !(isLocated(item) && map);
  $('deleteConfirm').hidden = true;
  $('deleteBtn').hidden = false;
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
$('locate').addEventListener('click', onLocate);
$('sheetToggle').addEventListener('click', onToggleSheet);
$('addBtn').addEventListener('click', () => openForm());
$('formClose').addEventListener('click', onCancelForm);
$('discardYes').addEventListener('click', closeForm);
$('discardNo').addEventListener('click', () => { $('discardBar').hidden = true; });
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
  $('deleteBtn').hidden = true;
  $('deleteConfirm').hidden = false;
  $('deleteConfirm').scrollIntoView({ block: 'nearest' });
});
$('deleteNo').addEventListener('click', () => {
  $('deleteConfirm').hidden = true;
  $('deleteBtn').hidden = false;
});
$('deleteYes').addEventListener('click', onDeleteConfirmed);
window.addEventListener('resize', () => map?.relayout());

buildForm();
loadItems();
showPlaceNotice();
renderList();
renderDraftLocation();
renderLocationTools();
initMap();

window.__appStarted = true;
window.__onAppStarted?.();
