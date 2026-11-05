import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kakaoLoadMessage, firebaseLoadMessage, authErrorMessage, firestoreErrorMessage, geoErrorMessage,
} from '../../js/lib/messages.js';

test('카카오 로드 실패 안내에 실제 앱 도메인이 들어간다', () => {
  const msg = kakaoLoadMessage('load-failed', 'https://askjuliepls-hash.github.io');
  assert.match(msg, /https:\/\/askjuliepls-hash\.github\.io/);
  assert.match(msg, /카카오맵 사용 설정/);
});

test('키가 없을 때와 시간 초과는 서로 다른 안내', () => {
  assert.notEqual(kakaoLoadMessage('no-key'), kakaoLoadMessage('timeout'));
});

test('비밀번호 오류 계열은 같은 안내로 묶는다', () => {
  const a = authErrorMessage('auth/invalid-credential');
  assert.equal(authErrorMessage('auth/wrong-password'), a);
  assert.equal(authErrorMessage('auth/user-not-found'), a);
});

test('이메일 로그인이 꺼져 있으면 켜는 위치를 알려준다', () => {
  assert.match(authErrorMessage('auth/operation-not-allowed'), /로그인 방법/);
});

test('모르는 오류 코드는 코드를 그대로 보여준다', () => {
  assert.match(authErrorMessage('auth/something-new'), /auth\/something-new/);
  assert.match(firestoreErrorMessage('weird'), /weird/);
});

test('저장 거부는 보안 규칙을 가리킨다', () => {
  assert.match(firestoreErrorMessage('permission-denied'), /규칙/);
});

test('위치 권한 거부는 아이폰 설정 경로를 알려준다', () => {
  assert.match(geoErrorMessage(1), /위치 서비스/);
  assert.notEqual(geoErrorMessage(2), geoErrorMessage(3));
});

test('Firebase 설정 없음과 로드 실패는 다른 안내', () => {
  assert.notEqual(firebaseLoadMessage('no-config'), firebaseLoadMessage('load-failed'));
});
