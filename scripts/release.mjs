// 새 버전을 올릴 때 index.html의 버전 꼬리표(?v=)를 한 번에 바꿉니다.
// 브라우저가 예전 파일을 붙잡고 있지 않게 하는 장치입니다.
// 사용법: npm run release -- 0.1.1-1106a
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2];
if (!next || !/^[0-9A-Za-z.-]+$/.test(next)) {
  console.error('사용법: npm run release -- 0.1.1-1106a');
  process.exit(1);
}
const file = 'index.html';
const html = readFileSync(file, 'utf8');
const current = html.match(/<meta name="app-version" content="([^"]+)">/)?.[1];
if (!current) throw new Error('index.html에서 app-version을 찾지 못했어요.');
if (current === next) throw new Error(`이미 ${next} 입니다.`);
const count = html.split(current).length - 1;
writeFileSync(file, html.replaceAll(current, next));
console.log(`${current} → ${next} (${count}곳 바꿈)`);
