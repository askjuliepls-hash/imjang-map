import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAppleMobile, isStandalone, openPlace, parseAppVersion } from '../../js/lib/device.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  kakaoIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0',
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.8.0',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  naverIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 NAVER(inapp; search; 2000; 12.0)',
};

test('홈 화면 앱 신호 조합별 판정', () => {
  const media = (matches) => () => ({ matches });
  assert.equal(isStandalone({ standalone: true }, media(false)), true);
  assert.equal(isStandalone({ standalone: false }, media(true)), true);
  assert.equal(isStandalone({ standalone: false }, media(false)), false);
});

test('navigator.standalone이 없는 안드로이드도 판정한다', () => {
  assert.equal(isStandalone({}, () => ({ matches: true })), true);
  assert.equal(isStandalone({}, () => ({ matches: false })), false);
  assert.equal(isStandalone({}, undefined), false);
});

test('앱으로 열렸으면 어떤 기기든 app', () => {
  assert.equal(openPlace(UA.iphone, 5, true), 'app');
  assert.equal(openPlace(UA.androidPhone, 5, true), 'app');
});

test('아이폰 사파리와 터치 되는 아이패드는 ios-safari', () => {
  assert.equal(openPlace(UA.iphone, 5, false), 'ios-safari');
  assert.equal(openPlace(UA.ipadDesktop, 5, false), 'ios-safari');
});

test('터치가 없는 맥은 ios-safari가 아니다', () => {
  assert.equal(openPlace(UA.ipadDesktop, 0, false), 'other');
});

test('카카오톡 안은 아이폰·안드로이드 모두 kakao', () => {
  assert.equal(openPlace(UA.kakaoIphone, 5, false), 'kakao');
  assert.equal(openPlace(UA.kakaoAndroid, 5, false), 'kakao');
});

test('아이폰의 크롬·네이버 앱은 없는 공유 버튼을 안내하지 않게 other', () => {
  assert.equal(openPlace(UA.chromeIos, 5, false), 'other');
  assert.equal(openPlace(UA.naverIos, 5, false), 'other');
});

test('안드로이드·PC 브라우저는 other', () => {
  assert.equal(openPlace(UA.androidPhone, 5, false), 'other');
  assert.equal(openPlace(UA.windowsChrome, 0, false), 'other');
});

test('받은 화면에서 버전을 읽는다', () => {
  assert.equal(parseAppVersion('<meta name="app-version" content="0.3.0-1105a">'), '0.3.0-1105a');
  assert.equal(parseAppVersion('오류 화면'), '');
});

test('아이폰·터치 되는 아이패드만 애플 모바일로 친다', () => {
  assert.equal(isAppleMobile(UA.iphone, 5), true);
  assert.equal(isAppleMobile(UA.ipadDesktop, 5), true);
  assert.equal(isAppleMobile(UA.ipadDesktop, 0), false);
  assert.equal(isAppleMobile(UA.androidPhone, 5), false);
});
