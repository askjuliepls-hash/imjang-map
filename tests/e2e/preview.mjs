// 대행 검증: 아이폰 크기 화면에서 앱을 자동으로 조작하고 캡처합니다.
// 진짜 카카오·Firebase 대신 tests/e2e/mocks 의 가짜를 끼워 넣습니다.
// 사용법: npm run preview -- [캡처 저장 폴더]
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
  firebase: await readFile(join(ROOT, 'tests/e2e/mocks/firebase.js'), 'utf8'),
  config: await readFile(join(ROOT, 'tests/e2e/mocks/config.js'), 'utf8'),
};

// mode: kakao 'mock' | '503' | 'block', firebase 'mock' | 'real', config 'mock' | 'real'
async function openPage(browser, mode, scenario) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(ORIGIN, ['geolocation']);
  const page = await context.newPage();
  await page.setUserAgent(IPHONE_UA);
  await page.setViewport(PHONE);
  await page.setGeolocation({ latitude: 37.5668, longitude: 126.9786, accuracy: 24 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const requests = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    requests.push(u.pathname + u.search);
    const js = (body) => req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
    if (u.hostname === 'dapi.kakao.com') {
      if (mode.kakao === 'mock') return js(mocks.kakao);
      if (mode.kakao === '503') return req.respond({ status: 503, contentType: 'text/plain', body: 'domain not registered' });
      return req.abort();
    }
    if (u.origin === ORIGIN && u.pathname.endsWith('/js/config.js') && mode.config === 'mock') return js(mocks.config);
    if (u.origin === ORIGIN && u.pathname.endsWith('/vendor/firebase.js') && mode.firebase === 'mock') return js(mocks.firebase);
    if (u.origin !== ORIGIN) return req.abort();
    return req.continue();
  });
  return { context, page, errors, requests, scenario };
}

const checkState = (page, id) => page.$eval(`[data-check="${id}"]`, (li) => li.dataset.state);
const waitCheck = (page, id, state, timeout = 6000) =>
  page.waitForSelector(`[data-check="${id}"][data-state="${state}"]`, { timeout }).then(() => true, () => false);

