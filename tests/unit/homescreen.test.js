import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// PNG 머리 정보: 16~23바이트가 크기, 25바이트가 색 형식(2 RGB, 6 RGBA)
function png(path) {
  const b = readFileSync(join(ROOT, path));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

test('index.html이 manifest와 아이폰 아이콘을 연결한다', () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png">/);
});

test('id는 하위 경로로 고정되고 시작 주소는 범위 안이며 앱으로 열린다', () => {
  // './'로 쓰면 규격상 도메인 루트가 되어 같은 계정의 다른 프로젝트와 겹칠 수 있어요.
  assert.equal(manifest.id, '/imjang-map/');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
});

test('manifest의 아이콘 파일이 실제로 있고 크기가 맞다', () => {
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
    const size = png(icon.src);
    assert.equal(`${size.width}x${size.height}`, icon.sizes, icon.src);
  }
});

test('아이폰 아이콘은 180 크기의 불투명 이미지다', () => {
  const size = png('icons/apple-touch-icon.png');
  assert.equal(size.width, 180);
  assert.equal(size.height, 180);
  assert.equal(size.colorType, 2, '투명 채널이 있으면 iOS가 검게 채울 수 있어요');
});
