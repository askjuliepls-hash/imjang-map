// 1단계 준비가 끝나면 Claude가 채웁니다.
// 두 값 모두 앱 코드에 들어가 원래 공개되는 값입니다.
// - 카카오 JavaScript 키: 등록한 도메인에서만 작동합니다.
// - firebaseConfig: 데이터는 보안 규칙과 로그인으로 보호됩니다.
// 비밀번호, 카카오 REST API·Admin 키, Firebase 서비스 계정 키는 절대 여기에 넣지 않습니다.

export const KAKAO_JS_KEY = '9ace620dd84937a9fd94c4a919fc524f'; // 카카오 앱 '약국 임장노트'(ID 1638441)의 JavaScript 키

// Firebase는 보류(2026-11-05 결정: 폰에만 저장 + 백업). 다음 작업에서 로그인·저장 코드와 함께 제거 예정.
export const FIREBASE_CONFIG = null;
