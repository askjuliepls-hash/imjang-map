// 날짜·시각 표시. 모두 기기의 현지 시각 기준입니다.
export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatClock(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// 오늘이면 '오늘 14:02:33', 올해면 '11월 4일 14:02:33', 그 외는 연도까지.
export function formatWhen(d, now = new Date()) {
  const sameYear = d.getFullYear() === now.getFullYear();
  const sameDay = sameYear && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `오늘 ${formatClock(d)}`;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${formatClock(d)}`;
  return sameYear ? md : `${d.getFullYear()}년 ${md}`;
}

// 만원 단위 입력을 읽기 쉽게 바꿉니다. 숫자가 아니면('신규' 등) 그대로 둡니다.
export function formatManwon(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const digits = v.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return v;
  const n = Number(digits);
  const eok = Math.floor(n / 10000);
  const man = n % 10000;
  if (eok === 0) return `${man.toLocaleString('en-US')}만원`;
  if (man === 0) return `${eok}억`;
  return `${eok}억 ${man.toLocaleString('en-US')}만원`;
}

// 1평 = 3.3058㎡. 소수 한 자리로 돌려줍니다.
export function toPyeong(squareMeters) {
  const n = Number(String(squareMeters ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return (n / 3.3058).toFixed(1);
}

// 평을 ㎡로 바꿉니다. 저장은 ㎡로 합니다.
export function fromPyeong(pyeong) {
  const n = Number(String(pyeong ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Math.round(n * 3.3058 * 100) / 100);
}
