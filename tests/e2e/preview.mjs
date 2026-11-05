// 대행 검증: 아이폰 크기 화면에서 앱을 자동으로 조작하고 캡처합니다.
// 진짜 카카오 대신 tests/e2e/mocks 의 가짜를 끼워 넣습니다.
// 사용법: npm run preview -- [캡처 저장 폴더]
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
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

// mode: kakao 'mock' | '503' | 'block', config 'mock' | 'empty' | 'real' | 'broken',
//       abort 요청 경로에 대한 정규식(모듈 실패 흉내), init 페이지마다 먼저 실행할 함수(들), ua, viewport
async function openPage(browser, mode, scenario) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(ORIGIN, ['geolocation']);
  const page = await context.newPage();
  await page.setUserAgent(mode.ua || IPHONE_UA);
  await page.setViewport(mode.viewport || PHONE);
  await page.setGeolocation({ latitude: 37.5668, longitude: 126.9786, accuracy: 24 });
  for (const f of [].concat(mode.init || [])) await page.evaluateOnNewDocument(f);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const requests = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    requests.push(u.pathname + u.search);
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
  });
  return { context, page, errors, requests, scenario };
}

// 홈 화면 앱으로 열린 상태를 흉내 냅니다. 실제 아이폰 동작의 증거는 아니고, 앱 쪽 분기만 확인합니다.
const asApp = () => Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
const CHECK_COUNT = (await readFile(join(ROOT, 'index.html'), 'utf8')).match(/data-check="/g).length;
const cardTitle = (page) => page.$eval('#nextTitle', (el) => el.textContent);
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('imjang-map:check')));
const checkState = (page, id) => page.$eval(`[data-check="${id}"]`, (li) => li.dataset.state);
const waitCheck = (page, id, state, timeout = 6000) =>
  page.waitForSelector(`[data-check="${id}"][data-state="${state}"]`, { timeout }).then(() => true, () => false);

async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const visibleInputs = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null);
    const small = visibleInputs.filter((i) => parseFloat(getComputedStyle(i).fontSize) < 16).map((i) => i.id);
    const clipped = [...document.querySelectorAll('.check .name, .check .msg, .btn, .score, .results strong, .results span, .fab, .form-msg, .next-title, .next-help, .diag')]
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

await mkdir(OUT, { recursive: true });
await new Promise((r) => server.listen(PORT, r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });

