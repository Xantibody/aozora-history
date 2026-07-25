const PAD_WIDTH = 2;

export function pad(value: number): string {
  return String(value).padStart(PAD_WIDTH, "0");
}

export function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function formatSigned(amount: number): string {
  if (amount === 0) {
    return "±0円";
  }
  return (amount > 0 ? "+" : "-") + formatYen(Math.abs(amount));
}

export function formatDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatShortDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}/${date.getDate()} ${formatTime(epochMs)}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function formatDayHeading(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
}

/** 日付グループ用のキー。ローカル時刻の暦日で区切る */
export function localDayKey(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shortDate(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
