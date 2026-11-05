// 지금 쓰는 기기를 사람이 알아볼 이름으로 바꿉니다.
// '다른 기기에서 저장한 값이 보이는지'(동기화) 확인에 씁니다.
export function deviceLabel(ua = '', maxTouchPoints = 0) {
  if (/iPhone/i.test(ua)) return 'iPhone';
  // iPadOS 13+ 사파리는 맥처럼 보이므로 터치 지점 수로 구분합니다.
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android 폰' : 'Android 태블릿';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux|CrOS/i.test(ua)) return 'PC';
  return '기타 기기';
}
