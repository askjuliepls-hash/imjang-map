// 홈 화면 아이콘 PNG를 index.html의 표식(핀 + 십자)으로 만듭니다. 한 번 돌려 나온 파일을 커밋합니다.
// 사용법: node scripts/make-icons.mjs [A|B]   A 파란 바탕 흰 핀, B 흰 바탕 파란 핀
// 아이폰 아이콘은 불투명한 정사각형이어야 하고, 둥근 모서리는 iOS가 입힙니다.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ACCENT = '#468ade'; // css/app.css의 --accent
const WHITE = '#ffffff';
const STYLE = { A: { bg: ACCENT, pin: WHITE, cross: ACCENT }, B: { bg: WHITE, pin: ACCENT, cross: WHITE } };
const style = STYLE[process.argv[2] || 'A'];
if (!style) throw new Error('A 또는 B만 고를 수 있어요.');

const html = readFileSync('index.html', 'utf8');
const inner = html.match(/<svg class="mark"[\s\S]*?<\/svg>/)[0].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const page = (size, scale) => `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${style.bg}}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${style.pin};--surface:${style.cross}"><g transform="translate(12 12) scale(${scale}) translate(-12 -12)">${inner}</g></svg>`;

const JOBS = [
  ['apple-touch-icon.png', 180, 0.72],
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  ['icon-maskable-512.png', 512, 0.6], // 안드로이드가 둥글게 잘라도 표식이 안 잘리게 작게
];

mkdirSync('icons', { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const tab = await browser.newPage();
  for (const [name, size, scale] of JOBS) {
    await tab.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await tab.setContent(page(size, scale));
    writeFileSync(`icons/${name}`, await tab.screenshot({ type: 'png' }));
    console.log(`icons/${name} ${size}x${size}`);
  }
} finally {
  await browser.close();
}