try {
  // A. 설정값이 하나도 없는 처음 상태 (빈 설정을 끼움)
  await scenario('A 설정 전', async (s) => {
    const { context, page, errors, requests } = await openPage(browser, { kakao: 'block', config: 'empty' }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    expect(s, '지도 점검이 실패로, 이유와 함께 표시', await waitCheck(page, 'map', 'fail'));
    expect(s, '지도 자리에 안내 문구', await page.$eval('#mapMsg', (el) => !el.hidden && el.textContent.includes('지도 준비 전')));
    expect(s, '검색 입력 잠김', await page.$eval('#q', (el) => el.disabled));
    const appVersion = (await readFile(join(ROOT, 'index.html'), 'utf8')).match(/name="app-version" content="([^"]+)"/)[1];
    expect(s, '버전 표시', (await page.$eval('#ver', (el) => el.textContent)) === appVersion, appVersion);
    const versioned = requests.filter((r) => /\/js\/(config|lib\/)/.test(r));
    expect(s, '쓰이는 모듈이 모두 버전 꼬리표(?v=)로 요청됨(캐시 방지)', versioned.length >= 1 && versioned.every((r) => r.includes('?v=')), versioned.join(' '));
    expect(s, 'firebase 요청 없음', !requests.some((r) => /firebase/i.test(r)));
    expect(s, 'vendor/firebase.js 파일 없음', !existsSync(join(ROOT, 'vendor/firebase.js')));
    await layoutExpect(page, s);
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await shot(page, 'a-unconfigured');
    await context.close();
  });

  // B. 홈 화면 앱으로 열려 모두 통과하는 경우 (가짜 지도, 진짜 localStorage, 새 컨텍스트)
  await scenario('B 모두 통과', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    expect(s, '시작할 때 기록이 비어 있음', (await record(page)) === null);
    expect(s, '홈 화면 앱 통과', await waitCheck(page, 'standalone', 'ok'));
    expect(s, '지도 통과', await waitCheck(page, 'map', 'ok'));
    expect(s, '카드가 장소 검색을 안내', (await cardTitle(page)) === '장소 검색');
    expect(s, '위쪽 다시 불러오기가 보임', await inView(page, '#topReload'));
    await shot(page, 'b0-search-next');
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    expect(s, '검색 통과', await waitCheck(page, 'search', 'ok'));
    expect(s, '검색 결과 목록 표시', await page.$eval('#results', (el) => !el.hidden && el.querySelectorAll('button').length === 2));
    await shot(page, 'b1-search-results');
    await page.click('#results button');
    expect(s, '결과를 누르면 목록이 닫힘', await page.$eval('#results', (el) => el.hidden));
    expect(s, '카드가 내 위치를 안내', (await cardTitle(page)) === '내 위치');
    await page.click('#locate');
    expect(s, '내 위치 통과', await waitCheck(page, 'gps', 'ok'));
    expect(s, '내 위치 점 표시', !!(await page.$('.me-dot')));
    expect(s, '결과 안내가 스크롤 없이 보임', await inViewSoon(page, '#nextMsg'));
    const total = CHECK_COUNT;
    expect(s, `점수 ${total}/${total}`, (await page.$eval('#score', (el) => el.textContent)) === `${total}개 모두 통과`);
    expect(s, '카드가 모두 통과를 안내', (await cardTitle(page)) === `${total}개 모두 통과했어요`);
    await layoutExpect(page, s);
    await shot(page, 'b3-all-pass');
    await page.reload({ waitUntil: 'load' });
    await waitCheck(page, 'map', 'ok');
    expect(s, '다시 읽어도 결과가 유지됨', (await checkState(page, 'search')) === 'ok' && (await checkState(page, 'gps')) === 'ok');
    expect(s, '다시 읽어도 모두 통과', (await page.$eval('#score', (el) => el.textContent)) === `${total}개 모두 통과`);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await shot(page, 'b4-dark');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.click('#sheetToggle');
    expect(s, '점검 접으면 지도가 커짐', await page.$eval('#sheetBody', (el) => el.offsetParent === null));
    await shot(page, 'b5-collapsed');
    await page.click('#sheetToggle');
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // B2. 새 버전을 배포한 뒤 옛 기록을 가진 채로 열린 경우
  await scenario('B2 버전 전환', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.setItem('imjang-map:check', JSON.stringify({
      schemaVersion: 1,
      data: { version: 'old-version', results: { search: { state: 'ok', msg: '옛 결과' }, gps: { state: 'ok', msg: '옛 결과' } } },
    })));
    await page.reload({ waitUntil: 'load' });
    await waitCheck(page, 'map', 'ok');
    expect(s, '옛 기록은 무시하고 검색·위치가 대기', (await checkState(page, 'search')) === 'wait' && (await checkState(page, 'gps')) === 'wait');
    expect(s, '카드는 장소 검색', (await cardTitle(page)) === '장소 검색');
    expect(s, '결과 줄에 새 버전 안내', (await page.$eval('#nextMsg', (el) => el.textContent)).includes('새 버전') && await inViewSoon(page, '#nextMsg'));
    const rec = await record(page);
    expect(s, '기록이 지금 버전으로 바뀜', rec && rec.data.version !== 'old-version', JSON.stringify(rec));
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    expect(s, '대본 순서대로 검색이 됨', await waitCheck(page, 'search', 'ok'));
    await page.click('#locate');
    expect(s, '대본 순서대로 위치가 됨', await waitCheck(page, 'gps', 'ok'));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  });

  // B3. 진행 중 상태가 기록에 남아 있던 경우: 요청도 없이 '찾는 중'에 갇히면 안 됩니다.
  await scenario('B3 진행 중 기록', async (s) => {
    const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    const version = await page.$eval('#ver', (el) => el.textContent);
    await page.evaluate((v) => localStorage.setItem('imjang-map:check', JSON.stringify({
      schemaVersion: 1,
      data: { version: v, results: { gps: { state: 'half', msg: '찾는 중' } } },
    })), version);
    await page.reload({ waitUntil: 'load' });
    await waitCheck(page, 'map', 'ok');
    expect(s, '위치는 대기로 돌아옴', (await checkState(page, 'gps')) === 'wait');
    await context.close();
  });

  // C. 카카오가 도메인 미등록으로 거절하는 경우 (503)
  await scenario('C 지도 거절', async (s) => {
    const { context, page, errors } = await openPage(browser, { kakao: '503', config: 'mock', init: asApp }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    expect(s, '지도 실패', await waitCheck(page, 'map', 'fail'));
    const msg = await page.$eval('[data-check="map"] .msg', (el) => el.textContent);
    expect(s, '안내에 등록할 도메인이 그대로 나옴', msg.includes(ORIGIN), msg);
    expect(s, '카드는 검색을 건너뛰고 내 위치', (await cardTitle(page)) === '내 위치');
    await page.click('#locate');
    expect(s, '지도가 없어도 위치 점검은 독립적으로 작동', await waitCheck(page, 'gps', 'ok'));
    expect(s, '실패만 남으면 카드가 안내', (await cardTitle(page)) === '실패한 점검이 있어요');
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await shot(page, 'c-map-rejected');
    await context.close();
  });

  // F. 앱이 아닌 일반 탭: 저장 공간이 따로라 여기서는 쓰지도 믿지도 않습니다.
  await scenario('F 일반 탭', async (s) => {
    {
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock' }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await waitCheck(page, 'map', 'ok');
      expect(s, '카드가 홈 화면 안내', (await cardTitle(page)) === '홈 화면 앱으로 열림');
      const help = await page.$eval('#nextHelp', (el) => el.textContent);
      expect(s, 'Safari면 추가 순서를 안내', help.includes('홈 화면에 추가') && help.includes('웹 앱으로 열기'), help);
      expect(s, '지우지 말라는 안내', help.includes('지우지'), help);
      expect(s, '안내 끝까지 스크롤 없이 보임', await inView(page, '#nextHelp'));
      await layoutExpect(page, s);
      await shot(page, 'f-safari');
      await page.type('#q', '테스트 장소');
      await page.keyboard.press('Enter');
      await waitCheck(page, 'search', 'ok');
      await page.click('#results button');
      expect(s, '검색해도 카드는 그대로 홈 화면', (await cardTitle(page)) === '홈 화면 앱으로 열림');
      expect(s, 'localStorage에 쓰지 않음', (await page.evaluate(() => localStorage.length)) === 0);
      const version = await page.$eval('#ver', (el) => el.textContent);
      await page.evaluate((v) => localStorage.setItem('imjang-map:check', JSON.stringify({
        schemaVersion: 1, data: { version: v, results: { search: { state: 'ok', msg: '앱의 기록' } } },
      })), version);
      await page.reload({ waitUntil: 'load' });
      await waitCheck(page, 'map', 'ok');
      expect(s, '기록이 있어도 판정·복원하지 않음', (await checkState(page, 'search')) === 'wait');
      expect(s, '진단 줄에 기록 있음과 원본 값 표시', await page.$eval('#diag', (el) => el.textContent.includes('기록 있음') && el.textContent.includes('Safari/')));
      expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0';
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', ua }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      expect(s, '카카오톡 안이면 실패 안내', await waitCheck(page, 'standalone', 'fail'));
      expect(s, '카드에 Safari로 나가는 길', (await page.$eval('#nextHelp', (el) => el.textContent)).includes('다른 브라우저로 열기'));
      await shot(page, 'f-kakao');
      await context.close();
    }
    {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 NAVER(inapp; search; 2000; 12.0)';
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', ua }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      const help = await page.$eval('#nextHelp', (el) => el.textContent);
      expect(s, '네이버 앱이면 없는 공유 버튼 대신 기본 브라우저 안내', help.includes('기본 브라우저') && !help.includes('공유'), help);
      await context.close();
    }
  });

  // H. 예외: 지도 그림 시간 초과, 신호 없을 때 다시 불러오기, 모듈 실패, 안내 위치
  await scenario('H 예외', async (s) => {
    // 15초·8초 대기를 줄여서 돌립니다. 코드의 분기만 확인하는 것입니다.
    const fastTimers = () => {
      const st = window.setTimeout;
      window.setTimeout = (f, d, ...a) => st(f, d === 15000 || d === 8000 ? 300 : d, ...a);
    };
    {
      const { context, page, errors } = await openPage(browser, {
        kakao: 'mock', config: 'mock',
        init: () => {
          const st = window.setTimeout;
          window.setTimeout = (f, d, ...a) => st(f, d === 15000 ? 300 : d, ...a);
          window.__mockTilesDelay = 900;
        },
      }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      expect(s, '지도 그림 시간 초과면 실패 표시', await waitCheck(page, 'map', 'fail'));
      expect(s, '지도 그림 시간 초과면 지도 자리에 안내', await page.$eval('#mapMsg', (el) => !el.hidden));
      expect(s, '늦게 뜨면 통과로 바뀜', await waitCheck(page, 'map', 'ok'));
      expect(s, '늦게 뜨면 지도 자리 안내가 사라짐', await page.$eval('#mapMsg', (el) => el.hidden));
      expect(s, '스크립트 오류 없음(시간 초과)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    {
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock' }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await waitCheck(page, 'map', 'ok');
      // 재발 방지(2026-11-05): 버튼이 스크롤 아래에 숨거나 결과 안내가 화면 밖에 뜨던 문제
      expect(s, "'다시 불러오기' 버튼이 스크롤 없이 보임", await inView(page, '#topReload'));
      await page.setOfflineMode(true);
      await page.click('#topReload');
      const said = await page.waitForFunction(() => {
        const m = document.getElementById('reloadMsg');
        return m && !m.hidden && m.textContent.includes('인터넷');
      }, { timeout: 12000 }).then(() => true, () => false);
      expect(s, '신호 없으면 다시 불러오기 근처에 안내가 보임', said && await inView(page, '#reloadMsg'));
      expect(s, '신호 없어도 앱 화면이 남음', await page.$eval('.brand', (el) => !!el) && page.url() === BASE);
      expect(s, '신호 없을 때 버튼이 다시 눌림', await page.$eval('#topReload', (el) => !el.disabled && el.textContent === '다시 불러오기'));
      await shot(page, 'h-offline-reload');
      await page.setOfflineMode(false);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#topReload')]);
      expect(s, '신호가 돌아오면 다시 불러오기가 됨', await waitCheck(page, 'map', 'ok'));
      expect(s, '스크립트 오류 없음(다시 불러오기)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
    for (const [what, mode] of [
      ['모듈 하나가 안 받아질 때', { abort: /\/js\/lib\/messages\.js$/ }],
      ['옛 파일과 새 파일이 섞일 때', { config: 'broken' }],
    ]) {
      const { context, page } = await openPage(browser, { kakao: 'mock', config: 'mock', ...mode, init: fastTimers }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      const shown = await page.waitForFunction(() => {
        const m = document.getElementById('reloadMsg');
        return m && !m.hidden && m.textContent.includes('불러오지 못했어요');
      }, { timeout: 5000 }).then(() => true, () => false);
      expect(s, `${what}: 안내가 보임`, shown && await inView(page, '#reloadMsg'));
      expect(s, `${what}: 버전이 보임`, (await page.$eval('#ver', (el) => el.textContent)).length > 0);
      const moved = await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 5000 }).then(() => true, () => false),
        page.click('#topReload'),
      ]);
      expect(s, `${what}: 다시 불러오기 버튼이 살아 있음`, moved[0]);
      await context.close();
    }
    // 재발 방지(2026-11-05): 안내 위치 점검이 저장·로그인에만 걸려 위치·검색 안내가 화면 밖에 떠도 통과하던 문제
    {
      const denied = () => {
        navigator.geolocation.getCurrentPosition = (_ok, bad) => bad({ code: 1 });
      };
      const { context, page, errors } = await openPage(browser, { kakao: 'mock', config: 'mock', init: [asApp, denied] }, s);
      await page.goto(BASE, { waitUntil: 'load' });
      await waitCheck(page, 'map', 'ok');
      await page.type('#q', '없는장소');
      await page.keyboard.press('Enter');
      await waitCheck(page, 'search', 'ok');
      expect(s, '검색 0건 안내가 스크롤 없이 보임', await inViewSoon(page, '#nextMsg')
        && (await page.$eval('#nextMsg', (el) => el.textContent)).includes('결과는 없어요'));
      await page.click('#locate');
      expect(s, '위치 거부면 실패 표시', await waitCheck(page, 'gps', 'fail'));
      expect(s, '위치 거부 안내가 스크롤 없이 보임', await inViewSoon(page, '#nextMsg')
        && (await page.$eval('#nextMsg', (el) => el.textContent)).includes('Safari 웹 사이트'));
      await shot(page, 'h-gps-denied');
      await page.click('#locate');
      await waitCheck(page, 'gps', 'fail');
      expect(s, '스크립트 오류 없음(거부)', errors.length === 0, errors.join(' | '));
      await context.close();
    }
  });

  // J. 큰 화면 + 아래 안전 영역(홈 표시줄): Safari 도구막대가 없는 홈 화면 앱에 가까운 크기
  await scenario('J 큰 화면', async (s) => {
    const { context, page } = await openPage(browser, {
      kakao: 'mock', config: 'mock', init: asApp,
      viewport: { width: 402, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    }, s);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } }).catch(() => {});
    await page.goto(BASE, { waitUntil: 'load' });
    await waitCheck(page, 'map', 'ok');
    await layoutExpect(page, s);
    const covered = await page.evaluate(() => {
      const last = document.querySelector('.foot');
      last.scrollIntoView({ block: 'end' });
      return last.getBoundingClientRect().bottom <= window.innerHeight;
    });
    expect(s, '시트 끝 글자가 안 가려짐', covered);
    await shot(page, 'j-large');
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