async function layout(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const visibleInputs = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null);
    const small = visibleInputs.filter((i) => parseFloat(getComputedStyle(i).fontSize) < 16).map((i) => i.id);
    const clipped = [...document.querySelectorAll('.check .name, .check .msg, .btn, .score, .results strong, .results span, .fab, .last-save')]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}:${el.textContent.trim().slice(0, 16)}`);
    return { overflowX: document.documentElement.scrollWidth > vw + 1, small, clipped };
  });
}

async function layoutExpect(page, scenario) {
  const l = await layout(page);
  expect(scenario, '가로 스크롤 없음', !l.overflowX);
  expect(scenario, '입력칸 글씨 16px 이상(아이폰 확대 방지)', l.small.length === 0, l.small.join(', '));
  expect(scenario, '잘린 글자 없음', l.clipped.length === 0, l.clipped.join(' | '));
}

// 재발 방지(2026-11-05): 로그인·저장 버튼이 점검 목록 아래에 숨어 스크롤해야 보이던 문제
const inView = (page, sel) => page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
});

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

await mkdir(OUT, { recursive: true });
await new Promise((r) => server.listen(PORT, r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });

try {
  // A. 설정값이 없는 지금 상태 (실제 config.js)
  {
    const s = 'A 설정 전';
    const { context, page, errors, requests } = await openPage(browser, { kakao: 'block', firebase: 'real', config: 'real' }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    expect(s, '지도 점검이 실패로, 이유와 함께 표시', await waitCheck(page, 'map', 'fail'));
    expect(s, '로그인 점검이 실패로, 이유와 함께 표시', await waitCheck(page, 'login', 'fail'));
    expect(s, '지도 자리에 안내 문구', await page.$eval('#mapMsg', (el) => !el.hidden && el.textContent.includes('지도 준비 전')));
    expect(s, '검색 입력 잠김', await page.$eval('#q', (el) => el.disabled));
    const appVersion = (await readFile(join(ROOT, 'index.html'), 'utf8')).match(/name="app-version" content="([^"]+)"/)[1];
    expect(s, '버전 표시', (await page.$eval('#ver', (el) => el.textContent)) === appVersion, appVersion);
    const versioned = requests.filter((r) => /\/js\/(config|lib\/)/.test(r));
    expect(s, '모듈 파일이 버전 꼬리표(?v=)로 요청됨(캐시 방지)', versioned.length >= 4 && versioned.every((r) => r.includes('?v=')), versioned.join(' '));
    // 진짜 Firebase 묶음이 크롬에서 실행되는지 (네트워크 없이 초기화까지)
    const sdk = await page.evaluate(async () => {
      try {
        const m = await import('./vendor/firebase.js');
        const app = m.initializeApp({ apiKey: 'x', projectId: 'demo-test', appId: '1:1:web:1' }, 'probe');
        m.getAuth(app);
        m.getFirestore(app);
        return { ok: true, names: Object.keys(m).sort().join(',') };
      } catch (e) { return { ok: false, err: String(e) }; }
    });
    expect(s, '진짜 Firebase 묶음이 열리고 초기화됨', sdk.ok, sdk.names || sdk.err);
    await layoutExpect(page, s);
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await shot(page, 'a-unconfigured');
    await context.close();
  }

  // B. 모든 연결이 되는 경우 (가짜 지도·가짜 저장소)
  {
    const s = 'B 연결됨';
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', firebase: 'mock', config: 'mock' }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    expect(s, '지도 통과', await waitCheck(page, 'map', 'ok'));
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    expect(s, '검색 통과', await waitCheck(page, 'search', 'ok'));
    expect(s, '검색 결과 목록 표시', await page.$eval('#results', (el) => !el.hidden && el.querySelectorAll('button').length === 2));
    await shot(page, 'b1-search-results');
    await page.click('#results button');
    expect(s, '결과를 누르면 목록이 닫힘', await page.$eval('#results', (el) => el.hidden));
    await page.click('#locate');
    expect(s, '내 위치 통과', await waitCheck(page, 'gps', 'ok'));
    expect(s, '내 위치 점 표시', !!(await page.$('.me-dot')));
    await page.type('#email', 'me@example.com');
    await page.type('#password', 'test1234');
    await page.click('#loginBtn');
    expect(s, '로그인 통과', await waitCheck(page, 'login', 'ok'));
    expect(s, '로그인 후 테스트 저장 버튼이 스크롤 없이 보임', await inView(page, '#saveBtn'));
    expect(s, '상단에 로그인 이메일', (await page.$eval('#who', (el) => el.textContent)) === 'me@example.com');
    await page.click('#saveBtn');
    expect(s, "저장 직후 '진행 중'(새로고침 안내)", await waitCheck(page, 'persist', 'half'));
    // 재발 방지(2026-11-05): 결과 안내가 화면 밖 점검 목록에만 떠서 눌러도 반응 없어 보이던 문제
    expect(s, '저장 버튼 근처에 새로고침 안내가 보임', await inView(page, '#saveMsg')
      && (await page.$eval('#saveMsg', (el) => el.textContent)).includes('새로고침'));
    expect(s, '저장 시각·기기 표시', /마지막 저장 · 오늘 .* · iPhone$/.test(await page.$eval('#lastSave', (el) => el.textContent)));
    await shot(page, 'b2-saved');
    await page.reload({ waitUntil: 'load' });
    expect(s, '새로고침 후 로그인 유지', await waitCheck(page, 'login', 'ok'));
    expect(s, '새로고침 후 저장값 유지 → 통과', await waitCheck(page, 'persist', 'ok'));
    expect(s, '같은 기기에서는 다른 기기 점검이 대기', (await checkState(page, 'sync')) === 'wait');
    // 다른 기기(PC)에서 저장한 상황을 흉내 냄
    await page.evaluate(() => {
      const k = 'mock.fs.users/test-uid/meta/ping';
      const d = JSON.parse(localStorage.getItem(k));
      d.device = 'Windows PC';
      localStorage.setItem(k, JSON.stringify(d));
    });
    await page.reload({ waitUntil: 'load' });
    expect(s, '다른 기기 저장값이 보이면 통과', await waitCheck(page, 'sync', 'ok'));
    await page.click('#locate');
    await page.type('#q', '테스트 장소');
    await page.keyboard.press('Enter');
    await waitCheck(page, 'search', 'ok');
    await page.click('#results button');
    await waitCheck(page, 'gps', 'ok');
    expect(s, '점수 6/6', (await page.$eval('#score', (el) => el.textContent)) === '6개 모두 통과');
    await layoutExpect(page, s);
    await shot(page, 'b3-all-pass');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await shot(page, 'b4-dark');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.click('#sheetToggle');
    expect(s, '점검 접으면 지도가 커짐', await page.$eval('#sheetBody', (el) => el.offsetParent === null));
    await shot(page, 'b5-collapsed');
    await page.click('#sheetToggle');
    await page.click('#logoutBtn');
    expect(s, '로그아웃하면 로그인 칸이 다시 보임', await page.waitForSelector('#loginForm:not([hidden])', { timeout: 3000 }).then(() => true, () => false));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // C. 카카오가 도메인 미등록으로 거절하는 경우 (503)
  {
    const s = 'C 지도 거절';
    const { context, page, errors } = await openPage(browser, { kakao: '503', firebase: 'mock', config: 'mock' }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    expect(s, '지도 실패', await waitCheck(page, 'map', 'fail'));
    const msg = await page.$eval('[data-check="map"] .msg', (el) => el.textContent);
    expect(s, '안내에 등록할 도메인이 그대로 나옴', msg.includes(ORIGIN), msg);
    await page.click('#locate');
    expect(s, '지도가 없어도 위치 점검은 독립적으로 작동', await waitCheck(page, 'gps', 'ok'));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await shot(page, 'c-map-rejected');
    await context.close();
  }

  // D. 비밀번호가 틀린 경우
  {
    const s = 'D 로그인 실패';
    const { context, page, errors } = await openPage(browser, { kakao: 'mock', firebase: 'mock', config: 'mock' }, s);
    await page.goto(BASE, { waitUntil: 'load' });
    await waitCheck(page, 'map', 'ok');
    expect(s, '로그인 버튼이 스크롤 없이 보임', await inView(page, '#loginBtn'));
    await page.type('#email', 'me@example.com');
    await page.type('#password', 'wrong');
    await page.click('#loginBtn');
    expect(s, '로그인 실패와 이유 표시', await waitCheck(page, 'login', 'fail'));
    expect(s, '로그인 버튼 근처에 실패 이유가 보임', await inView(page, '#loginMsg')
      && (await page.$eval('#loginMsg', (el) => el.textContent)).includes('비밀번호'));
    expect(s, '로그인 버튼이 다시 눌림', await page.$eval('#loginBtn', (el) => !el.disabled && el.textContent === '로그인하기'));
    expect(s, '스크립트 오류 없음', errors.length === 0, errors.join(' | '));
    await shot(page, 'd-login-failed');
    await context.close();
  }
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
