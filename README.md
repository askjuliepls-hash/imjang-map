# 임장 지도

약국 매물 임장을 기록하는 개인용 지도 웹앱입니다. 카카오맵 위에 임장한 매물을 표시하고, 매물 정보·임장 후기·결정 사유를 남깁니다.

- 앱 주소: https://askjuliepls-hash.github.io/imjang-map/
- 지도: 카카오맵 JavaScript SDK
- 데이터: Firebase (Firestore, 이메일 로그인). 데이터는 보안 규칙으로 본인 계정만 읽고 쓸 수 있습니다.
- 코드에 들어 있는 카카오 JavaScript 키와 firebaseConfig는 원래 공개되는 값입니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `index.html` | 화면. 버전 꼬리표(`?v=`)와 import map이 여기 있습니다 |
| `js/app.js` | 앱 동작 |
| `js/lib/` | 화면과 무관한 순수 로직 (자동 테스트 대상) |
| `js/config.js` | 카카오 키, firebaseConfig |
| `vendor/firebase.js` | Firebase SDK 12.19.0을 한 파일로 묶은 것 (`npm run build:vendor`) |
| `tests/unit/` | 순수 로직 자동 테스트 |
| `tests/e2e/` | 가짜 지도·가짜 저장소로 폰 크기 화면을 조작하고 캡처하는 대행 검증 |

## 개발 명령

```
npm install
npm test                      # 순수 로직 테스트
npm run preview -- <폴더>     # 대행 검증 (크롬 필요), 캡처를 <폴더>에 저장
npm run release -- 0.1.1-1106a # 배포 전 버전 꼬리표 갱신
```

실제 카카오 지도·로그인·저장은 대행 검증으로 확인할 수 없으므로, 배포 후 폰에서 '연결 점검' 화면으로 확인합니다.
