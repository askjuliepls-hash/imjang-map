import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kakaoLoadMessage, geoErrorMessage, standaloneHelp, kakaoInappMessage, saveErrorMessage, loadErrorMessage, importErrorMessage, exportFailMessage,
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

test('Safari 안내에는 추가 순서가, 그 밖에는 기본 브라우저 안내가 나온다', () => {
  assert.match(standaloneHelp('ios-safari'), /홈 화면에 추가/);
  assert.match(standaloneHelp('ios-safari'), /지우지/);
  assert.match(standaloneHelp('other'), /기본 브라우저/);
  assert.doesNotMatch(standaloneHelp('other'), /공유/);
});

test('카카오톡 안내는 아이폰과 안드로이드가 다르다', () => {
  assert.match(kakaoInappMessage('iPhone'), /Safari/);
  assert.match(kakaoInappMessage('Android'), /오른쪽 아래/);
});

test('저장 실패 안내는 이유마다 다르고 입력이 남아 있다고 알린다', () => {
  assert.notEqual(saveErrorMessage('quota'), saveErrorMessage('unavailable'));
  assert.match(saveErrorMessage('quota'), /그대로/);
  assert.match(saveErrorMessage('unknown', 'WeirdError'), /WeirdError/);
});

test('읽기 실패 안내는 덮어쓰지 않는다고 알린다', () => {
  assert.match(loadErrorMessage('corrupt'), /덮어쓰지/);
});

test('가져오기 실패는 지금 내용이 그대로라고 알린다', () => {
  for (const r of ['read-failed', 'empty', 'too-big', 'encoding', 'bad-json', 'other-app', 'newer', 'test-file', 'bad-shape', 'x']) {
    assert.match(importErrorMessage(r), /그대로예요/, r);
  }
});

test('모르는 오류 이름이 그대로 보인다(백업)', () => {
  assert.match(exportFailMessage('WeirdError'), /WeirdError/);
  assert.match(importErrorMessage('read-failed', 'WeirdError'), /WeirdError/);
});
