import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const version = html.match(/name="app-version" content="([^"]+)"/)[1];
const mapText = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];

function modules(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return modules(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

// 재발 방지(2026-11-05): 줄 끝 쉼표 하나로 import map 전체가 무효가 되면 모든 모듈이 ?v= 없이 요청됩니다.
test('import map이 올바른 JSON이다', () => {
  assert.doesNotThrow(() => JSON.parse(mapText));
});

test('js 아래 app.js를 뺀 모든 모듈이 import map에 있고 꼬리표가 앱 버전과 같다', () => {
  const { imports } = JSON.parse(mapText);
  const files = modules(join(ROOT, 'js'))
    .map((f) => `./${relative(ROOT, f).split(sep).join('/')}`)
    .filter((f) => f !== './js/app.js');
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.equal(imports[f], `${f}?v=${version}`, `${f} 항목이 없거나 꼬리표가 달라요`);
  }
});

test('Firebase 흔적이 없다', () => {
  assert.doesNotMatch(mapText, /firebase/i);
});
