// 앱이 어디에서 열렸는지 판단합니다. 안내 문구를 고르는 데만 쓰고, 통과 판정은 standalone 값으로만 합니다.

export function isStandalone(nav, matchMedia) {
  return nav?.standalone === true || !!matchMedia?.('(display-mode: standalone)')?.matches;
}

// 사파리처럼 보이지만 다른 앱·브라우저인 경우의 표시입니다.
const OTHER_APP = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|NAVER|DaumApps|Whale|Line\/|Instagram|FBAN|FBAV|SamsungBrowser/i;

export function isAppleMobile(ua = '', maxTouchPoints = 0) {
  return /iPhone|iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
}

// 받은 index.html에서 버전을 읽습니다. 새 버전이 있는지 확인할 때 씁니다.
export function parseAppVersion(html) {
  return /name="app-version" content="([^"]+)"/.exec(String(html ?? ''))?.[1] ?? '';
}

// 'app' 홈 화면 앱 | 'kakao' 카카오톡 안 | 'ios-safari' 아이폰·아이패드 사파리 | 'other' 그 밖
// 잘못 분류되면 없는 공유 버튼을 안내하게 되니, 애매하면 'other'로 보냅니다.
export function openPlace(ua = '', maxTouchPoints = 0, standalone = false) {
  if (standalone) return 'app';
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (isAppleMobile(ua, maxTouchPoints) && /Version\//.test(ua) && /Safari\//.test(ua) && !OTHER_APP.test(ua)) return 'ios-safari';
  return 'other';
}
