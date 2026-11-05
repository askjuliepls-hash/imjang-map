// 앱이 쓰는 Firebase 기능만 모아 vendor/firebase.js 한 파일로 묶습니다.
// 여기에 없는 이름을 앱에서 쓰면 build:vendor 단계에서 바로 실패합니다.
export { initializeApp } from 'firebase/app';
export {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
export {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
