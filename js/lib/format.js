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
