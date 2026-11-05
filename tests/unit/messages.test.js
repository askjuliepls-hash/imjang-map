import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kakaoLoadMessage, geoErrorMessage,
} from '../../js/lib/messages.js';

test('카카오 로드 실패 안내에 실제 앱 도메인이 들어간다', () => {
  const msg = kakaoLoadMessage('load-failed', 'https://askjuliepls-hash.github.io');
  assert.match(msg, /https:\/\/askjuliepls-hash\.github\.io/);
  assert.match(msg, /카카오맵 사용 설정/);
});

test('키가 없을 때와 시간 초과는 서로 다른 안내', () => {
  assert.notEqual(kakaoLoadMessage('no-key'), kakaoLoadMessage('timeout'));
});

test('위치 권한 거부는 아이폰 설정 경로를 알려준다', () => {
  assert.match(geoErrorMessage(1), /위치 서비스/);
  assert.notEqual(geoErrorMessage(2), geoErrorMessage(3));
});
