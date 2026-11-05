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

test('지도 안내에 새로고침이 없다(홈 화면 앱에는 새로고침 버튼이 없음)', () => {
  for (const r of ['no-key', 'load-failed', 'sdk-missing', 'timeout', 'tiles-timeout', 'other']) {
    assert.doesNotMatch(kakaoLoadMessage(r), /새로고침/);
  }
});

test('위치 권한 거부는 아이폰 설정 경로를 알려준다', () => {
  assert.match(geoErrorMessage(1), /위치 서비스/);
  assert.match(geoErrorMessage(1), /Safari 웹 사이트/);
  assert.notEqual(geoErrorMessage(2), geoErrorMessage(3));
});
