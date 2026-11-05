import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLabel } from '../../js/lib/device.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  kakaotalkIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0',
};

test('아이폰 사파리는 iPhone', () => {
  assert.equal(deviceLabel(UA.iphone, 5), 'iPhone');
});

test('아이폰 안의 카카오톡 브라우저도 iPhone', () => {
  assert.equal(deviceLabel(UA.kakaotalkIphone, 5), 'iPhone');
});

test('맥처럼 보이는 아이패드는 터치 지점으로 iPad', () => {
  assert.equal(deviceLabel(UA.ipadDesktop, 5), 'iPad');
});

test('같은 문자열이라도 터치가 없으면 Mac', () => {
  assert.equal(deviceLabel(UA.ipadDesktop, 0), 'Mac');
});

test('윈도우 크롬은 Windows PC', () => {
  assert.equal(deviceLabel(UA.windowsChrome, 0), 'Windows PC');
});

test('안드로이드 폰과 태블릿 구분', () => {
  assert.equal(deviceLabel(UA.androidPhone, 5), 'Android 폰');
  assert.equal(deviceLabel(UA.androidTablet, 5), 'Android 태블릿');
});

test('알 수 없으면 기타 기기', () => {
  assert.equal(deviceLabel('', 0), '기타 기기');
  assert.equal(deviceLabel(), '기타 기기');
});
