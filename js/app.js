// 약국 임장노트: 지도 위에 임장한 매물을 기록합니다. 데이터는 이 기기에만 저장합니다.
import { KAKAO_JS_KEY } from './config.js';
import { isAppleMobile, isStandalone, openPlace, parseAppVersion } from './lib/device.js';
import { createStore } from './lib/store.js';
import { rankPlaces, formatDistance } from './lib/places.js';
import {
  buildBackup, chooseExportPath, readBackupFile, needsReminder, formatBackupTime, REMIND_DAYS,
} from './lib/backup.js';
import {
  PALETTE, MAX_NAME, checkName, upsertCategory, removeCategory, clearCategoryFrom, categoryOf, pinColor, nextColor,
  matchesFilter, groupByCategory, pinImageUrl, NO_CATEGORY_COLOR,
} from './lib/categories.js';
import { toPyeong, fromPyeong } from './lib/format.js';
import {
  FIELD_GROUPS, cleanForm, upsertListing, removeListing, newestFirst, isLocated, summaryLine, fieldHint,
  detailGroups, regionFromAddress, createListingStore, makeListingId, groupByVisitDate, groupByRegion, listingFacts, regionOf,
  sideLabel, shortVisitDate, monthCells, visitDates,
} from './lib/listings.js';
import {
  kakaoLoadMessage, geoErrorMessage, standaloneHelp, kakaoInappMessage, saveErrorMessage, loadErrorMessage,
  importErrorMessage, exportFailMessage,
} from './lib/messages.js';

const VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청 부근
const WAIT_MS = 15000;

const $ = (id) => document.getElementById(id);

const STANDALONE = isStandalone(window.navigator, window.matchMedia?.bind(window));
const PLACE = openPlace(navigator.userAgent, navigator.maxTouchPoints || 0, STANDALONE);
const APPLE = isAppleMobile(navigator.userAgent, navigator.maxTouchPoints || 0);
const store = createStore(() => window.localStorage);
const listingStore = createListingStore(store);
const categoryStore = createListingStore(store, 'categories');

let items = [];
let categories = [];
let mapFilter = null; // null 전체 | 'none' 분류 없음 | 분류 id

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

function mapUnavailable(message, canRetry = true) {
  showMapMessage('지도를 불러오지 못했어요', message);
  setSearchEnabled(false);
  renderLocationTools();
  if (canRetry) window.__showReload?.('지도를 불러오지 못했어요.');
}

