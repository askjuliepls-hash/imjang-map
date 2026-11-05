// 오류를 '무엇이 잘못됐고 어떻게 고치는지' 한 문장으로 바꿉니다.

export function kakaoLoadMessage(reason, origin = '') {
  const domain = origin || '이 앱 주소';
  switch (reason) {
    case 'no-key':
      return '카카오 JavaScript 키가 아직 없어요. 1단계 준비가 끝나면 Claude가 넣습니다.';
    case 'load-failed':
      return `카카오 지도를 불러오지 못했어요. 카카오 콘솔에서 JavaScript SDK 도메인 등록과 카카오맵 사용 설정을 확인해 주세요. 등록할 주소: ${domain}`;
    case 'sdk-missing':
      return '카카오 지도 파일은 받았지만 내용이 비어 있어요. JavaScript 키가 맞는지 확인해 주세요.';
    case 'timeout':
      return '카카오 지도가 15초 안에 응답하지 않았어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
    case 'tiles-timeout':
      return '지도 칸은 만들었지만 지도 그림이 15초 안에 안 떴어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
    default:
      return '카카오 지도를 불러오지 못했어요. 새로고침해 보고, 계속되면 Claude에게 알려주세요.';
  }
}

export function geoErrorMessage(code) {
  switch (code) {
    case 1:
      return '위치 권한이 거부됐어요. 아이폰 설정 > 개인정보 보호 및 보안 > 위치 서비스 > Safari 웹 사이트를 허용으로 바꾼 뒤 다시 눌러 주세요.';
    case 2:
      return '현재 위치를 알 수 없어요. 실외나 창가에서 다시 눌러 주세요.';
    case 3:
      return '위치를 찾는 데 시간이 너무 걸렸어요. 다시 눌러 주세요.';
    default:
      return '위치를 가져오지 못했어요.';
  }
}
