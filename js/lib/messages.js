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

export function firebaseLoadMessage(reason) {
  if (reason === 'no-config') {
    return 'Firebase 설정값이 아직 없어요. 1단계 준비가 끝나면 Claude가 넣습니다.';
  }
  return 'Firebase 파일을 불러오지 못했어요. 새로고침해 보고, 계속되면 Claude에게 알려주세요.';
}

export function authErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return '이메일 또는 비밀번호가 맞지 않아요. Firebase 콘솔에서 만든 계정인지 확인해 주세요.';
    case 'auth/invalid-email':
      return '이메일 형식이 올바르지 않아요.';
    case 'auth/missing-password':
      return '비밀번호를 입력해 주세요.';
    case 'auth/user-disabled':
      return '사용이 중지된 계정이에요. Firebase 콘솔의 Authentication > Users에서 확인해 주세요.';
    case 'auth/too-many-requests':
      return '로그인 시도가 너무 많아 잠시 막혔어요. 몇 분 뒤 다시 해 주세요.';
    case 'auth/network-request-failed':
      return '인터넷 연결을 확인해 주세요.';
    case 'auth/operation-not-allowed':
      return '이메일/비밀번호 로그인이 꺼져 있어요. Firebase 콘솔의 Authentication > 로그인 방법에서 사용 설정해 주세요.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'Firebase 설정값(apiKey)이 맞지 않아요. firebaseConfig를 다시 확인해 주세요.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication이 아직 시작되지 않았어요. 콘솔에서 Authentication > 시작하기를 눌러 주세요.';
    default:
      return `로그인하지 못했어요. (${code || '알 수 없는 오류'})`;
  }
}

export function firestoreErrorMessage(code) {
  switch (code) {
    case 'permission-denied':
      return '저장이 거부됐어요. Firestore 규칙을 가이드대로 붙여넣고 게시했는지 확인해 주세요.';
    case 'not-found':
    case 'failed-precondition':
      return 'Firestore 데이터베이스가 준비되지 않았어요. 콘솔에서 데이터베이스 만들기를 했는지 확인해 주세요.';
    case 'unavailable':
      return '저장 서버에 닿지 않아요. 인터넷 연결을 확인해 주세요.';
    case 'unauthenticated':
      return '로그인이 풀렸어요. 다시 로그인해 주세요.';
    case 'resource-exhausted':
      return '무료 사용 한도를 넘었어요. Claude에게 알려주세요.';
    default:
      return `저장하지 못했어요. (${code || '알 수 없는 오류'})`;
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
