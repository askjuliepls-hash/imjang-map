// 홈 화면 아이콘 PNG를 표식(핀 + 십자)으로 만듭니다. 한 번 돌려 나온 파일을 커밋합니다.
// 사용법: node scripts/make-icons.mjs
// 아이폰 아이콘은 불투명한 정사각형이어야 하고, 둥근 모서리는 iOS가 입힙니다.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = '#ffffff';
const PIN = '#F96949'; // css/app.css의 --accent
const CROSS = '#ffffff';

const inner = `<path d="M12 2.5c-4.1 0-7.5 3.2-7.5 7.3 0 5.3 6.4 11.1 6.7 11.4.4.4 1.1.4 1.5 0 .3-.3 6.8-6.1 6.8-11.4 0-4.1-3.4-7.3-7.5-7.3z" fill="currentColor"/><path d="M10.6 6.2h2.8v2.6H16v2.8h-2.6v2.6h-2.8v-2.6H8V8.8h2.6z" fill="var(--surface)"/>`;
const page = (size, scale) => `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${BG}}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${PIN};--surface:${CROSS}"><g transform="translate(12 12) scale(${scale}) translate(-12 -12)">${inner}</g></svg>`;

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
