// 테스트 전용 가짜 Firebase. 로그인과 저장을 브라우저 localStorage로 흉내 냅니다.
// 진짜 vendor/firebase.js와 같은 이름의 기능만 내보냅니다.
const USER_KEY = 'mock.auth.user';
const docKey = (path) => `mock.fs.${path}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const authListeners = [];
const docListeners = {};

export function initializeApp(config) { return { config }; }

export function getAuth() {
  return { currentUser: JSON.parse(localStorage.getItem(USER_KEY) || 'null') };
}

export function onAuthStateChanged(auth, cb) {
  authListeners.push(cb);
  setTimeout(() => cb(auth.currentUser), 30);
  return () => {};
}

export async function signInWithEmailAndPassword(auth, email, password) {
  await wait(80);
  if (password !== 'test1234') {
    const e = new Error('invalid');
    e.code = 'auth/invalid-credential';
    throw e;
  }
  auth.currentUser = { uid: 'test-uid', email };
  localStorage.setItem(USER_KEY, JSON.stringify(auth.currentUser));
  authListeners.forEach((cb) => cb(auth.currentUser));
  return { user: auth.currentUser };
}

export async function signOut(auth) {
  auth.currentUser = null;
  localStorage.removeItem(USER_KEY);
  authListeners.forEach((cb) => cb(null));
}

export function getFirestore() { return {}; }
export function doc(_db, ...segments) { return { path: segments.join('/') }; }
export function serverTimestamp() { return { mockServerTimestamp: true }; }

function snapshotOf(stored, metadata) {
  return {
    exists: () => !!stored,
    data: () => stored && { ...stored, savedAt: { toDate: () => new Date(stored.savedAt) } },
    metadata,
  };
}

function emit(path, stored, metadata) {
  (docListeners[path] || []).forEach((cb) => cb(snapshotOf(stored, metadata)));
}

export async function setDoc(ref, data) {
  const stored = { ...data, savedAt: Date.now() };
  emit(ref.path, stored, { fromCache: true, hasPendingWrites: true });
  await wait(120);
  localStorage.setItem(docKey(ref.path), JSON.stringify(stored));
  emit(ref.path, stored, { fromCache: false, hasPendingWrites: false });
}

export function onSnapshot(ref, _options, onNext) {
  (docListeners[ref.path] = docListeners[ref.path] || []).push(onNext);
  setTimeout(() => {
    const raw = localStorage.getItem(docKey(ref.path));
    onNext(snapshotOf(raw ? JSON.parse(raw) : null, { fromCache: false, hasPendingWrites: false }));
  }, 60);
  return () => { docListeners[ref.path] = docListeners[ref.path].filter((f) => f !== onNext); };
}
