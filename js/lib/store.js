// 이 기기(브라우저)에 저장합니다. 저장 방식을 나중에 바꾸기 쉽게 이 모듈 하나로 감쌉니다.
// 저장 공간 접근은 언제든 실패할 수 있으니, 예외를 밖으로 내보내지 않고 이유를 돌려줍니다.
export const SCHEMA_VERSION = 1;
export const KEY_PREFIX = 'imjang-map:';

const fail = (reason, detail) => ({ ok: false, reason, detail: String(detail ?? '') });
const errName = (e) => e?.name || e;

// getStorage: 예) () => window.localStorage. 접근 자체가 던지거나 null이어도 여기서 처리합니다.
export function createStore(getStorage) {
  const key = (name) => KEY_PREFIX + name;

  return {
    read(name) {
      let raw;
      try {
        const s = getStorage();
        if (!s) return fail('unavailable', 'null');
        raw = s.getItem(key(name));
      } catch (e) {
        return fail('unavailable', errName(e));
      }
      if (raw === null || raw === undefined) return { ok: true, data: null };
      let box;
      try {
        box = JSON.parse(raw);
      } catch (e) {
        return fail('corrupt', errName(e)); // 원래 값은 지우지 않습니다.
      }
      if (box === null || typeof box !== 'object' || !Number.isInteger(box.schemaVersion) || !('data' in box)) {
        return fail('corrupt', 'shape');
      }
      if (box.schemaVersion > SCHEMA_VERSION) return fail('newer', box.schemaVersion);
      return { ok: true, data: box.data };
    },

    write(name, data) {
      let text;
      try {
        text = JSON.stringify({ schemaVersion: SCHEMA_VERSION, data });
      } catch (e) {
        return fail('unknown', errName(e));
      }
      try {
        const s = getStorage();
        if (!s) return fail('unavailable', 'null');
        s.setItem(key(name), text);
        // 썼다고 믿지 않고 다시 읽어 확인합니다.
        if (s.getItem(key(name)) !== text) return fail('verify-failed', 'mismatch');
        return { ok: true };
      } catch (e) {
        if (e?.name === 'QuotaExceededError') return fail('quota', e.name);
        if (e?.name === 'SecurityError' || e instanceof TypeError) return fail('unavailable', e.name);
        return fail('unknown', errName(e));
      }
    },
  };
}
