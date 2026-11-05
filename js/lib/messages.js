// 오류를 '무엇이 잘못됐고 어떻게 고치는지' 한 문장으로 바꿉니다.

export function kakaoLoadMessage(reason, origin = '') {
  const domain = origin || '이 앱 주소';
  switch (reason) {
    case 'no-key':
      return '카카오 JavaScript 키가 없어요. Claude에게 알려 주세요.';
    case 'load-failed':
      return `카카오 지도를 불러오지 못했어요. 카카오 콘솔에서 JavaScript SDK 도메인 등록과 카카오맵 사용 설정을 확인해 주세요. 등록할 주소: ${domain}`;
    case 'sdk-missing':
      return '카카오 지도 파일은 받았지만 내용이 비어 있어요. JavaScript 키가 맞는지 확인해 주세요.';
    case 'timeout':
      return "카카오 지도가 15초 안에 응답하지 않았어요. 인터넷 연결을 확인하고 위쪽 '다시 불러오기'를 눌러 주세요.";
    case 'tiles-timeout':
      return "지도 칸은 만들었지만 지도 그림이 15초 안에 안 떴어요. 인터넷 연결을 확인하고 위쪽 '다시 불러오기'를 눌러 주세요.";
    default:
      return "카카오 지도를 불러오지 못했어요. 위쪽 '다시 불러오기'를 눌러 보고, 계속되면 Claude에게 알려 주세요.";
  }
}

export function geoErrorMessage(code) {
  switch (code) {
    case 1:
      return '위치 권한이 거부됐어요. 아이폰 설정 > 개인정보 보호 및 보안 > 위치 서비스가 켜져 있는지, 그 안의 Safari 웹 사이트 항목도 확인하고, 앱을 완전히 닫았다 다시 열어 눌러 주세요.';
    case 2:
      return '현재 위치를 알 수 없어요. 실외나 창가에서 다시 눌러 주세요.';
    case 3:
      return '위치를 찾는 데 시간이 너무 걸렸어요. 다시 눌러 주세요.';
    default:
      return '위치를 가져오지 못했어요.';
  }
}

// 아직 앱이 아닐 때 카드에 보여 줄 안내입니다.
export function standaloneHelp(place) {
  if (place === 'ios-safari') {
    return [
      '아직 Safari예요. 이미 쓰던 아이콘이 있으면 그 아이콘으로 여세요. 저장한 내용이 있으면 아이콘을 지우지 마세요.',
      '아이콘이 없으면 아래 순서로 추가해 주세요.',
      '1. 화면의 … 또는 공유 버튼 누르기',
      "2. '공유' 누르기 (바로 공유 창이 뜨면 건너뛰기)",
      "3. 아래로 내려 '홈 화면에 추가' 누르기",
      "4. '웹 앱으로 열기' 켜고 '추가' 누르기",
    ].join('\n');
  }
  return '폰의 기본 브라우저(아이폰은 Safari)에서 askjuliepls-hash.github.io/imjang-map 주소를 열어 홈 화면에 추가해 주세요.';
}

export function kakaoInappMessage(ua = '') {
  if (/Android/i.test(ua)) {
    return "카카오톡 안에서 열렸어요. 오른쪽 아래 메뉴의 '다른 브라우저로 열기'를 눌러 주세요.";
  }
  return "카카오톡 안에서 열렸어요. 여기 저장한 내용은 다른 곳에서 안 보여요. 위쪽 가운데 주소를 눌러 '다른 브라우저로 열기'로 Safari에서 열어 주세요.";
}

export const NOT_APP_YET = '아이콘으로 연 뒤에 할 수 있어요.';