async function initMap() {
  if (!KAKAO_JS_KEY) {
    mapUnavailable(kakaoLoadMessage('no-key'), false);
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
    let askedReload = false;
    kakao.maps.event.addListener(map, 'tilesloaded', () => {
      drawn = true;
      $('mapMsg').hidden = true; // 시간 초과 뒤에 늦게 떠도 안내를 걷습니다.
      if (askedReload) window.__hideReload?.(); // 지도 때문에 띄운 버튼만 걷습니다.
    });
    kakao.maps.event.addListener(map, 'click', onMapClick);
    setTimeout(() => {
      if (drawn) return;
      showMapMessage('지도 그림이 안 떴어요', kakaoLoadMessage('tiles-timeout'));
      askedReload = true;
      window.__showReload?.('지도 그림이 안 떴어요.');
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
  for (const item of items.filter(isLocated).filter((x) => matchesFilter(x, categories, mapFilter))) {
    const marker = new kakao.maps.Marker({
      map,
      position: new kakao.maps.LatLng(item.lat, item.lng),
      title: item.name,
      image: new kakao.maps.MarkerImage(
        pinImageUrl(pinColor(item, categories)),
        new kakao.maps.Size(32, 40),
        { offset: new kakao.maps.Point(16, 40) },
      ),
    });
    kakao.maps.event.addListener(marker, 'click', () => showPinCard(item.id));
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
  if (pinId) hidePinCard();
  $('backupNudge').hidden = true;
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

// 핀을 누르면 지도를 그대로 둔 채 요약을 보여 줍니다.
let pinId = null;

function showPinCard(id) {
  const item = items.find((x) => x.id === id);
  if (!item) return;
  if (cardPlace) hidePlaceCard();
  $('backupNudge').hidden = true;
  pinId = id;
  $('pinName').textContent = item.name;
  const pinMeta = [regionOf(item), shortVisitDate(item.visitDate)].filter(Boolean).join(' · ');
  $('pinMeta').textContent = pinMeta;
  $('pinMeta').hidden = !pinMeta;
  fillFacts($('pinFacts'), item);
  $('pinCard').hidden = false;
  $('addBtn').hidden = true;
}

function hidePinCard() {
  pinId = null;
  $('pinCard').hidden = true;
  if (!picking) $('addBtn').hidden = false;
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
let view = 'date'; // 'date' 임장 날짜별 | 'region' 지역별 | 'category' 분류별

// 금액들을 칸마다 묶어 넣습니다. 한 항목이 중간에 나뉘지 않고 통째로 다음 줄로 내려갑니다.
function fillFacts(box, item) {
  box.replaceChildren();
  for (const fact of listingFacts(item)) {
    const one = document.createElement('span');
    one.className = 'fact';
    const value = document.createElement('b');
    value.textContent = fact.value;
    one.append(fact.label, value);
    box.append(one);
  }
}

function colorDot(color) {
  const dot = document.createElement('i');
  dot.className = 'cat-dot';
  dot.style.background = color;
  return dot;
}

function listingRow(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'listing';
  const head = document.createElement('span');
  head.className = 'name-row';
  const name = document.createElement('strong');
  name.textContent = item.name;
  head.append(name);
  const side = sideLabel(item, { view });
  if (side) {
    const s = document.createElement('span');
    s.className = 'side';
    s.textContent = side;
    head.append(s);
  }
  b.append(head);
  const line = summaryLine(item, { view });
  const cat = view === 'category' ? null : categoryOf(item, categories);
  if (line || cat) {
    const sub = document.createElement('span');
    sub.className = 'meta';
    if (cat) sub.append(colorDot(cat.color), cat.name, line ? ' · ' : '');
    sub.append(line);
    b.append(sub);
  }
  if (listingFacts(item).length > 0) {
    const box = document.createElement('span');
    box.className = 'facts';
    fillFacts(box, item);
    b.append(box);
  }
  b.addEventListener('click', () => openDetail(item.id));
  const li = document.createElement('li');
  li.append(b);
  return li;
}

function renderList() {
  $('listMeta').hidden = items.length === 0;
  $('empty').hidden = items.length > 0;
  $('emptyImport').hidden = items.length > 0;
  $('viewTabs').hidden = items.length === 0;
  for (const tab of $('viewTabs').querySelectorAll('button')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
  }
  renderDateTools();
  let groups;
  if (view === 'category') groups = groupByCategory(items, categories);
  else if (view === 'region') groups = groupByRegion(items);
  else groups = dateGroups();
  // 날짜를 골랐으면 그날 개수를 보여 줍니다.
  const shown = view === 'date' && dateMode === 'pick' ? groups.reduce((n, g) => n + g.items.length, 0) : items.length;
  $('count').textContent = `총 ${shown}개`;
  const ul = $('list');
  ul.replaceChildren();
  for (const g of groups) {
    const head = document.createElement('li');
    head.className = 'list-head';
    const title = document.createElement('span');
    if (g.color) title.append(colorDot(g.color));
    title.append(g.title);
    const count = document.createElement('span');
    count.textContent = `${g.items.length}개`;
    head.append(title, count);
    ul.append(head);
    for (const item of g.items) ul.append(listingRow(item));
  }
}

// 임장 날짜별 보기의 세 가지: 최신순, 오래된순, 달력에서 고른 날짜
let dateMode = 'new'; // 'new' | 'old' | 'pick'
let pickedDate = null;

function dateGroups() {
  if (dateMode === 'pick') {
    const g = groupByVisitDate(items, { date: pickedDate });
    if (g.length > 0) return g;
    dateMode = 'new'; // 그날 매물을 지웠거나 날짜를 고쳤으면 전체로 돌아갑니다.
    pickedDate = null;
    renderDateTools();
  }
  return groupByVisitDate(items, { order: dateMode });
}

function renderDateTools() {
  $('sortWrap').hidden = view !== 'date';
  $('orderNew').setAttribute('aria-pressed', String(dateMode === 'new'));
  $('orderOld').setAttribute('aria-pressed', String(dateMode === 'old'));
  $('datePick').setAttribute('aria-pressed', String(dateMode === 'pick'));
  const label = { new: '최신순', old: '오래된순' }[dateMode] || shortVisitDate(pickedDate);
  $('sortLabel').textContent = label;
}

function setSortMenu(open) {
  $('sortMenu').hidden = !open;
  $('sortBtn').setAttribute('aria-expanded', String(open));
}

function setDateOrder(mode) {
  setSortMenu(false);
  dateMode = mode;
  pickedDate = null;
  store.write('dateOrder', mode); // 다음에 열 때도 같은 순서로
  renderList();
  $('sheet').scrollTop = 0;
}

let calYear = 0;
let calMonth = 0; // 1~12

function renderCalendar() {
  $('calTitle').textContent = `${calYear}년 ${calMonth}월`;
  const marked = visitDates(items);
  const grid = $('calGrid');
  grid.replaceChildren();
  for (const cell of monthCells(calYear, calMonth)) {
    if (!cell) {
      grid.append(document.createElement('span'));
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-day';
    b.dataset.date = cell;
    b.textContent = String(Number(cell.slice(8)));
    const has = marked.has(cell);
    b.disabled = !has; // 매물이 없는 날은 눌러도 보여 줄 것이 없습니다.
    b.dataset.has = String(has);
    b.setAttribute('aria-pressed', String(dateMode === 'pick' && pickedDate === cell));
    b.addEventListener('click', () => {
      dateMode = 'pick';
      pickedDate = cell;
      $('calModal').hidden = true;
      renderList();
      $('sheet').scrollTop = 0;
    });
    grid.append(b);
  }
  $('calNote').textContent = marked.size > 0 ? '점이 있는 날에 임장한 매물이 있어요.' : '아직 임장일을 적은 매물이 없어요.';
}

function openCalendar() {
  // 고른 날짜나 가장 최근 임장일이 있는 달부터 보여 줍니다.
  const latest = [...visitDates(items)].sort().pop();
  const base = pickedDate || latest || new Date().toISOString().slice(0, 10);
  calYear = Number(base.slice(0, 4));
  calMonth = Number(base.slice(5, 7));
  renderCalendar();
  $('calModal').hidden = false;
}

function moveCalendar(delta) {
  const d = new Date(calYear, calMonth - 1 + delta, 1);
  calYear = d.getFullYear();
  calMonth = d.getMonth() + 1;
  renderCalendar();
}

function setView(next) {
  view = next;
  store.write('view', next); // 다음에 열 때도 같은 보기로. 실패해도 지장 없습니다.
  renderList();
  $('sheet').scrollTop = 0;
}

function persistItems(next) {
  // 저장에 성공했을 때만 화면의 목록을 바꿉니다.
  const r = listingStore.save(next);
  if (!r.ok) return r;
  items = next;
  markChanged();
  renderList();
  renderPins();
  renderCatManage();
  return r;
}

// ---------- 양식 ----------
let editingId = null;
let draftCategoryId = null;
let draftLocation = null;
let formDirty = false;

// 면적은 ㎡와 평 어느 쪽으로 적어도 서로 채워 줍니다. 저장은 ㎡로 합니다.
function areaInput(f) {
  const box = document.createElement('div');
  box.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = `f-${f.key}`;
  label.textContent = f.label;
  const pair = document.createElement('div');
  pair.className = 'area-pair';
  const part = (id, name, unit, aria) => {
    const wrap = document.createElement('div');
    wrap.className = 'with-unit';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    if (name) input.name = name;
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', aria);
    const u = document.createElement('span');
    u.textContent = unit;
    wrap.append(input, u);
    pair.append(wrap);
    return input;
  };
  const m2 = part(`f-${f.key}`, f.key, '㎡', `${f.label} ㎡`);
  const py = part(`p-${f.key}`, '', '평', `${f.label} 평`);
  m2.addEventListener('input', () => { py.value = toPyeong(m2.value); });
  py.addEventListener('input', () => { m2.value = fromPyeong(py.value); });
  box.append(label, pair);
  return box;
}

function fieldInput(f) {
  if (f.kind === 'area') return areaInput(f);
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
    if (f.placeholder === undefined) placeholder = "금액 또는 '신규'";
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
      if (f.key === 'region') {
        const catField = $('catField');
        catField.hidden = false;
        section.append(catField);
      }
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
      const py = $(`p-${f.key}`);
      if (py) py.value = toPyeong(input.value);
    }
  }
  draftCategoryId = item && categoryOf(item, categories) ? item.categoryId : null;
  renderCatChoices();
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

function askConfirm(text, yesLabel, noLabel, onYes, { recommend = false } = {}) {
  $('modalText').textContent = text;
  $('modalYes').textContent = yesLabel;
  $('modalYes').className = recommend ? 'fill-btn' : 'text-btn danger';
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
  raw.categoryId = draftCategoryId;
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
  if (located && tab === 'map') moveMapTo(r.data.lat, r.data.lng);
  announceSaved();
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
let pickReturnTab = 'map';

function onLocMap() {
  if (!map) return;
  picking = true;
  pickReturnTab = tab;
  setTab('map');
  $('app').dataset.picking = 'true';
  hidePlaceCard();
  if (pinId) hidePinCard();
  pickPos = draftLocation ? { lat: draftLocation.lat, lng: draftLocation.lng } : null;
  pickAddress = null;
  $('pickText').textContent = '지도에서 약국 위치를 눌러 주세요.';
  $('formScreen').hidden = true;
  $('pickBar').hidden = false;
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
  delete $('app').dataset.picking;
  $('addBtn').hidden = false;
  $('formScreen').hidden = false;
  setTab(pickReturnTab);
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
    if (pinId) hidePinCard();
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
  const cat = categoryOf(item, categories);
  $('detailCat').hidden = !cat;
  $('detailCat').replaceChildren(...(cat ? [colorDot(cat.color), cat.name] : []));
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
// ---------- 내 분류 ----------
function persistCategories(next) {
  const r = categoryStore.save(next);
  if (!r.ok) return r;
  categories = next;
  markChanged();
  renderCategoryUi();
  return r;
}

function renderCatChoices() {
  const host = $('catChoices');
  host.replaceChildren();
  const chip = (label, id, color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(draftCategoryId === id));
    if (color) b.append(colorDot(color));
    b.append(label);
    b.addEventListener('click', () => {
      draftCategoryId = id;
      formDirty = true;
      renderCatChoices();
    });
    host.append(b);
  };
  chip('없음', null);
  for (const c of categories) chip(c.name, c.id, c.color);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chip add';
  add.id = 'catNew';
  add.textContent = '+ 새 분류';
  add.addEventListener('click', () => openCatModal(null, (made) => {
    draftCategoryId = made.id;
    formDirty = true;
    renderCatChoices();
  }));
  host.append(add);
}

function renderMapChips() {
  const host = $('catChips');
  host.hidden = categories.length === 0;
  host.replaceChildren();
  const chip = (label, value, color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(mapFilter === value));
    if (color) b.append(colorDot(color));
    b.append(label);
    b.addEventListener('click', () => {
      mapFilter = value;
      if (pinId) hidePinCard();
      renderMapChips();
      renderPins();
    });
    host.append(b);
  };
  chip('전체', null);
  for (const c of categories) chip(c.name, c.id, c.color);
  chip('분류 없음', 'none', NO_CATEGORY_COLOR);
}

function renderCatManage() {
  $('catCount').textContent = categories.length > 0 ? `${categories.length}개` : '없음';
  $('catEmpty').hidden = categories.length > 0;
  const ul = $('catList');
  ul.replaceChildren();
  for (const c of categories) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'cat-name';
    const count = items.filter((x) => x.categoryId === c.id).length;
    name.append(colorDot(c.color), `${c.name} (${count})`);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-btn';
    edit.textContent = '수정';
    edit.addEventListener('click', () => openCatModal(c));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-btn danger';
    del.textContent = '삭제';
    del.addEventListener('click', () => {
      askConfirm(`'${c.name}' 분류를 삭제할까요? 매물은 지워지지 않아요.`, '삭제', '취소', () => deleteCategory(c.id));
    });
    li.append(name, edit, del);
    ul.append(li);
  }
}

function renderCategoryUi() {
  renderCatChoices();
  renderMapChips();
  renderCatManage();
  renderList();
  renderPins();
}

function deleteCategory(id) {
  // 매물에서 먼저 빼고 분류를 지웁니다. 중간에 실패해도 매물은 그대로 있어요.
  const r1 = persistItems(clearCategoryFrom(items, id));
  const r2 = r1.ok ? persistCategories(removeCategory(categories, id)) : r1;
  if (!r2.ok) {
    toast(saveErrorMessage(r2.reason, r2.detail), 'fail');
    return;
  }
  if (mapFilter === id) mapFilter = null;
  renderCategoryUi();
}

let catEditing = null;
let catColor = PALETTE[0].color;
let catAfterSave = null;

function renderSwatches() {
  const host = $('catSwatches');
  host.replaceChildren();
  for (const p of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = p.color;
    b.setAttribute('aria-label', p.name);
    b.setAttribute('aria-pressed', String(catColor === p.color));
    b.addEventListener('click', () => {
      catColor = p.color;
      renderSwatches();
    });
    host.append(b);
  }
}

function openCatModal(cat, afterSave = null) {
  catEditing = cat;
  catAfterSave = afterSave;
  catColor = cat?.color || nextColor(categories);
  $('catModalTitle').textContent = cat ? '분류 수정' : '새 분류';
  $('catName').value = cat?.name || '';
  $('catError').hidden = true;
  renderSwatches();
  $('catModal').hidden = false;
}

function onSaveCategory() {
  const checked = checkName(categories, $('catName').value, catEditing?.id ?? null);
  if (!checked.ok) {
    const words = { empty: '이름을 적어 주세요.', long: `이름은 ${MAX_NAME}자까지 쓸 수 있어요.`, same: '같은 이름의 분류가 있어요.' };
    $('catError').textContent = words[checked.reason];
    $('catError').hidden = false;
    return;
  }
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('');
  const id = catEditing?.id ?? `c${Date.now().toString(36)}-${random}`;
  const r = persistCategories(upsertCategory(categories, { id: catEditing?.id, name: checked.name, color: catColor }, id));
  if (!r.ok) {
    $('catError').textContent = saveErrorMessage(r.reason, r.detail);
    $('catError').hidden = false;
    return;
  }
  $('catModal').hidden = true;
  catAfterSave?.({ id });
  catAfterSave = null;
}

// ---------- 백업 ----------
// 기록: lastBackupAt 마지막 내보내기, dirtySince 그 뒤로 처음 바뀐 때
let backupMeta = { lastBackupAt: null, dirtySince: null, pending: 0, introSeen: false };
let persistGranted = null; // 아이폰이 자동 삭제 방지 요청을 받아들였는지. null은 모름
let itemsUnreadable = false; // 저장된 매물을 읽지 못한 상태
let shareRefused = 0;

function saveBackupMeta() {
  store.write('backup-meta', backupMeta); // 실패해도 데이터에는 지장이 없습니다.
  renderBackupInfo();
}

function markChanged() {
  backupMeta.pending = (backupMeta.pending || 0) + 1;
  backupMeta.dirtySince ||= new Date().toISOString();
  saveBackupMeta();
}

// 자동 삭제를 막아 달라고 앱을 열 때마다 요청합니다. 사파리에서 사용자에게 뜨는 창은 없어요.
async function askPersist() {
  if (PLACE !== 'app' || !navigator.storage?.persist) return;
  try {
    persistGranted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch {
    persistGranted = null;
  }
  renderBackupInfo();
}

function renderBackupInfo() {
  const last = backupMeta.lastBackupAt ? formatBackupTime(backupMeta.lastBackupAt) : '';
  const pending = backupMeta.dirtySince ? backupMeta.pending || 0 : 0;
  $('backupWhen').textContent = pending > 0 ? `백업 전 ${pending}건` : (last ? last.slice(0, 10) : '안 함');
  $('backupWhen').dataset.alert = String(pending > 0);
  // 백업 안 한 변경이 있으면 설정 탭에 점을 찍어 어느 화면에서든 보이게 합니다.
  document.querySelector('#tabbar [data-tab="settings"]').dataset.alert = String(pending > 0);
  $('backupLast').textContent = last
    ? `마지막 백업: ${last}.${pending > 0 ? ` 그 뒤 변경 ${pending}건은 폰에만 있어요.` : ''}`
    : `아직 백업한 적이 없어요.${pending > 0 ? ` 변경 ${pending}건이 폰에만 있어요.` : ''}`;
  $('persistLine').hidden = persistGranted === null;
  $('persistLine').textContent = persistGranted
    ? '자동 삭제 방지: 켜짐'
    : '자동 삭제 방지: 아이폰이 허용하지 않았어요. 백업을 꼭 해 주세요.';
  $('backupHow').textContent = APPLE
    ? "누른 뒤 '카카오톡' → '나와의 채팅'으로 보내 주세요. 카톡 파일은 시간이 지나면 만료될 수 있으니, 내용이 바뀌면 다시 보내 주세요."
    : '누르면 파일이 저장돼요. 폰 밖에 옮겨 두면 폰을 바꿔도 되살릴 수 있어요.';
  const snap = store.read('before-import');
  const has = snap.ok && snap.data?.listings;
  $('undoImport').hidden = !has;
  if (has) $('undoImport').textContent = `가져오기 전으로 되돌리기 (${snap.data.listings.length}개)`;
}

// 안내는 한 곳에만 보여 줍니다. 백업 화면이 닫혀 있으면(빈 목록에서 가져오기) 토스트로 알립니다.
function backupSay(text, tone = 'info', where = 'backupMsg') {
  if ($('backupScreen').hidden) {
    toast(text, tone === 'fail' ? 'fail' : 'ok');
    return;
  }
  $('backupMsg').hidden = true;
  $('importMsg').hidden = true;
  const el = $(where);
  el.dataset.tone = tone;
  el.textContent = text;
  el.hidden = false;
  // 결과와 되돌리기 버튼이 화면 밖이면 보이게 옮깁니다.
  (where === 'importMsg' && !$('undoImport').hidden ? $('undoImport') : el).scrollIntoView({ block: 'nearest' });
}

function exported() {
  backupMeta.lastBackupAt = new Date().toISOString();
  backupMeta.dirtySince = null;
  backupMeta.pending = 0;
  saveBackupMeta();
  $('backupNudge').hidden = true;
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
  exported();
  // 저장 창에서 취소했는지는 앱이 알 수 없어요.
  backupSay(`파일로 내보냈어요. ${fileName} 이 저장됐는지 확인해 주세요.`, 'ok');
}

// 공유 창은 눌렀을 때 바로 열어야 해서, 이 함수 안에서는 기다리는 일을 하지 않습니다.
function onExport(forceDownload = false) {
  // 읽지 못한 상태나 빈 상태로 내보내면 빈 파일을 진짜 백업으로 착각할 수 있어요.
  if (itemsUnreadable) {
    backupSay('저장된 매물을 읽지 못해서 내보낼 수 없어요. 캡처를 Claude에게 보내 주세요.', 'fail');
    return;
  }
  if (items.length === 0 && categories.length === 0) {
    backupSay('아직 내보낼 매물이 없어요.');
    return;
  }
  try {
    const { fileName, text } = buildBackup({ listings: items, categories, now: new Date() });
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
    navigator.share({ files: [file] }).then(() => {
      exported();
      backupSay(`보냈어요. 매물 ${items.length}개가 파일에 들어 있어요.`, 'ok');
    }).catch((e) => {
      const name = e?.name || String(e);
      if (name === 'AbortError') { // 카톡이 보낸 뒤에도 이렇게 알릴 수 있어서 실패로 단정하지 않습니다.
        backupSay('공유 창이 닫혔어요. 파일이 카톡에 안 갔으면 다시 눌러 주세요.');
      } else if (name === 'NotAllowedError' && shareRefused === 0) {
        shareRefused += 1;
        backupSay('한 번 더 눌러 주세요.');
      } else if (name === 'InvalidStateError') {
        backupSay('공유 창이 안 보이면 앱을 닫았다 다시 열어 주세요.');
      } else {
        backupSay(exportFailMessage(name), 'fail');
      }
    });
  } catch (e) {
    backupSay(exportFailMessage(e?.name || String(e)), 'fail');
  }
}

function replaceAll(listings, cats) {
  const r1 = listingStore.save(listings);
  if (!r1.ok) return r1;
  const r2 = categoryStore.save(cats);
  if (!r2.ok) {
    listingStore.save(items); // 분류 저장이 실패하면 매물도 원래대로 돌립니다.
    return r2;
  }
  items = listings;
  categories = cats;
  mapFilter = null;
  dateMode = 'new';
  pickedDate = null;
  renderCategoryUi();
  return { ok: true };
}

function applyImport(r) {
  // 교체 전 내용과 백업 기록을 먼저 남깁니다. 여기서 실패하면 교체하지 않습니다.
  const prevSnap = store.read('before-import');
  const { lastBackupAt, dirtySince, pending } = backupMeta;
  const snap = store.write('before-import', { listings: items, categories, at: new Date().toISOString(), backup: { lastBackupAt, dirtySince, pending } });
  if (!snap.ok) {
    backupSay(saveErrorMessage(snap.reason, snap.detail), 'fail', 'importMsg');
    return;
  }
  if (itemsUnreadable) {
    // 읽지 못하던 값은 사용자가 바꾸기를 눌렀으니 덮습니다.
    listingStore.unblock();
    categoryStore.unblock();
  }
  const done = replaceAll(r.listings, r.categories);
  if (!done.ok) {
    // 가져오지 못했으니 되돌리기 자료와, 읽지 못하던 값을 지키는 잠금을 전으로 돌립니다.
    store.write('before-import', prevSnap.ok ? prevSnap.data : null);
    if (itemsUnreadable) {
      listingStore.load();
      categoryStore.load();
    }
    renderBackupInfo();
    backupSay(saveErrorMessage(done.reason, done.detail), 'fail', 'importMsg');
    return;
  }
  if (itemsUnreadable) {
    itemsUnreadable = false;
    $('loadMsg').hidden = true;
    $('addBtn').disabled = false;
    $('toast').hidden = true;
    window.__hideReload?.();
  }
  // 지금 내용이 파일과 같아졌으니 백업 안 한 변경이 없습니다.
  backupMeta.dirtySince = null;
  backupMeta.pending = 0;
  saveBackupMeta();
  backupSay($('backupScreen').hidden
    ? `매물 ${r.listings.length}개를 가져왔어요.`
    : `매물 ${r.listings.length}개, 분류 ${r.categories.length}개를 가져왔어요. 잘못 골랐으면 '되돌리기'를 눌러 주세요.`, 'ok', 'importMsg');
}

async function onImportPicked(ev) {
  const input = ev.target;
  try {
    const file = input.files?.[0];
    if (!file) return;
    const r = await readBackupFile(file);
    if (!r.ok) {
      backupSay(importErrorMessage(r.reason, r.detail), 'fail', 'importMsg');
      return;
    }
    if (items.length === 0 && categories.length === 0 && !itemsUnreadable) {
      applyImport(r); // 지킬 내용이 없으면 묻지 않습니다.
      return;
    }
    const when = r.exportedAt ? formatBackupTime(r.exportedAt) : '';
    const lines = [
      `파일: 매물 ${r.listings.length}개, 분류 ${r.categories.length}개${when ? ` (${when} 백업)` : ''}`,
      itemsUnreadable ? '지금: 저장된 매물을 읽지 못하는 상태예요. 바꾸면 그 값은 사라져요.' : `지금: 매물 ${items.length}개, 분류 ${categories.length}개`,
      '지금 내용을 파일 내용으로 바꿀까요?',
    ];
    askConfirm(lines.join('\n'), '바꾸기', '취소', () => applyImport(r));
  } catch (e) {
    backupSay(importErrorMessage('read-failed', e?.name || String(e)), 'fail', 'importMsg');
  } finally {
    input.value = ''; // 같은 파일을 다시 고를 수 있게 비웁니다.
  }
}

function onUndoImport() {
  const snap = store.read('before-import');
  if (!snap.ok || !snap.data?.listings) return;
  // 가져올 때 건수를 0으로 돌리므로, 지금 건수는 가져온 뒤에 바꾼 것들입니다.
  const lost = backupMeta.pending > 0 ? `\n가져온 뒤 바꾼 ${backupMeta.pending}건은 사라지고 되살릴 수 없어요.` : '';
  askConfirm(`가져오기 전 내용(매물 ${snap.data.listings.length}개)으로 되돌릴까요?${lost}`, '되돌리기', '취소', () => {
    const done = replaceAll(snap.data.listings, snap.data.categories || []);
    if (!done.ok) {
      backupSay(saveErrorMessage(done.reason, done.detail), 'fail', 'importMsg');
      return;
    }
    store.write('before-import', null); // 되돌리기는 한 번만 됩니다.
    const before = snap.data.backup;
    if (before && before.lastBackupAt === backupMeta.lastBackupAt) {
      // 가져온 뒤 백업한 적이 없으면, 백업 안 한 변경도 가져오기 전 그대로입니다.
      backupMeta.dirtySince = before.dirtySince;
      backupMeta.pending = before.pending;
      saveBackupMeta();
    } else {
      markChanged(); // 그 뒤에 만든 파일에는 되돌린 내용이 없으니 바뀐 것으로 칩니다.
    }
    backupSay('가져오기 전 내용으로 되돌렸어요.', 'ok', 'importMsg');
  });
}

function checkReminder() {
  if (PLACE !== 'app') return;
  if (!needsReminder({ count: items.length, dirtySince: backupMeta.dirtySince, lastBackupAt: backupMeta.lastBackupAt, now: new Date() })) return;
  $('nudgeText').textContent = `${REMIND_DAYS}일 넘게 백업하지 않았고, 바뀐 내용이 ${backupMeta.pending}건 있어요. 폰을 잃거나 바꾸면 되살릴 수 없어요.`;
  $('backupNudge').hidden = false;
}

function openBackupScreen() {
  $('backupNudge').hidden = true;
  setTab('settings');
  $('toast').hidden = true;
  $('backupMsg').hidden = true;
  $('importMsg').hidden = true;
  renderBackupInfo();
  $('backupScreen').hidden = false;
}

// 저장할 때마다 백업을 권합니다. 처음 한 번은 왜 필요한지도 알립니다.
function announceSaved() {
  if (PLACE !== 'app') {
    toast('저장했어요.');
    return;
  }
  const why = backupMeta.introSeen
    ? `백업하지 않은 변경이 ${backupMeta.pending}건 있어요.`
    : '이 앱은 이 폰에만 저장돼요. 폰을 잃거나 바꾸면 되살릴 수 없어요. 백업 파일을 카톡 나와의 채팅으로 보내 두세요.';
  backupMeta.introSeen = true;
  saveBackupMeta();
  askConfirm(`저장했어요.\n${why}`, '지금 백업하기', '닫기', openBackupScreen, { recommend: true });
}

// ---------- 하단 탭 ----------
let tab = 'map';

function setTab(next) {
  tab = next;
  $('app').dataset.tab = next;
  $('barTitle').textContent = { map: '약국 임장노트', list: '내 매물', settings: '설정' }[next];
  for (const b of $('tabbar').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.tab === next));
  }
  $('toast').hidden = true;
  $('backupNudge').hidden = true;
  // 숨겨 둔 지도는 크기를 모르므로 돌아올 때 다시 맞춥니다.
  if (next === 'map') map?.relayout();
}

// ---------- 새 버전 자동 적용 ----------
const busy = () => !$('backupScreen').hidden || !$('calModal').hidden || !$('formScreen').hidden || !$('detailScreen').hidden || !$('catScreen').hidden || !$('catModal').hidden || !$('modal').hidden || picking;

async function checkForUpdate() {
  if (busy()) return; // 입력하거나 보고 있는 중에는 건드리지 않습니다.
  try {
    const r = await fetch(location.pathname, { cache: 'reload' });
    if (!r.ok) return;
    const remote = parseAppVersion(await r.text());
    if (!remote || remote === VERSION || busy()) return;
    // 같은 버전으로 여러 번 다시 읽지 않습니다(옛 파일이 잠시 남아 있어도 무한 반복 방지).
    if (sessionStorage.getItem('imjang-map:reloaded-for') === remote) return;
    sessionStorage.setItem('imjang-map:reloaded-for', remote);
    location.reload();
  } catch { /* 신호가 없으면 다음에 확인합니다 */ }
}

// ---------- 시작 ----------
function showPlaceNotice() {
  if (PLACE === 'app') return;
  // 저장 공간이 달라서, 아이콘이 아닌 곳에 저장한 내용은 아이콘에서 보이지 않습니다.
  const text = PLACE === 'kakao' ? kakaoInappMessage(navigator.userAgent) : standaloneHelp(PLACE);
  $('placeHelp').textContent = text;
  $('placeNotice').hidden = false;
  $('noticeClose').addEventListener('click', () => { $('placeNotice').hidden = true; });
}

function loadItems() {
  const r = listingStore.load();
  if (r.ok) {
    items = r.items;
    return;
  }
  // 읽지 못하면 덮어쓰지 않도록 추가·저장을 막고 알립니다.
  itemsUnreadable = true;
  const el = $('loadMsg');
  el.textContent = loadErrorMessage(r.reason, r.detail);
  el.hidden = false;
  $('addBtn').disabled = true;
  window.__showReload?.(el.textContent); // 처음 화면이 지도라 목록의 안내만으로는 안 보입니다.
}

$('ver').textContent = VERSION;
$('searchForm').addEventListener('submit', onSearch);
$('q').addEventListener('input', () => { $('qClear').hidden = !$('q').value; });
$('qClear').addEventListener('click', onClearSearch);
$('locate').addEventListener('click', onLocate);
for (const b of $('tabbar').querySelectorAll('button')) {
  b.addEventListener('click', () => setTab(b.dataset.tab));
}
$('pinClose').addEventListener('click', hidePinCard);
$('pinOpen').addEventListener('click', () => {
  const id = pinId;
  hidePinCard();
  openDetail(id);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});
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
  setTab('map');
  if (item) moveMapTo(item.lat, item.lng);
});
$('deleteBtn').addEventListener('click', () => {
  askConfirm('이 매물을 삭제할까요? 되돌릴 수 없어요.', '삭제', '취소', onDeleteConfirmed);
});
window.addEventListener('resize', () => map?.relayout());

const savedView = store.read('view');
if (savedView.ok && ['date', 'region', 'category'].includes(savedView.data)) view = savedView.data;
const savedOrder = store.read('dateOrder');
if (savedOrder.ok && savedOrder.data === 'old') dateMode = 'old';
$('orderNew').addEventListener('click', () => setDateOrder('new'));
$('orderOld').addEventListener('click', () => setDateOrder('old'));
$('datePick').addEventListener('click', () => {
  setSortMenu(false);
  openCalendar();
});
$('sortBtn').addEventListener('click', (ev) => {
  ev.stopPropagation(); // 아래의 '바깥을 누르면 닫기'가 바로 닫지 않게
  setSortMenu($('sortMenu').hidden);
});
document.addEventListener('click', (ev) => {
  if (!$('sortMenu').hidden && !$('sortMenu').contains(ev.target)) setSortMenu(false);
});
$('calClose').addEventListener('click', () => { $('calModal').hidden = true; });
$('calPrev').addEventListener('click', () => moveCalendar(-1));
$('calNext').addEventListener('click', () => moveCalendar(1));
for (const tab of $('viewTabs').querySelectorAll('button')) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
}

$('backupOpen').addEventListener('click', openBackupScreen);
$('backupClose').addEventListener('click', () => { $('backupScreen').hidden = true; });
$('exportBtn').addEventListener('click', () => onExport());
$('downloadBtn').addEventListener('click', () => onExport(true));
$('importFile').addEventListener('change', onImportPicked);
$('undoImport').addEventListener('click', onUndoImport);
$('nudgeLater').addEventListener('click', () => { $('backupNudge').hidden = true; });
$('nudgeGo').addEventListener('click', openBackupScreen);
$('catManage').addEventListener('click', () => { $('catScreen').hidden = false; });
$('catScreenClose').addEventListener('click', () => { $('catScreen').hidden = true; });
$('catAdd').addEventListener('click', () => openCatModal(null));
$('catCancel').addEventListener('click', () => { $('catModal').hidden = true; });
$('catSave').addEventListener('click', onSaveCategory);
$('catName').addEventListener('input', () => { $('catError').hidden = true; });
$('catName').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    onSaveCategory();
  }
});

