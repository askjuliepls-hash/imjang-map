// 대행 검증: 아이폰 크기 화면에서 앱을 자동으로 조작하고 캡처합니다.
// 진짜 카카오 대신 tests/e2e/mocks 의 가짜를 끼워 넣습니다.
// 사용법: npm run preview -- [캡처 저장 폴더]
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = resolve(process.argv[2] || join(ROOT, 'tests/e2e/shots'));
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/imjang-map/`;
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
// 아이폰 사파리에서 주소창·도구막대를 뺀 실제 보이는 높이에 가깝게 잡습니다.
const PHONE = { width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const results = [];
function expect(scenario, what, ok, detail = '') {
  results.push({ scenario, what, ok: !!ok, detail });
}

// ---------- 정적 서버 (GitHub Pages처럼 /imjang-map/ 아래에서 제공) ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (!url.pathname.startsWith('/imjang-map/')) { res.writeHead(404); res.end(); return; }
  let rel = decodeURIComponent(url.pathname.slice('/imjang-map/'.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

const mocks = {
  kakao: await readFile(join(ROOT, 'tests/e2e/mocks/kakao-sdk.js'), 'utf8'),
  config: await readFile(join(ROOT, 'tests/e2e/mocks/config.js'), 'utf8'),
  configEmpty: await readFile(join(ROOT, 'tests/e2e/mocks/config-empty.js'), 'utf8'),
};

// 다른 시나리오의 클릭을 가리지 않게 첫 안내와 백업 알림을 끕니다. 시험할 때는 mode.realNudge를 켭니다.
const quietNudge = () => {
  try {
    const k = 'imjang-map:backup-meta';
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ schemaVersion: 1, data: { lastBackupAt: null, dirtySince: null, pending: 0, introSeen: true } }));
  } catch { /* about:blank */ }
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '#backupNudge{display:none!important}';
    document.head.append(s);
  });
};

const interceptFor = (mode, requests = []) => (req) => {
  const u = new URL(req.url());
  requests.push(u.pathname + u.search);
  if (mode.remote?.on && req.resourceType() === 'fetch' && u.pathname === '/imjang-map/') {
    return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<meta name="app-version" content="9.9.9-new">' });
  }
  if (mode.abort && mode.abort.test(u.pathname)) return req.abort();
  const js = (body) => req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  if (u.hostname === 'dapi.kakao.com') {
    if (mode.kakao === 'mock') return js(mocks.kakao);
    if (mode.kakao === '503') return req.respond({ status: 503, contentType: 'text/plain', body: 'domain not registered' });
    return req.abort();
  }
  if (u.origin === ORIGIN && u.pathname.endsWith('/js/config.js') && mode.config === 'mock') return js(mocks.config);
  if (u.origin === ORIGIN && u.pathname.endsWith('/js/config.js') && mode.config === 'empty') return js(mocks.configEmpty);
  if (u.origin === ORIGIN && u.pathname.endsWith('/js/config.js') && mode.config === 'broken') return js('export const NOT_THE_KEY = 1;');
  if (u.origin !== ORIGIN) return req.abort();
  return req.continue();
};

// mode: kakao 'mock' | '503' | 'block', config 'mock' | 'empty' | 'real' | 'broken',
//       abort 요청 경로에 대한 정규식(모듈 실패 흉내), init 페이지마다 먼저 실행할 함수(들), ua, viewport
async function openPage(browser, mode, scenario) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(ORIGIN, ['geolocation']);
  const page = await context.newPage();
  await page.setUserAgent(mode.ua || IPHONE_UA);
  await page.setViewport(mode.viewport || PHONE);
  await page.setGeolocation({ latitude: 37.5668, longitude: 126.9786, accuracy: 24 });
  if (!mode.realNudge) await page.evaluateOnNewDocument(quietNudge);
  for (const f of [].concat(mode.init || [])) await page.evaluateOnNewDocument(f);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const requests = [];
  await page.setRequestInterception(true);
  page.on('request', interceptFor(mode, requests));
  return { context, page, errors, requests, scenario };
}

async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const visibleInputs = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null);
    const small = visibleInputs.filter((i) => parseFloat(getComputedStyle(i).fontSize) < 16).map((i) => i.id);
    const clipped = [...document.querySelectorAll('.listing strong, .btn, .fill-btn, .score, .results strong, .results span, .fab, .form-msg, .next-help, .row p, .list-head span, .view-tabs button, .listing .meta, .fact, .side, .set-label, .set-note, .set-value, #barTitle')]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}:${el.textContent.trim().slice(0, 16)}`);
    const de = document.documentElement;
    return { overflowX: de.scrollWidth > vw + 1, overflowY: de.scrollHeight > window.innerHeight + 1, docHeight: de.scrollHeight, small, clipped };
  });
}

async function layoutExpect(page, scenario) {
  const l = await layout(page);
  expect(scenario, '가로 스크롤 없음', !l.overflowX);
  // 재발 방지(2026-11-05): 시트 안의 화면 밖 글자가 문서 전체를 늘려 페이지가 통째로 밀리던 문제
  expect(scenario, '세로 문서 스크롤 없음', !l.overflowY, `문서 높이 ${l.docHeight}`);
  expect(scenario, '입력칸 글씨 16px 이상(아이폰 확대 방지)', l.small.length === 0, l.small.join(', '));
  expect(scenario, '잘린 글자 없음', l.clipped.length === 0, l.clipped.join(' | '));
}

// 재발 방지(2026-11-05): 로그인·저장 버튼이 점검 목록 아래에 숨어 스크롤해야 보이던 문제
// 재발 방지(2026-11-05): 창 안에 있어도 시트 스크롤 영역에 잘려 안 보이는 경우까지 잡습니다.
const inView = (page, sel) => page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  if (r.height <= 0 || r.top < 0 || r.bottom > window.innerHeight) return false;
  const box = el.closest('.sheet-body');
  if (!box) return true;
  const b = box.getBoundingClientRect();
  return r.top >= b.top && r.bottom <= b.bottom;
});

const inViewSoon = async (page, sel) => {
  await new Promise((r) => setTimeout(r, 120)); // scrollIntoView가 다음 프레임에 일어납니다.
  return inView(page, sel);
};

// 시나리오 하나가 죽어도 나머지를 돌리고 요약을 남깁니다.
async function scenario(name, fn) {
  try {
    await fn(name);
  } catch (e) {
    expect(name, '시나리오가 끝까지 실행됨', false, String(e?.message || e));
  }
}

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

const asApp = () => Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
const stored = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('imjang-map:listings');
  return raw ? JSON.parse(raw).data.items : [];
});
const visible = (page, sel) => page.$eval(sel, (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, sel) => page.$eval(sel, (el) => el.textContent);
// 가짜 공유 창: 받은 파일을 그대로 적어 둡니다. window.__shareMode로 거절·취소를 흉내 냅니다.
const fakeShare = () => {
  window.__shared = [];
  navigator.canShare = () => window.__canShare !== false;
  navigator.share = async (d) => {
    if (window.__shareMode) throw new DOMException('fake', window.__shareMode);
    const f = d.files[0];
    window.__shared.push({ keys: Object.keys(d), name: f.name, type: f.type, text: await f.text() });
  };
};
// 내려받기를 가로채 파일 내용을 확인합니다.
const hookDownload = () => {
  window.__downloads = [];
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__lastBlob = b; return create(b); };
  HTMLAnchorElement.prototype.click = function click() { window.__downloads.push({ name: this.download, blob: window.__lastBlob }); };
};
const lastDownload = (page) => page.evaluate(async () => {
  const d = window.__downloads.at(-1);
  if (!d) return null;
  const b = new Uint8Array(await d.blob.arrayBuffer());
  return { name: d.name, first: b[0], text: new TextDecoder().decode(b) };
});
const lastShared = (page) => page.evaluate(() => window.__shared.at(-1) || null);
let fileNo = 0;
async function pickFile(page, content, sel = '#importLabel') {
  fileNo += 1;
  const path = join(OUT, `pick-${fileNo}.json`);
  await writeFile(path, content);
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click(sel)]);
  await chooser.accept([path]);
  await new Promise((r) => setTimeout(r, 200));
}
const goTab = (page, name) => page.click(`#tabbar [data-tab="${name}"]`);
const openFirst = async (page) => {
  await goTab(page, 'list');
  await page.click('#list button');
};
const appReady = (page) => page.waitForFunction(() => window.__appStarted === true, { timeout: 6000 });

async function fillAndSave(page, fields) {
  await page.click('#addBtn');
  for (const [k, v] of Object.entries(fields)) await page.type(`#f-${k}`, v);
  await page.click('#saveListing');
  await wait(80);
}

await mkdir(OUT, { recursive: true });
await new Promise((r) => server.listen(PORT, r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });

try {
  // A. 처음 열었을 때와 양식
  await scenario('A 처음 화면', async (s) => {
    const { context, page, errors, requests } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    expect(s, '점검 화면이 없음', !(await page.$('[data-check]')) && !(await page.$('#next')));
    await goTab(page, 'list');
    expect(s, '매물 목록 탭은 화면 전체', await visible(page, '#sheet') && !(await visible(page, '#map')));
    expect(s, '빈 목록 안내가 보임', await visible(page, '#empty'));
    expect(s, '탭 이름이 지도·매물 목록·설정', (await text(page, '#tabbar')).replace(/\s+/g, '') === '지도매물목록설정');
    await shot(page, 'a-list-empty');
    await goTab(page, 'settings');
    expect(s, '설정에 기호 없이 분류 설명이 있음', !(await page.$('#settingsPanel svg')) && (await text(page, '#catManage')).includes('지도 핀 색'));
    expect(s, '설정에 앱 다시 불러오기가 없음', !(await text(page, '#settingsPanel')).includes('다시 불러오기') && !(await visible(page, '#topReload')) && !(await visible(page, '#addBtn')));
    await shot(page, 'a-settings');
    await goTab(page, 'map');
    expect(s, '평소에는 다시 불러오기가 안 보임', !(await visible(page, '#topReload')));
    expect(s, '매물 추가 버튼이 스크롤 없이 보임', await inView(page, '#addBtn'));
    // 재발 방지(2026-11-05): 매물 추가 버튼이 왼쪽 아래 카카오 로고 자리를 가리던 문제
    const logoClear = await page.evaluate(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const logo = { left: stage.left, right: stage.left + 140, top: stage.bottom - 40, bottom: stage.bottom };
      return ['#addBtn', '#locate'].every((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return r.right <= logo.left || r.left >= logo.right || r.bottom <= logo.top || r.top >= logo.bottom;
      });
    });
    expect(s, '떠 있는 버튼이 카카오 로고 자리를 가리지 않음', logoClear);
    const addStyle = await page.$eval('#addBtn', (el) => getComputedStyle(el).backgroundColor);
    expect(s, '작은 버튼은 주황으로 채움', addStyle === 'rgb(249, 105, 73)', addStyle);
    const appVersion = (await readFile(join(ROOT, 'index.html'), 'utf8')).match(/name="app-version" content="([^"]+)"/)[1];
    expect(s, '버전 표시', (await text(page, '#ver')) === appVersion, appVersion);
    const versioned = requests.filter((r) => /\/js\/(config|lib\/)/.test(r));
    expect(s, '쓰이는 모듈이 모두 버전 꼬리표(?v=)로 요청됨(캐시 방지)', versioned.length >= 1 && versioned.every((r) => r.includes('?v=')), versioned.join(' '));
    await layoutExpect(page, s);
    await shot(page, 'a-empty');
    await page.click('#addBtn');
    expect(s, '양식이 열림', await visible(page, '#formScreen'));
    const saveStyle = await page.$eval('#saveListing', (el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, ring: c.boxShadow }; });
    expect(s, '큰 버튼은 테두리만', saveStyle.bg === 'rgba(0, 0, 0, 0)' && saveStyle.ring.includes('249, 105, 73'), JSON.stringify(saveStyle));
    const small = await page.evaluate(() => [...document.querySelectorAll('#formScreen input, #formScreen textarea')].filter((i) => parseFloat(getComputedStyle(i).fontSize) < 16).map((i) => i.id));
    expect(s, '양식 입력칸 글씨 16px 이상(아이폰 확대 방지)', small.length === 0, small.join(','));
    await shot(page, 'a-form-top');
    await page.click('#saveListing');
    expect(s, '매물명이 없으면 저장 안 되고 칸 아래 안내가 보임', await visible(page, '#nameError') && await inViewSoon(page, '#nameError') && (await stored(page)).length === 0);
    await page.type('#f-name', '가');
    expect(s, '입력하면 안내가 사라짐', !(await visible(page, '#nameError')));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // B. 등록 → 목록 → 상세 → 수정 → 삭제, 다시 열어도 유지
  await scenario('B 저장 흐름', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await page.click('#addBtn');
    await page.type('#f-name', '○○병원 앞 약국 "임대" ☕');
    await page.type('#f-region', '서울 중구');
    await page.type('#f-deposit', '5000');
    await page.type('#f-rent', '300');
    await page.type('#f-premium', '15000');
    expect(s, '권리금 입력 중 억 단위로 보임', (await text(page, '#h-premium')) === '1억 5,000만원');
    await page.type('#f-areaExclusive', '33');
    expect(s, '㎡를 적으면 평이 채워짐', (await page.$eval('#p-areaExclusive', (el) => el.value)) === '10.0');
    await page.type('#p-areaSupply', '25');
    expect(s, '평을 적으면 ㎡가 채워짐', (await page.$eval('#f-areaSupply', (el) => el.value)) === '82.65');
    await page.type('#f-dispensing', '신규');
    await page.type('#f-review', '<b>유동인구</b> 많음\n둘째 줄');
    await shot(page, 'b-form-filled');
    expect(s, '예상 순수익 칸에 안내 글자가 없음', (await page.$eval('#f-netProfit', (el) => el.placeholder)) === '' && (await page.$eval('#f-dispensing', (el) => el.placeholder)).includes('신규'));
    await page.click('#saveListing');
    await wait(80);
    expect(s, '저장하면 양식이 닫힘', !(await visible(page, '#formScreen')));
    expect(s, '저장 안내가 보임', await visible(page, '#toast') && (await text(page, '#toast')).includes('저장'));
    expect(s, '목록에 한 줄 생김', (await text(page, '#list')).includes('○○병원') && (await text(page, '#count')) === '총 1개');
    expect(s, '목록에 위치 없음 표시', (await text(page, '#list')).includes('위치 없음') && (await text(page, '#list')).includes('1억 5,000만원'));
    await shot(page, 'b-list');
    await page.reload({ waitUntil: 'load' });
    await appReady(page);
    expect(s, '다시 읽어도 남아 있음', (await text(page, '#list')).includes('○○병원'));
    const page2 = await context.newPage();
    await page2.setUserAgent(IPHONE_UA);
    await page2.setViewport(PHONE);
    await page2.evaluateOnNewDocument(asApp);
    await page2.setRequestInterception(true);
    page2.on('request', interceptFor({ kakao: 'mock', config: 'mock' }));
    await page.close();
    await page2.goto(BASE, { waitUntil: 'load' });
    await appReady(page2);
    expect(s, '새로 열어도 남아 있음', (await text(page2, '#list')).includes('○○병원'));
    await openFirst(page2);
    expect(s, '상세가 열림', await visible(page2, '#detailScreen'));
    expect(s, '금액과 평이 읽기 쉽게 보임', (await text(page2, '#detailBody')).includes('1억 5,000만원') && (await text(page2, '#detailBody')).includes('33㎡ (약 10.0평)') && (await text(page2, '#detailBody')).includes('신규'));
    expect(s, '입력한 글자를 태그로 해석하지 않음', (await text(page2, '#detailBody')).includes('<b>유동인구</b>') && !(await page2.$('#detailBody b')));
    await layoutExpect(page2, s);
    await shot(page2, 'b-detail');
    await page2.click('#editBtn');
    expect(s, '수정 양식에 값이 채워짐', (await page2.$eval('#f-premium', (el) => el.value)) === '15000' && (await text(page2, '#h-premium')) === '1억 5,000만원');
    expect(s, '수정 양식에 평도 채워짐', (await page2.$eval('#p-areaSupply', (el) => el.value)) === '25.0');
    await page2.$eval('#f-premium', (el) => { el.value = ''; });
    await page2.type('#f-premium', '20000');
    await page2.click('#saveListing');
    await wait(80);
    const after = await stored(page2);
    expect(s, '수정해도 한 개이고 등록일이 그대로', after.length === 1 && after[0].premium === '20000' && after[0].createdAt <= after[0].updatedAt);
    await openFirst(page2);
    await page2.click('#deleteBtn');
    expect(s, '삭제는 창으로 한 번 더 확인함', await visible(page2, '#modal') && await inView(page2, '#modalYes') && (await stored(page2)).length === 1);
    await page2.click('#modalNo');
    expect(s, '취소하면 그대로', !(await visible(page2, '#modal')) && (await stored(page2)).length === 1);
    await page2.click('#deleteBtn');
    await shot(page2, 'b-delete-confirm');
    await page2.click('#modalYes');
    await wait(50);
    expect(s, '삭제하면 사라짐', (await stored(page2)).length === 0 && await visible(page2, '#empty'));
    expect(s, '목록 탭에서도 매물 추가 버튼이 보임', await inView(page2, '#addBtn'));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // C. 위치 찍기 세 가지와 지도 핀
  await scenario('C 위치와 핀', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await page.waitForSelector('#locSearchBtn:not([disabled])', { timeout: 3000 });
    // 1) 장소 검색
    await page.click('#addBtn');
    await page.type('#f-name', '검색으로 찍은 약국');
    await page.type('#locQ', '테스트 장소');
    await page.keyboard.press('Enter');
    await wait(180);
    expect(s, '검색칸의 엔터로 저장되지 않음', (await stored(page)).length === 0 && await visible(page, '#formScreen'));
    expect(s, '장소 결과가 보임', await visible(page, '#locResults'));
    await shot(page, 'c-form-search');
    await page.click('#locResults button');
    expect(s, '장소를 고르면 위치가 찍힘', (await text(page, '#locState')).includes('테스트 장소 A'));
    expect(s, '장소를 고르면 주소가 채워짐', (await page.$eval('#f-address', (el) => el.value)) === '테스트시 테스트구 가짜로 1');
    expect(s, '주소를 고르면 검색 칸 대신 주소와 X가 보임', !(await visible(page, '#locQ')) && await visible(page, '#f-address') && await visible(page, '#locClear'));
    await shot(page, 'c-form-chosen');
    const regionBefore = await page.$eval('#f-region', (el) => el.value);
    await page.click('#locClear');
    expect(s, 'X를 누르면 주소와 자동 지역이 지워지고 검색 칸이 보임', (await page.$eval('#f-address', (el) => el.value)) === '' && (await page.$eval('#f-region', (el) => el.value)) === '' && regionBefore !== '' && await visible(page, '#locQ'));
    await page.type('#locQ', '테스트 장소');
    await page.keyboard.press('Enter');
    await wait(180);
    await page.click('#locResults button');
    await page.click('#saveListing');
    await wait(80);
    let list = await stored(page);
    expect(s, '장소 검색 위치 저장', list.length === 1 && list[0].lat === 37.5672 && list[0].lng === 126.98, JSON.stringify(list[0]));
    expect(s, '지도에 핀이 생김', (await page.$$('.mock-marker')).length === 1);
    // 2) 현재 위치
    await page.click('#addBtn');
    await page.type('#f-name', '현재 위치로 찍은 약국');
    await page.click('#locHereBtn');
    await wait(150);
    expect(s, '현재 위치가 찍힘', (await text(page, '#locState')).includes('오차 약 24m'));
    expect(s, '현재 위치의 주소가 채워짐', (await page.$eval('#f-address', (el) => el.value)) === '경기도 성남시 중원구 가짜대로 10' && (await page.$eval('#f-region', (el) => el.value)) === '경기 성남시 중원구');
    await page.click('#saveListing');
    await wait(80);
    list = await stored(page);
    expect(s, '현재 위치 저장', list.length === 2 && list.some((x) => x.lat === 37.5668));
    // 3) 지도에서 고르기
    await page.click('#addBtn');
    await page.type('#f-name', '지도에서 찍은 약국');
    await page.click('#locMapBtn');
    expect(s, '고르는 동안 양식이 내려가고 안내가 보임', !(await visible(page, '#formScreen')) && await visible(page, '#pickBar'));
    expect(s, '아직 안 눌렀으면 확인 버튼이 잠김', await page.$eval('#pickOk', (el) => el.disabled));
    await page.mouse.click(120, 200);
    await wait(60);
    expect(s, '지도를 누르면 표시되고 확인 가능', await page.$eval('#pickOk', (el) => !el.disabled) && !!(await page.$('#pickDot')));
    expect(s, '지도를 누르면 그 주소가 바로 보임', (await text(page, '#pickText')).includes('가짜대로 10'));
    const pickClear = await page.evaluate(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      return document.getElementById('pickBar').getBoundingClientRect().bottom <= stage.bottom - 40;
    });
    expect(s, '위치 고르기 안내가 카카오 로고 자리를 가리지 않음', pickClear);
    await shot(page, 'c-pick');
    await page.click('#pickOk');
    expect(s, '확인하면 입력하던 양식으로 돌아옴', await visible(page, '#formScreen') && (await page.$eval('#f-name', (el) => el.value)).includes('지도에서'));
    // 재발 방지(2026-11-05): 지도에서 찍으면 좌표만 남고 주소가 매물 정보에 안 들어가던 문제
    expect(s, '지도에서 고른 주소와 지역이 양식에 들어감', (await page.$eval('#f-address', (el) => el.value)) === '경기도 성남시 중원구 가짜대로 10' && (await page.$eval('#f-region', (el) => el.value)) === '경기 성남시 중원구');
    await page.click('#saveListing');
    await wait(80);
    list = await stored(page);
    expect(s, '지도에서 고른 위치 저장', list.length === 3 && list.every((x) => Number.isFinite(x.lat)));
    expect(s, '지도에서 고른 주소도 저장', list[2].address === '경기도 성남시 중원구 가짜대로 10');
    expect(s, '핀이 세 개', (await page.$$('.mock-marker')).length === 3);
    await shot(page, 'c-pins');
    // 핀 → 상세
    await page.evaluate(() => document.querySelector('.mock-marker').click());
    expect(s, '핀을 누르면 지도를 둔 채 요약 카드가 보임', await visible(page, '#pinCard') && await inView(page, '#pinOpen') && !(await visible(page, '#detailScreen')));
    expect(s, '핀 카드 이름 아래에 지역이 보임', (await text(page, '#pinMeta')).length > 0 && (await page.$eval('#pinName', (a) => a.getBoundingClientRect().bottom)) <= (await page.$eval('#pinMeta', (a) => a.getBoundingClientRect().top)) + 1);
    await shot(page, 'c-pin-card');
    await page.click('#pinClose');
    expect(s, '카드를 닫으면 매물 추가가 돌아옴', !(await visible(page, '#pinCard')) && await visible(page, '#addBtn'));
    await page.evaluate(() => document.querySelector('.mock-marker').click());
    await page.click('#pinOpen');
    expect(s, '자세히 보기로 상세가 열림', await visible(page, '#detailScreen'));
    expect(s, '상세에 주소가 보임', (await text(page, '#detailBody')).includes('주소'));
    await page.click('#mapViewBtn');
    expect(s, '지도에서 보기로 돌아옴', !(await visible(page, '#detailScreen')) && await visible(page, '#map'));
    // 목록 탭에서 양식을 열어 지도에서 고르면 다시 목록으로 돌아옵니다.
    await goTab(page, 'list');
    await page.click('#addBtn');
    await page.click('#locMapBtn');
    expect(s, '목록에서 연 양식도 지도에서 고를 수 있음', await visible(page, '#map') && await visible(page, '#pickBar') && !(await visible(page, '#tabbar')));
    await page.click('#pickCancel');
    expect(s, '고르기를 마치면 목록 탭으로 돌아옴', await visible(page, '#formScreen') && await visible(page, '#tabbar') && (await page.$eval('#app', (el) => el.dataset.tab)) === 'list');
    await page.click('#formClose');
    await goTab(page, 'map');
    // 위치 지우기 → 핀 사라짐
    await page.evaluate(() => document.querySelector('.mock-marker').click());
    await page.click('#pinOpen');
    await page.click('#editBtn');
    await page.click('#locClear');
    await page.click('#saveListing');
    await wait(80);
    expect(s, '위치를 지우면 핀이 사라지고 목록에 남음', (await page.$$('.mock-marker')).length === 2 && (await stored(page)).length === 3);
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // K. 목록 보기: 임장 날짜별, 지역별
  await scenario('K 목록 보기', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    expect(s, '매물이 없으면 보기 전환이 안 보임', !(await visible(page, '#viewTabs')));
    await page.click('#addBtn');
    const firstInput = await page.$eval('#formFields input', (el) => el.id);
    expect(s, '양식 맨 위 칸이 임장일', firstInput === 'f-visitDate', firstInput);
    await page.$eval('#f-visitDate', (el) => { el.value = '2026-11-03'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('#f-name', '날짜 있는 약국');
    await page.type('#f-netProfit', '미정');
    expect(s, '예상 순수익에 글자를 적을 수 있음', (await page.$eval('#f-netProfit', (el) => el.value)) === '미정' && (await page.$eval('#f-netProfit', (el) => el.inputMode)) !== 'numeric');
    await page.$eval('#f-netProfit', (el) => { el.value = ''; });
    await page.type('#f-netProfit', '1200');
    expect(s, '예상 순수익도 금액으로 보임', (await text(page, '#h-netProfit')) === '1,200만원');
    await page.click('#saveListing');
    await wait(80);
    await openFirst(page);
    expect(s, '상세에 예상 순수익이 보임', (await text(page, '#detailBody')).includes('예상 순수익(월)') && (await text(page, '#detailBody')).includes('1,200만원'));
    await page.click('#detailClose');
    await page.evaluate(() => {
      const mk = (id, name, visitDate, region, address = '') => ({ id, name, visitDate, region, address, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', lat: 37.56, lng: 126.97 });
      localStorage.setItem('imjang-map:listings', JSON.stringify({ schemaVersion: 1, data: { items: [
        mk('a', '오래된 임장', '2025-03-02', '서울 중구'),
        { ...mk('b', '최근 임장', '2026-11-03', '경기 성남시 중원구'), deposit: '5000', rent: '300', premium: '15000', netProfit: '1200' },
        mk('c', '같은 날 임장', '2026-11-03', '서울 중구'),
        mk('d', '아직 안 간 곳', '', '', '경기 성남시 수정구 가짜동 2'),
        mk('e', '지역 모름', '', ''),
      ] } }));
    });
    await page.reload({ waitUntil: 'load' });
    await appReady(page);
    const heads = () => page.$$eval('#list .list-head span:first-child', (a) => a.map((x) => x.textContent));
    const dateHeads = await heads();
    expect(s, '임장 날짜별: 최근 날짜부터, 임장 전은 맨 끝', dateHeads.length === 3 && dateHeads[0].startsWith('2026년 11월 3일') && dateHeads[1].startsWith('2025년') && dateHeads[2] === '임장 전', dateHeads.join(' / '));
    await goTab(page, 'list');
    await layoutExpect(page, s);
    const order = await page.evaluate(() => [...document.querySelectorAll('#list .fact')].slice(0, 4).map((f) => f.firstChild.textContent));
    expect(s, '금액은 권리금, 보증금, 월세, 예상 순수익 순', order.join() === '권리금,보증금,월세,예상 순수익', order.join());
    const unbroken = await page.evaluate(() => [...document.querySelectorAll('#list .fact')].every((f) => f.getClientRects().length === 1 && getComputedStyle(f).whiteSpace === 'nowrap'));
    // 재발 방지(2026-11-05): '예상 / 순수익 687만원'처럼 항목 중간에서 줄이 바뀌던 문제
    expect(s, '금액 항목이 중간에서 줄바꿈되지 않음', unbroken);
    expect(s, '이름 줄 오른쪽 끝에 지역이 보임', (await page.$eval('#list .side', (el) => el.textContent)).length > 0);
    await shot(page, 'k-by-date');
    await goTab(page, 'list');
    // 재발 방지(2026-11-05): 올해 날짜에 연도가 빠져 어느 해인지 알 수 없던 문제
    expect(s, '임장 날짜에 늘 연도가 보임', (await heads()).filter((x) => x !== '임장 전').every((x) => /^\d{4}년/.test(x)), (await heads()).join(' / '));
    expect(s, '총 개수와 정렬이 한 줄에 보임', (await text(page, '#count')) === '총 5개' && (await text(page, '#sortLabel')) === '최근순' && !(await visible(page, '#sortMenu')));
    await page.click('#sortBtn');
    expect(s, '정렬을 누르면 세 가지가 스크롤 없이 보임', await inView(page, '#orderNew') && await inView(page, '#orderOld') && await inView(page, '#datePick'));
    await shot(page, 'k-sort-open');
    await page.click('#count');
    expect(s, '바깥을 누르면 드롭다운이 닫힘', !(await visible(page, '#sortMenu')));
    await page.click('#sortBtn');
    await page.click('#orderOld');
    expect(s, '고른 정렬이 버튼에 보이고 닫힘', (await text(page, '#sortLabel')) === '오래된순' && !(await visible(page, '#sortMenu')));
    const oldHeads = await heads();
    expect(s, '오래된순: 오래된 날짜부터, 임장 전은 맨 끝', oldHeads[0].startsWith('2025년') && oldHeads[2] === '임장 전', oldHeads.join(' / '));
    await page.click('#sortBtn');
    await page.click('#datePick');
    expect(s, '날짜 선택을 누르면 달력이 뜸', await visible(page, '#calModal') && await inView(page, '#calClose') && (await text(page, '#calTitle')) === '2026년 11월');
    const dayState = await page.evaluate(() => {
      const on = document.querySelector('[data-date="2026-11-03"]');
      const off = document.querySelector('[data-date="2026-11-04"]');
      return { on: !on.disabled, off: off.disabled };
    });
    expect(s, '임장한 날만 누를 수 있음', dayState.on && dayState.off, JSON.stringify(dayState));
    await shot(page, 'k-calendar');
    await page.click('#calPrev');
    expect(s, '이전 달로 넘어감', (await text(page, '#calTitle')) === '2026년 10월');
    await page.click('#calNext');
    await page.click('[data-date="2026-11-03"]');
    const pickedHeads = await heads();
    expect(s, '날짜를 고르면 그날 매물만 보임', !(await visible(page, '#calModal')) && pickedHeads.length === 1 && pickedHeads[0].startsWith('2026년 11월 3일') && (await page.$$('#list .listing')).length === 2, pickedHeads.join(' / '));
    expect(s, '고른 날짜가 버튼에 보이고 개수도 그날 기준', (await text(page, '#sortLabel')) === '2026.11.03' && (await text(page, '#count')) === '총 2개');
    await shot(page, 'k-date-picked');
    await page.click('#sortBtn');
    await page.click('#orderNew');
    expect(s, '최근순을 누르면 전체로 돌아옴', (await heads()).length === 3 && (await text(page, '#sortLabel')) === '최근순' && (await text(page, '#count')) === '총 5개');
    await page.click('#viewTabs [data-view="region"]');
    expect(s, '다른 보기에서는 정렬이 안 보이고 총 개수는 보임', !(await visible(page, '#sortBtn')) && await visible(page, '#count'));
    const regionHeads = await heads();
    expect(s, '지역별: 가나다순, 주소로 지역을 읽고, 모르면 맨 끝', regionHeads.join() === '경기 성남시 수정구,경기 성남시 중원구,서울 중구,지역 없음', regionHeads.join(' / '));
    expect(s, '지역별 줄 오른쪽 끝에는 임장 날짜가 보임', (await page.$$eval('#list .side', (a) => a.map((x) => x.textContent))).includes('2026.11.03'));
    await shot(page, 'k-by-region');
    await page.reload({ waitUntil: 'load' });
    await appReady(page);
    expect(s, '다시 열어도 고른 보기가 유지됨', (await page.$eval('#viewTabs [data-view="region"]', (el) => el.getAttribute('aria-pressed'))) === 'true');
    await openFirst(page);
    expect(s, '묶음 안의 매물을 눌러도 상세가 열림', await visible(page, '#detailScreen'));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // L. 내 분류: 이름과 핀 색을 직접 정하고, 매물 하나에 하나씩
  await scenario('L 내 분류', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await page.waitForSelector('#locSearchBtn:not([disabled])', { timeout: 3000 });
    expect(s, '분류가 없으면 지도 칩이 안 보임', !(await visible(page, '#catChips')));
    const addPlace = async (name, chipText) => {
      await page.click('#addBtn');
      await page.type('#f-name', name);
      if (chipText) await page.evaluate((t) => [...document.querySelectorAll('#catChoices .chip')].find((b) => b.textContent === t).click(), chipText);
      await page.click('#locHereBtn');
      await wait(120);
      await page.click('#saveListing');
      await wait(80);
    };
    // 양식 안에서 새 분류 만들기
    await page.click('#addBtn');
    await page.type('#f-name', '후보 약국');
    await page.click('#catNew');
    expect(s, '양식에서 새 분류 창이 뜸', await visible(page, '#catModal') && await inView(page, '#catSave'));
    await page.click('#catSave');
    expect(s, '이름이 없으면 안내', (await text(page, '#catError')).includes('이름'));
    await page.type('#catName', '후보');
    expect(s, '이름을 적으면 안내가 사라짐', !(await visible(page, '#catError')));
    await shot(page, 'l-new-category');
    await page.click('#catSave');
    await wait(50);
    expect(s, '만든 분류가 바로 골라짐', !(await visible(page, '#catModal')) && await page.$eval('#catChoices [aria-pressed="true"]', (el) => el.textContent === '후보'));
    expect(s, '입력하던 내용이 그대로', (await page.$eval('#f-name', (el) => el.value)) === '후보 약국');
    await shot(page, 'l-form-chip');
    await page.click('#locHereBtn');
    await wait(120);
    await page.click('#saveListing');
    await wait(80);
    let list = await stored(page);
    const cats = () => page.evaluate(() => JSON.parse(localStorage.getItem('imjang-map:categories')).data.items);
    expect(s, '매물에 분류가 저장됨', list[0].categoryId === (await cats())[0].id);
    const colorOfPins = () => page.$$eval('.mock-marker', (a) => a.map((m) => decodeURIComponent(m.dataset.image || '')));
    expect(s, '핀 색이 분류 색', (await colorOfPins())[0].includes('#F96949'));
    await addPlace('분류 없는 약국');
    expect(s, '분류 없는 핀은 회색', (await colorOfPins()).some((c) => c.includes('#A9B2BC')));
    // 지도 칩으로 거르기
    expect(s, '지도에 분류 칩이 보임', await visible(page, '#catChips') && (await text(page, '#catChips')).includes('후보'));
    const noCover = await page.evaluate(() => {
      const t = document.getElementById('toast').getBoundingClientRect();
      const c = document.getElementById('catChips').getBoundingClientRect();
      return document.getElementById('toast').hidden || t.top >= c.bottom - 8;
    });
    expect(s, '저장 안내가 분류 칩을 가리지 않음', noCover);
    await shot(page, 'l-map-chips');
    await page.evaluate(() => document.querySelector('.mock-marker').click());
    expect(s, '핀 카드에 분류 이름은 안 나옴', !(await text(page, '#pinMeta')).includes('후보') && !(await text(page, '#pinFacts')).includes('후보'));
    await page.click('#pinClose');
    await page.evaluate(() => [...document.querySelectorAll('#catChips .chip')].find((b) => b.textContent === '후보').click());
    expect(s, '분류를 고르면 그 핀만 보임', (await page.$$('.mock-marker')).length === 1);
    await page.evaluate(() => [...document.querySelectorAll('#catChips .chip')].find((b) => b.textContent === '전체').click());
    expect(s, '전체를 고르면 모두 보임', (await page.$$('.mock-marker')).length === 2);
    // 분류별 보기
    await goTab(page, 'list');
    await page.click('#viewTabs [data-view="category"]');
    const heads = await page.$$eval('#list .list-head span:first-child', (a) => a.map((x) => x.textContent));
    expect(s, '분류별 보기: 분류 없음은 맨 끝', heads.join() === '후보,분류 없음', heads.join());
    await layoutExpect(page, s);
    await shot(page, 'l-by-category');
    await page.click('#viewTabs [data-view="date"]');
    expect(s, '다른 보기에서도 분류 이름이 보임', (await text(page, '#list')).includes('후보'));
    await openFirst(page);
    await page.click('#detailClose');
    // 관리: 이름·색 수정, 삭제
    await goTab(page, 'settings');
    await page.click('#catManage');
    expect(s, '설정에서 분류를 관리함', await visible(page, '#catScreen') && (await text(page, '#catList')).includes('후보 (1)'));
    await shot(page, 'l-manage');
    await page.evaluate(() => document.querySelector('#catList .text-btn').click());
    await page.$eval('#catName', (el) => { el.value = ''; });
    await page.type('#catName', '유력');
    await page.evaluate(() => document.querySelectorAll('#catSwatches .swatch')[1].click());
    await page.click('#catSave');
    await wait(50);
    expect(s, '이름과 색을 고치면 핀 색도 바뀜', (await text(page, '#catList')).includes('유력') && (await colorOfPins()).some((c) => c.includes('#3F82D9')));
    await page.evaluate(() => document.querySelector('#catList .danger').click());
    expect(s, '삭제는 창으로 묻고 매물은 남는다고 알림', await visible(page, '#modal') && (await text(page, '#modalText')).includes('지워지지 않아요'));
    await page.click('#modalYes');
    await wait(50);
    list = await stored(page);
    expect(s, '분류를 지워도 매물은 남고 분류 없음이 됨', list.length === 2 && list.every((x) => !x.categoryId) && (await cats()).length === 0);
    await page.click('#catScreenClose');
    await goTab(page, 'map');
    expect(s, '분류가 없어지면 칩도 사라지고 핀은 회색', !(await visible(page, '#catChips')) && (await colorOfPins()).every((c) => c.includes('#A9B2BC')));
    await page.reload({ waitUntil: 'load' });
    await appReady(page);
    expect(s, '다시 읽어도 유지', (await stored(page)).length === 2);
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // G. 장소 검색: 전국 순위 뒤쪽이나 근처 결과도 찾을 수 있어야 합니다.
  await scenario('G 장소 검색', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await page.waitForSelector('#locSearchBtn:not([disabled])', { timeout: 3000 });
    expect(s, '검색어가 없으면 X가 안 보이고 검색 버튼도 없음', !(await visible(page, '#qClear')) && !(await page.$('#searchBtn')));
    await page.type('#q', '많은장소');
    expect(s, '검색어를 적으면 X가 보임', await visible(page, '#qClear'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#results:not([hidden]) button', { timeout: 3000 });
    // 재발 방지(2026-11-05): 결과를 5개로 잘라 '가짜약국' 중 성남 지점이 안 보이던 문제
    const count = await page.$$eval('#results button', (b) => b.length);
    expect(s, '결과를 자르지 않고 모두 보여 줌', count > 15, String(count));
    const first = await page.$eval('#results button', (el) => el.textContent);
    expect(s, '지도에 가까운 맞는 결과가 맨 위', first.includes('찾는곳') && first.includes('km') || first.includes('찾는곳') && first.includes('m ·'), first);
    const calls = await page.evaluate(() => window.__searchCalls.map((o) => !!o.location));
    expect(s, '전체 순위와 지도 근처를 함께 찾음', calls.includes(true) && calls.includes(false), JSON.stringify(calls));
    const scroll = await page.$eval('#results', (el) => {
      el.scrollTop = 300;
      const moved = el.scrollTop > 0;
      el.scrollTop = 0;
      return { moved, can: el.scrollHeight > el.clientHeight, touch: getComputedStyle(el).touchAction };
    });
    expect(s, '결과 목록이 스크롤됨', scroll.moved && scroll.can && scroll.touch === 'pan-y', JSON.stringify(scroll));
    expect(s, '못 찾을 때의 안내가 있음', (await text(page, '#results')).includes('지역을 같이'));
    await page.$eval('#q', (el) => { el.value = ''; });
    await page.type('#q', '테스트 장소 A');
    await page.keyboard.press('Enter');
    await wait(250);
    // 재발 방지(2026-11-05): 근처 검색이 돌려준 다른 약국까지 목록에 섞이던 문제
    const names = await page.$$eval('#results button strong', (b) => b.map((x) => x.textContent));
    expect(s, '찾는 말과 안 맞는 곳은 빠짐', names.length > 0 && names.every((x) => x.includes('테스트 장소 A')), names.join(','));
    await shot(page, 'g-search-many');
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
    const second = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, () => { window.__mockNoAddress = true; }] }, s);
    await second.page.goto(BASE, { waitUntil: 'load' });
    await appReady(second.page);
    await second.page.click('#addBtn');
    await second.page.click('#locHereBtn');
    await wait(150);
    expect(s, '주소를 못 찾아도 위치는 찍히고 직접 적으라고 안내', (await text(second.page, '#locState')).includes('직접 적어'));
    await second.context.close();
  });

  // G2. 약국을 먼저 찾고 고른 약국으로 매물 추가
  await scenario('G2 찾아서 추가', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await page.waitForSelector('#locSearchBtn:not([disabled])', { timeout: 3000 });
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#results:not([hidden]) button', { timeout: 3000 });
    await page.click('#results button');
    expect(s, '결과를 고르면 그 약국과 추가 버튼이 보임', await visible(page, '#placeCard') && await inView(page, '#placeAdd') && (await text(page, '#placeName')).includes('테스트 장소'));
    const logoClear = await page.evaluate(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const r = document.getElementById('placeCard').getBoundingClientRect();
      return r.bottom <= stage.bottom - 40;
    });
    expect(s, '안내 카드가 카카오 로고 자리를 가리지 않음', logoClear);
    await shot(page, 'g2-place-card');
    await page.click('#qClear');
    expect(s, 'X를 누르면 검색어와 카드와 표시가 지워짐', (await page.$eval('#q', (el) => el.value)) === '' && !(await visible(page, '#placeCard')) && !(await visible(page, '#qClear')) && !(await page.$('.search-dot')) && await visible(page, '#addBtn'));
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#results:not([hidden]) button', { timeout: 3000 });
    await page.click('#results button');
    await page.click('#placeClose');
    expect(s, '닫으면 카드가 사라지고 매물 추가 버튼이 돌아옴', !(await visible(page, '#placeCard')) && await visible(page, '#addBtn'));
    await page.$eval('#q', (el) => { el.value = ''; });
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#results:not([hidden]) button', { timeout: 3000 });
    await page.click('#results button');
    const picked = await text(page, '#placeName');
    await page.click('#placeAdd');
    expect(s, '양식에 약국 이름과 주소가 채워짐', await visible(page, '#formScreen') && (await page.$eval('#f-name', (el) => el.value)) === picked && (await page.$eval('#f-address', (el) => el.value)).length > 0);
    await shot(page, 'g2-form-filled');
    await page.click('#formClose');
    expect(s, '채워 준 내용만 있으면 그냥 나가도 묻지 않음', !(await visible(page, '#modal')) && !(await visible(page, '#formScreen')));
    await page.click('#addBtn');
    expect(s, '일반 매물 추가는 빈 양식', (await page.$eval('#f-name', (el) => el.value)) === '' && await visible(page, '#locQ'));
    await page.click('#formClose');
    await page.type('#q', ' ');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#results:not([hidden]) button', { timeout: 3000 });
    await page.click('#results button');
    await page.click('#placeAdd');
    await page.click('#saveListing');
    await wait(80);
    const list = await stored(page);
    expect(s, '저장하면 위치까지 들어가고 핀이 생김', list.length === 1 && Number.isFinite(list[0].lat) && (await page.$$('.mock-marker')).length === 1);
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // D. 저장 실패와 읽기 실패: 데이터를 잃으면 안 됩니다.
  await scenario('D 저장 실패', async (s) => {
    {
      const full = () => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; };
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, full] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await fillAndSave(page, { name: '공간 부족 약국' });
      expect(s, '저장 못 하면 양식이 닫히지 않고 이유가 보임', await visible(page, '#formScreen') && (await text(page, '#formMsg')).includes('가득') && await inViewSoon(page, '#formMsg'));
      expect(s, '입력한 내용이 남아 있음', (await page.$eval('#f-name', (el) => el.value)) === '공간 부족 약국');
      expect(s, '목록에 가짜로 추가되지 않음', (await text(page, '#count')) === '총 0개');
      expect(s, '스크립트 오류 없음(공간 부족)', errors.length === 0, errors.join(' | '));
      await shot(page, 'd-save-failed');
      await context.close();
    }
    {
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await page.evaluate(() => localStorage.setItem('imjang-map:listings', '{깨진 값'));
      await page.reload({ waitUntil: 'load' });
      await appReady(page);
      expect(s, '못 읽으면 처음 화면에서 바로 알리고 추가를 막음', (await text(page, '#reloadMsg')).includes('읽지 못했어요') && await visible(page, '#topReload') && await page.$eval('#addBtn', (el) => el.disabled));
      await shot(page, 'd-load-failed-map');
      await goTab(page, 'list');
      expect(s, '목록에도 이유가 보임', await visible(page, '#loadMsg'));
      expect(s, '깨진 값을 덮어쓰지 않음', (await page.evaluate(() => localStorage.getItem('imjang-map:listings'))) === '{깨진 값');
      expect(s, '스크립트 오류 없음(읽기 실패)', errors.length === 0, errors.join(' | '));
      await shot(page, 'd-load-failed');
      await context.close();
    }
    {
      // 입력하던 내용을 실수로 버리지 않게
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await page.click('#addBtn');
      await page.click('#formClose');
      expect(s, '입력이 없으면 바로 닫힘', !(await visible(page, '#formScreen')));
      await page.click('#addBtn');
      await page.type('#f-name', '쓰던 내용');
      await page.click('#formClose');
      // 재발 방지(2026-11-05): 취소 경고가 양식 맨 아래에 떠서 안 보이고 오류처럼 느껴지던 문제
      expect(s, '입력이 있으면 창으로 물음(스크롤 없이 보임)', await visible(page, '#formScreen') && await visible(page, '#modal') && await inView(page, '#modalYes') && await inView(page, '#modalNo'));
      await shot(page, 'd-discard-modal');
      await page.click('#modalNo');
      expect(s, '계속 쓰기를 누르면 내용이 그대로', !(await visible(page, '#modal')) && (await page.$eval('#f-name', (el) => el.value)) === '쓰던 내용');
      await page.click('#formClose');
      await page.click('#modalYes');
      expect(s, '버리기를 누르면 닫힘', !(await visible(page, '#formScreen')) && (await stored(page)).length === 0);
      await context.close();
    }
  });

  // E. 지도가 없어도 매물 기록은 됩니다.
  await scenario('E 지도 실패', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: '503', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await page.waitForFunction(() => !document.getElementById('mapMsg').hidden, { timeout: 4000 });
    expect(s, '지도 자리에 이유와 등록할 도메인', (await text(page, '#mapMsg')).includes(ORIGIN));
    expect(s, '검색 입력 잠김', await page.$eval('#q', (el) => el.disabled));
    await fillAndSave(page, { name: '지도 없이 적은 약국' });
    expect(s, '지도가 없어도 저장됨', (await stored(page)).length === 1);
    await openFirst(page);
    expect(s, '위치 없는 매물에는 지도에서 보기가 없음', !(await visible(page, '#mapViewBtn')));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await shot(page, 'e-map-failed');
    await context.close();
  });

  // F. 앱이 아닌 곳: 저장 공간이 따로라는 것을 알려야 합니다.
  await scenario('F 앱 밖', async (s) => {
    {
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock' }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      const help = await text(page, '#placeHelp');
      expect(s, 'Safari면 홈 화면 추가 안내', await visible(page, '#placeNotice') && help.includes('홈 화면에 추가'), help);
      await layoutExpect(page, s);
      await shot(page, 'f-safari');
      await context.close();
    }
    {
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      expect(s, '앱이면 안내 없음', !(await visible(page, '#placeNotice')));
      await context.close();
    }
    {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0';
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', ua }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      expect(s, '카카오톡 안이면 나가는 길 안내', (await text(page, '#placeHelp')).includes('다른 브라우저로 열기'));
      await context.close();
    }
  });

  // H. 다시 불러오기와 시작 감시
  await scenario('H 예외', async (s) => {
    const fastTimers = () => {
      const st = window.setTimeout;
      window.setTimeout = (f, d, ...a) => st(f, d === 15000 || d === 8000 ? 300 : d, ...a);
    };
    {
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await page.evaluate(() => window.__showReload('시험 안내'));
      await page.setOfflineMode(true);
      await page.click('#topReload');
      const said = await page.waitForFunction(() => {
        const m = document.getElementById('reloadMsg');
        return m && !m.hidden && m.textContent.includes('인터넷');
      }, { timeout: 12000 }).then(() => true, () => false);
      expect(s, '신호 없으면 앱 화면이 남고 안내가 보임', said && await inView(page, '#reloadMsg') && page.url() === BASE);
      await shot(page, 'h-offline');
      await page.setOfflineMode(false);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#topReload')]);
      await appReady(page);
      expect(s, '신호가 돌아오면 다시 불러오기가 됨', await visible(page, '#addBtn'));
      expect(s, '스크립트 오류 없음(다시 불러오기)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      const { context, page, errors } = await openPage(browser, {
        kakao: 'mock', config: 'mock',
        init: [asApp, fastTimers, () => { window.__mockTilesDelay = 900; }],
      }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await page.waitForFunction(() => !document.getElementById('mapMsg').hidden, { timeout: 3000 });
      expect(s, '지도 그림 시간 초과면 지도 자리에 안내', (await text(page, '#mapMsg')).includes('안 떴어요'));
      await page.waitForFunction(() => document.getElementById('mapMsg').hidden, { timeout: 3000 });
      expect(s, '늦게 뜨면 안내가 사라짐', true);
      expect(s, '스크립트 오류 없음(시간 초과)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    for (const [what, mode] of [
      ['모듈 하나가 안 받아질 때', { abort: /\/js\/lib\/listings\.js$/ }],
      ['옛 파일과 새 파일이 섞일 때', { config: 'broken' }],
    ]) {
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', ...mode, init: fastTimers }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      const shown = await page.waitForFunction(() => {
        const m = document.getElementById('reloadMsg');
        return m && !m.hidden && m.textContent.includes('불러오지 못했어요');
      }, { timeout: 5000 }).then(() => true, () => false);
      expect(s, `${what}: 안내가 보이고 버전이 보임`, shown && await inView(page, '#reloadMsg') && (await text(page, '#ver')).length > 0);
      const moved = await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 5000 }).then(() => true, () => false),
        page.click('#topReload'),
      ]);
      expect(s, `${what}: 다시 불러오기 버튼이 살아 있음`, moved[0]);
      await context.close();
    }
    {
      const denied = () => { navigator.geolocation.getCurrentPosition = (_ok, bad) => bad({ code: 1 }); };
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, denied] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await page.click('#locate');
      await wait(60);
      expect(s, '위치 거부 안내가 보임', await inView(page, '#toast') && (await text(page, '#toast')).includes('Safari 웹 사이트'));
      await shot(page, 'h-gps-denied');
      await page.click('#addBtn');
      await page.click('#locHereBtn');
      await wait(60);
      expect(s, '양식에서도 위치 거부 이유가 보임', (await text(page, '#locState')).includes('위치 권한'));
      await context.close();
    }
  });

  // U. 새 버전 자동 적용
  await scenario('U 새 버전', async (s) => {
    const remote = { on: false };
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp, remote }, s);
    let loads = 0;
    page.on('load', () => { loads += 1; });
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await wait(200);
    expect(s, '같은 버전이면 다시 읽지 않음', loads === 1, String(loads));
    await page.click('#addBtn');
    await page.type('#f-name', '쓰던 내용');
    remote.on = true;
    const ping = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await ping();
    await wait(300);
    expect(s, '입력 중에는 새 버전이 있어도 안 건드림', loads === 1 && (await page.$eval('#f-name', (el) => el.value)) === '쓰던 내용', String(loads));
    await page.click('#formClose');
    await page.click('#modalYes');
    await ping();
    await page.waitForFunction(() => document.readyState === 'complete');
    await wait(500);
    expect(s, '입력이 끝나면 새 버전을 받음', loads >= 2, String(loads));
    const after = loads;
    await wait(500);
    expect(s, '받은 파일이 그대로여도 반복해서 다시 읽지 않음', loads === after, `${after} -> ${loads}`);
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // W. 백업: 내보내기, 되살리기, 되돌리기, 잘못된 파일, 알림
  await scenario('W 백업', async (s) => {
    const openBackup = async (page) => {
      await goTab(page, 'settings');
      await page.click('#backupOpen');
    };
    {
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, fakeShare, hookDownload] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await page.waitForSelector('#locSearchBtn:not([disabled])', { timeout: 3000 });
      await goTab(page, 'settings');
      expect(s, '설정에 아직 백업 안 함으로 보임', (await text(page, '#backupWhen')) === '안 함');
      await goTab(page, 'map');
      // 매물 2개와 분류 1개
      await page.click('#addBtn');
      await page.type('#f-name', '○○약국 "임대" ☕');
      await page.click('#catNew');
      await page.type('#catName', '후보');
      await page.click('#catSave');
      await wait(40);
      await page.type('#f-premium', '15000');
      await page.click('#locHereBtn');
      await wait(120);
      await page.click('#saveListing');
      await wait(60);
      await fillAndSave(page, { name: '두 번째 약국' });
      await openBackup(page);
      expect(s, '백업 화면이 열리고 카톡 안내가 보임', await visible(page, '#backupScreen') && (await text(page, '#backupHow')).includes('나와의 채팅'));
      expect(s, '내보내기 버튼이 스크롤 없이 보임', await inView(page, '#exportBtn'));
      await shot(page, 'w-backup');
      await page.evaluate(() => { window.__shareMode = 'AbortError'; });
      await page.click('#exportBtn');
      await wait(120);
      expect(s, '공유 창을 닫으면 실패로 안 보이고 백업 시각도 안 바뀜', (await text(page, '#backupMsg')).includes('닫혔어요') && (await page.$eval('#backupMsg', (el) => el.dataset.tone)) === 'info' && (await text(page, '#backupLast')).includes('아직'));
      await page.evaluate(() => { window.__shareMode = ''; });
      await page.click('#exportBtn');
      await wait(120);
      const f = await lastShared(page);
      const body = JSON.parse(f.text);
      expect(s, '파일에 매물과 분류가 들어감', /^imjang-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f.name) && f.type === 'application/json' && f.keys.join() === 'files' && body.listings.length === 2 && body.categories.length === 1 && body.count === 2, f.name);
      expect(s, '내보내면 마지막 백업 시각이 보임', (await text(page, '#backupLast')).includes('마지막 백업') && (await text(page, '#backupMsg')).includes('매물 2개'));
      await shot(page, 'w-exported');
      await page.click('#downloadBtn');
      await wait(60);
      const d = await lastDownload(page);
      expect(s, '파일로 바로 저장: 파일이 생기고 UTF-8, BOM 없음', !!d && /\.json$/.test(d.name) && d.first === 0x7b && d.text.includes('임대'), JSON.stringify(d?.name));
      const backupText = f.text;
      // 잘못된 파일
      const before = await page.evaluate(() => localStorage.getItem('imjang-map:listings'));
      for (const [what, content, word] of [
        ['깨진 파일', '{ 잘린', '손상'],
        ['다른 앱', JSON.stringify({ app: 'other', schemaVersion: 1 }), '백업 파일이 아니에요'],
        ['시험 파일', JSON.stringify({ app: 'imjang-map', schemaVersion: 1, purpose: 'connection-test' }), '시험 파일'],
        ['높은 버전', JSON.stringify({ app: 'imjang-map', schemaVersion: 99 }), '더 새 버전'],
        ['잘린 내용', JSON.stringify({ app: 'imjang-map', schemaVersion: 1, count: 5, listings: [] }), '내용이 맞지 않아요'],
      ]) {
        await pickFile(page, content);
        const msg = await text(page, '#importMsg');
        expect(s, `${what}: 이유가 보이고 묻지 않음`, msg.includes(word) && msg.includes('그대로예요') && !(await visible(page, '#modal')), msg);
        expect(s, `${what}: 저장값이 그대로`, (await page.evaluate(() => localStorage.getItem('imjang-map:listings'))) === before);
      }
      await shot(page, 'w-bad-file');
      // 지운 뒤 되살리기
      await page.click('#backupClose');
      await goTab(page, 'list');
      await openFirst(page);
      await page.click('#deleteBtn');
      await page.click('#modalYes');
      await wait(60);
      expect(s, '하나 지우면 1개', (await stored(page)).length === 1);
      await openBackup(page);
      await pickFile(page, backupText);
      expect(s, '바꾸기 전에 개수를 보여 주고 물음', await visible(page, '#modal') && (await text(page, '#modalText')).includes('파일: 매물 2개') && (await text(page, '#modalText')).includes('지금: 매물 1개') && await inView(page, '#modalYes'));
      await shot(page, 'w-confirm');
      await page.click('#modalNo');
      expect(s, '취소하면 그대로', (await stored(page)).length === 1);
      await pickFile(page, backupText);
      await page.click('#modalYes');
      await wait(60);
      expect(s, '바꾸기를 누르면 매물과 분류가 돌아옴', (await stored(page)).length === 2 && (await page.$$('.mock-marker')).length >= 1 && (await text(page, '#importMsg')).includes('2개'));
      // 재발 방지(2026-11-05): 같은 안내가 토스트로 또 떠서 글자를 가리고, 되돌리기가 화면 밖에 있던 문제
      expect(s, '되살린 결과와 되돌리기가 화면 안에 보임', await inViewSoon(page, '#undoImport') && await inView(page, '#importMsg'));
      expect(s, '백업 화면에서는 토스트를 겹쳐 띄우지 않음', !(await visible(page, '#toast')));
      await shot(page, 'w-imported');
      await page.click('#undoImport');
      await page.click('#modalYes');
      await wait(60);
      expect(s, '되돌리면 가져오기 전으로', (await stored(page)).length === 1);
      await page.click('#backupClose');
      await goTab(page, 'list');
      await page.reload({ waitUntil: 'load' });
      await appReady(page);
      expect(s, '다시 열어도 유지', (await stored(page)).length === 1);
      expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      // 새 폰: 빈 화면에서 바로 되살리기
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, fakeShare] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await goTab(page, 'list');
      expect(s, '빈 목록에 가져오기가 보임', await visible(page, '#emptyImport'));
      await shot(page, 'w-empty-import');
      const file = JSON.stringify({ app: 'imjang-map', schemaVersion: 1, count: 1, listings: [{ id: 'x', name: '되살린 약국', lat: 37.56, lng: 126.97, categoryId: 'c' }], categories: [{ id: 'c', name: '유력', color: '#3F82D9' }] });
      await pickFile(page, file, '#emptyImport');
      expect(s, '지킬 내용이 없으면 묻지 않고 되살림', !(await visible(page, '#modal')) && (await stored(page)).length === 1 && (await text(page, '#list')).includes('되살린 약국'));
      expect(s, '되살린 분류도 보임', (await text(page, '#list')).includes('유력'));
      expect(s, '가져오기 뒤에는 빈 안내가 사라짐', !(await visible(page, '#emptyImport')));
      expect(s, '스크립트 오류 없음(새 폰)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      // 재발 방지(2026-11-05): 읽지 못하는 상태에서 빈 파일을 백업으로 내보내거나, 되살리기까지 막히던 위험
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, fakeShare, hookDownload] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await openBackup(page);
      await page.click('#exportBtn');
      await wait(60);
      expect(s, '매물이 없으면 내보내지 않음', (await text(page, '#backupMsg')).includes('내보낼 매물이 없어요') && (await lastShared(page)) === null);
      await page.evaluate(() => localStorage.setItem('imjang-map:listings', '{깨진 값'));
      await page.reload({ waitUntil: 'load' });
      await appReady(page);
      // 재발 방지(2026-11-05): 안내 상자가 설정 줄을 덮어 되살리러 갈 수 없던 문제
      await goTab(page, 'settings');
      const notCovered = await page.$eval('#backupOpen', (el) => {
        const r = el.getBoundingClientRect();
        const c = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el.contains(c);
      });
      expect(s, '읽지 못하는 상태에서도 백업 줄을 누를 수 있음', notCovered);
      await page.click('#backupOpen');
      await page.click('#exportBtn');
      await wait(60);
      expect(s, '읽지 못하는 상태면 빈 파일을 내보내지 않음', (await text(page, '#backupMsg')).includes('읽지 못해서') && (await lastShared(page)) === null && (await lastDownload(page)) === null);
      const rescue = JSON.stringify({ app: 'imjang-map', schemaVersion: 1, count: 1, listings: [{ id: 'x', name: '구한 약국', lat: null, lng: null }], categories: [] });
      await pickFile(page, rescue);
      expect(s, '읽지 못하는 상태에서도 묻고 되살릴 수 있음', await visible(page, '#modal') && (await text(page, '#modalText')).includes('읽지 못하는 상태'));
      await page.click('#modalNo');
      expect(s, '취소하면 깨진 값을 안 덮음', (await page.evaluate(() => localStorage.getItem('imjang-map:listings'))) === '{깨진 값');
      await pickFile(page, rescue);
      await page.click('#modalYes');
      await wait(60);
      expect(s, '바꾸면 되살아나고 매물 추가가 다시 됨', (await stored(page)).length === 1 && await page.$eval('#addBtn', (el) => !el.disabled) && !(await visible(page, '#topReload')));
      expect(s, '스크립트 오류 없음(되살리기)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      // 공유 거절, 공유 불가, 안드로이드
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, fakeShare, hookDownload] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await fillAndSave(page, { name: '약국' });
      await openBackup(page);
      await page.evaluate(() => { window.__shareMode = 'NotAllowedError'; });
      await page.click('#exportBtn');
      await wait(100);
      expect(s, '아이폰 첫 거절은 다운로드로 안 넘어감', (await lastDownload(page)) === null && (await text(page, '#backupMsg')).includes('한 번 더'));
      await page.click('#exportBtn');
      await wait(100);
      expect(s, '두 번째 거절은 실패 안내', (await page.$eval('#backupMsg', (el) => el.dataset.tone)) === 'fail' && (await lastDownload(page)) === null);
      await context.close();
    }
    {
      const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', ua, init: [asApp, fakeShare, hookDownload] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await fillAndSave(page, { name: '약국' });
      await openBackup(page);
      expect(s, '안드로이드 안내는 카톡이 아님', (await text(page, '#backupHow')).includes('파일이 저장돼요'));
      await page.click('#exportBtn');
      await wait(100);
      expect(s, '안드로이드는 공유를 안 부르고 파일이 생김', !!(await lastDownload(page)) && (await lastShared(page)) === null);
      await context.close();
    }
    {
      // 강한 유도: 첫 저장 안내, 설정 탭 점, 3건마다 알림
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', realNudge: true, init: [asApp, fakeShare, () => {
        window.__persistCalls = 0;
        navigator.storage.persisted = async () => false;
        navigator.storage.persist = async () => { window.__persistCalls += 1; return true; };
      }] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await wait(60);
      expect(s, '앱을 열면 자동 삭제 방지를 요청함', (await page.evaluate(() => window.__persistCalls)) >= 1);
      await page.click('#addBtn');
      await page.type('#f-name', '첫 약국');
      await page.click('#saveListing');
      await wait(80);
      expect(s, '첫 저장 뒤 폰에만 저장된다고 창으로 알림', await visible(page, '#modal') && (await text(page, '#modalText')).includes('이 폰에만') && await inView(page, '#modalYes'));
      await shot(page, 'w-intro');
      await page.click('#modalNo');
      expect(s, '설정 탭에 점이 찍힘', (await page.$eval('#tabbar [data-tab="settings"]', (el) => el.dataset.alert)) === 'true');
      await page.click('#addBtn');
      await page.type('#f-name', '둘째 약국');
      await page.click('#saveListing');
      await wait(80);
      expect(s, '안내 창은 처음 한 번만', !(await visible(page, '#modal')) && !(await visible(page, '#backupNudge')));
      await page.click('#addBtn');
      await page.type('#f-name', '셋째 약국');
      await page.click('#saveListing');
      await wait(80);
      expect(s, '3건 쌓이면 알림', await visible(page, '#backupNudge') && (await text(page, '#nudgeText')).includes('3건') && await inView(page, '#nudgeGo'));
      const nudgeClear = await page.evaluate(() => {
        const stage = document.querySelector('.stage').getBoundingClientRect();
        return document.getElementById('backupNudge').getBoundingClientRect().bottom <= stage.bottom - 40;
      });
      expect(s, '백업 알림이 카카오 로고 자리를 가리지 않음', nudgeClear);
      await shot(page, 'w-nudge-3');
      await page.click('#nudgeLater');
      await goTab(page, 'settings');
      expect(s, '설정에 백업 전 건수가 보임', (await text(page, '#backupWhen')) === '백업 전 3건');
      await shot(page, 'w-settings-pending');
      await page.reload({ waitUntil: 'load' });
      await appReady(page);
      expect(s, '나중에를 눌러도 다음에 열면 다시 알림', await visible(page, '#backupNudge'));
      await page.click('#nudgeGo');
      await wait(60);
      expect(s, '알림에서 백업 화면으로 감', await visible(page, '#backupScreen') && (await text(page, '#backupLast')).includes('3건'));
      expect(s, '자동 삭제 방지 상태가 보임', (await text(page, '#persistLine')).includes('켜짐'));
      await shot(page, 'w-backup-pending');
      await page.click('#exportBtn');
      await wait(100);
      expect(s, '백업하면 점이 사라짐', (await page.$eval('#tabbar [data-tab="settings"]', (el) => el.dataset.alert)) === 'false');
      expect(s, '스크립트 오류 없음(유도)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      // 아이폰이 자동 삭제 방지를 받아 주지 않을 때
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, () => {
        navigator.storage.persisted = async () => false;
        navigator.storage.persist = async () => false;
      }] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await appReady(page);
      await wait(60);
      await openBackup(page);
      expect(s, '방지가 안 되면 숨기지 않고 알림', (await text(page, '#persistLine')).includes('허용하지 않았어요') && await visible(page, '#persistLine'));
      await context.close();
    }
    {
      // 7일 알림
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', realNudge: true, init: [asApp, fakeShare] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await page.evaluate(() => {
        localStorage.setItem('imjang-map:listings', JSON.stringify({ schemaVersion: 1, data: { items: [{ id: 'a', name: '약국', lat: null, lng: null, createdAt: '2026-01-01T00:00:00.000Z' }] } }));
        const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
        localStorage.setItem('imjang-map:backup-meta', JSON.stringify({ schemaVersion: 1, data: { lastBackupAt: null, dirtySince: old } }));
      });
      await page.reload({ waitUntil: 'load' });
      await appReady(page);
      expect(s, '7일 넘게 백업 안 하면 알림', await visible(page, '#backupNudge') && await inView(page, '#nudgeGo'));
      await shot(page, 'w-nudge');
      await page.click('#nudgeGo');
      expect(s, '알림에서 백업 화면으로 감', await visible(page, '#backupScreen') && !(await visible(page, '#backupNudge')));
      await page.click('#exportBtn');
      await wait(100);
      await page.click('#backupClose');
      await page.reload({ waitUntil: 'load' });
      await appReady(page);
      expect(s, '백업하면 알림이 사라짐', !(await visible(page, '#backupNudge')));
      await context.close();
    }
  });

  // I. 홈 화면 설정: 크롬이 manifest를 제대로 읽는지와 아이콘 응답 (아이폰 동작의 증거는 아님)
  await scenario('I 홈 화면', async (s) => {
    const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock' }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    const cdp = await page.createCDPSession();
    const m = await cdp.send('Page.getAppManifest');
    expect(s, 'manifest를 오류 없이 읽음', m.errors.length === 0 && !!m.data && m.data.includes('약국 임장노트'), JSON.stringify(m.errors));
    await context.close();
  });

  // J. 실제 폰에 가까운 크기와 어두운 모드
  await scenario('J 실제 크기', async (s) => {
    const { context, page } = await openPage(browser, {
      kakao: 'mock', config: 'mock', init: asApp,
      viewport: { width: 402, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    }, s);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34, left: 0, right: 0 } }).catch(() => {});
    await page.goto(BASE, { waitUntil: 'load' });
    await appReady(page);
    await fillAndSave(page, { name: '○○대학병원 문전약국 임대', region: '서울 중구', deposit: '5000', rent: '300', premium: '15000' });
    await fillAndSave(page, { name: '△△의원 옆 약국 양도', region: '경기 성남시', premium: '30000' });
    await layoutExpect(page, s);
    await wait(3600); // 저장 안내가 닫힌 뒤 캡처
    await shot(page, 'j-main');
    // 재발 방지(2026-11-05): 홈 화면 앱에서 윗줄이 iOS 흐림 효과와 겹치던 문제 (실제 효과는 폰에서 확인)
    // 재발 방지(2026-11-05): 홈 화면 앱에서 맨 위가 iOS 흐림 효과와 겹치던 문제 (실제 효과는 폰에서 확인)
    const barH = await page.$eval('.topbar', (el) => el.getBoundingClientRect().height);
    expect(s, '윗줄이 있고 너무 두껍지 않음', (await text(page, '#barTitle')) === '약국 임장노트' && barH <= 66, String(barH));
    expect(s, '윗줄 글자를 흐림 효과 아래로 내려 둠', await page.$eval('#barTitle', (el) => el.getBoundingClientRect().top >= 26));
    await goTab(page, 'list');
    expect(s, '목록 탭 윗줄은 내 매물, 총 개수는 아래 줄', (await text(page, '#barTitle')) === '내 매물' && (await text(page, '.topbar')).trim() === '내 매물' && await visible(page, '#count'));
    await shot(page, 'j-list');
    await goTab(page, 'settings');
    expect(s, '설정 탭 윗줄은 설정', (await text(page, '#barTitle')) === '설정' && !(await visible(page, '#count')));
    await shot(page, 'j-settings');
    await goTab(page, 'map');
    await page.click('#addBtn');
    await shot(page, 'j-form');
    expect(s, '양식 윗줄도 내려 둠', await page.$eval('#formClose', (el) => el.getBoundingClientRect().top >= 20));
    await page.$eval('#saveListing', (el) => el.scrollIntoView({ block: 'end' }));
    expect(s, '저장 버튼이 가려지지 않음', await inView(page, '#saveListing'));
    await page.click('#formClose');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await goTab(page, 'list');
    await shot(page, 'j-dark');
    await openFirst(page);
    await shot(page, 'j-detail-dark');
    await context.close();
  });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.scenario}] ${r.what}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 통과 · 캡처: ${OUT}`);
process.exitCode = failed.length ? 1 : 0;