// 저장 유지 행의 단계별 안내. phase: 'none' | 'saved' | 'reloaded' | 'reopened'
export function persistMessage(phase, code = '', when = '') {
  switch (phase) {
    case 'saved':
      return `저장했어요. 코드 ${code}을 기억해 주세요. 위쪽 '다시 불러오기'를 누른 뒤, 앱을 완전히 닫았다가 아이콘으로 다시 열어 주세요.`;
    case 'reloaded':
      return [
        `다시 불러와도 코드 ${code}이 남아 있어요. 마지막으로 앱을 완전히 닫았다가 아이콘으로 다시 열어 주세요.`,
        '닫는 법: 화면 맨 아래에서 위로 쓸어 올려 멈춘 뒤, 이 앱을 위로 밀어요.',
      ].join('\n');
    case 'reopened':
      return `다시 열어도 코드 ${code}이 남아 있어요. 저장 시각 ${when}.`;
    default:
      return "아직 저장한 시험 값이 없어요. '저장 시험하기'를 눌러 주세요.";
  }
}

export function storeErrorMessage(reason, detail = '') {
  switch (reason) {
    case 'quota':
      return '저장 공간이 가득 차서 저장하지 못했어요. 캡처를 Claude에게 보내 주세요.';
    case 'unavailable':
      return '이 기기에 저장이 막혀 있어요. 캡처를 Claude에게 보내 주세요.';
    case 'verify-failed':
      return '저장한 값을 다시 읽어 보니 달라요. 캡처를 Claude에게 보내 주세요.';
    case 'corrupt':
      return "시험 값이 깨져 있어요. '저장 시험하기'를 다시 눌러 주세요.";
    default:
      return `저장하지 못했어요. (${detail || reason})`;
  }
}

// 백업 보관은 카톡 나와의 채팅(2026-11-05 사용자 결정)
export function exportHelp(apple) {
  return apple ? "누른 뒤 '카카오톡' → '나와의 채팅'으로 보내 주세요." : '누르면 파일이 저장돼요.';
}

export function exportFailMessage(name) {
  return `공유 창을 열지 못했어요. (${name}) '파일로 바로 저장'을 눌러 보세요. 화면이 막히면 앱을 닫았다 다시 열어 주세요.`;
}

export function importHelp() {
  return "카톡에서 받은 파일을 파일 앱에 저장한 뒤, 메뉴가 뜨면 '파일 선택'으로 골라 주세요. 지금 있는 내용은 바뀌지 않아요. 선택창이 안 닫히거나 안 뜨면 앱을 닫았다 다시 열어 주세요.";
}

const STILL_SAFE = ' 지금 있는 내용은 그대로예요.';

export function importErrorMessage(reason, detail = '') {
  switch (reason) {
    case 'not-this-run':
      return '올바른 백업 파일이지만 이번에 내보낸 파일이 아니에요. 방금 보낸 파일을 골라 주세요.';
    case 'read-failed':
      return `파일을 읽지 못했어요. (${detail || '알 수 없는 오류'})${STILL_SAFE}`;
    case 'empty':
      return `빈 파일이에요.${STILL_SAFE}`;
    case 'too-big':
      return `파일이 너무 커요. 내보낸 백업 파일을 골랐는지 봐 주세요.${STILL_SAFE}`;
    case 'encoding':
      return `글자 형식이 달라요. 사진이 아니라 내보낸 백업 파일을 골랐는지 봐 주세요.${STILL_SAFE}`;
    case 'bad-json':
      return `파일이 잘렸거나 손상됐어요. 사진이 아니라 내보낸 백업 파일을 골랐는지 봐 주세요.${STILL_SAFE}`;
    case 'other-app':
      return `임장노트 백업 파일이 아니에요.${STILL_SAFE}`;
    case 'newer':
      return `더 새 버전 앱에서 만든 파일이에요. 위쪽 '다시 불러오기'를 누른 뒤 다시 해 주세요.${STILL_SAFE}`;
    case 'probe-diff':
      return `파일 내용이 내보낼 때와 달라요. 옮기는 중에 바뀐 것 같아요. 캡처를 Claude에게 보내 주세요.${STILL_SAFE}`;
    default:
      return `가져오지 못했어요. (${reason})${STILL_SAFE}`;
  }
}