buildForm();
loadItems();
const loadedCats = categoryStore.load();
if (loadedCats.ok) categories = loadedCats.items;
// 폰 시험을 처음부터 다시 하려고 백업 기록만 한 번 지웁니다(2026-11-05 사용자 요청). 매물과 분류는 건드리지 않습니다. 다음 배포에서 뺍니다.
// 되돌리기 자료는 지금 내용과 같을 때만 지웁니다. 다르면 그 안에만 있는 매물이 있을 수 있어요.
if (!itemsUnreadable && loadedCats.ok && !store.read('retest-1105h').data && store.write('retest-1105h', true).ok) {
  store.write('backup-meta', null);
  const kept = store.read('before-import');
  if (kept.ok && JSON.stringify(kept.data?.listings) === JSON.stringify(items) && JSON.stringify(kept.data?.categories || []) === JSON.stringify(categories)) {
    store.write('before-import', null);
  }
}
const savedMeta = store.read('backup-meta');
if (savedMeta.ok && savedMeta.data) backupMeta = { ...backupMeta, ...savedMeta.data };
else if (items.length > 0) { // 백업 기능이 생기기 전부터 있던 매물
  backupMeta.pending = items.length;
  backupMeta.dirtySince = new Date().toISOString();
  saveBackupMeta();
}
renderBackupInfo();
checkReminder();
askPersist();
showPlaceNotice();
renderCategoryUi();
renderDraftLocation();
renderLocationTools();
initMap();

checkForUpdate();

window.__appStarted = true;
window.__onAppStarted?.();
