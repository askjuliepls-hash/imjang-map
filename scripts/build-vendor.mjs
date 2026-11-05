// Firebase SDK를 브라우저용 ESM 한 파일로 묶습니다.
// 사용법: npm run build:vendor  (Firebase 버전을 올릴 때만 다시 실행)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('node_modules/firebase/package.json', 'utf8'));

await build({
  entryPoints: ['scripts/firebase-entry.js'],
  outfile: 'vendor/firebase.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  minify: true,
  legalComments: 'eof',
  banner: { js: `/* Firebase JS SDK ${version} (Apache-2.0), bundled for imjang-map */` },
  logLevel: 'info',
});
