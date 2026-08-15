import { localDayKey, pad } from "./format.ts";
import type { UiState } from "./context.ts";

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
export const DAY_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** "YYYY-MM-DD" をローカル時刻の日付境界(エポックミリ秒)に変換する */
export function dayStart(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day).getTime();
}

/**
 * 銀行APIから取り込んだ明細を、ログのどの時刻に置くか。
 *
 * 明細は起算日(日単位)しか持たない。0時に置くと、その日に記録した振替より
 * 必ず古い扱いになり、後から取り込んだ入出金が朝いちばんの出来事として
 * 一日の末尾に並ぶ。起きた順とは読めないため、日の終わりへ寄せる。
 *
 * 当日だけは「今」に置く。日の終わりに置くと、これから記録する振替が
 * すでに取り込んである明細より前に来てしまう
 */
export function statementAt(valueDate: string, now: number): number | null {
  const start = dayStart(valueDate);
  if (start === null) {
    return null;
  }
  return start === dayStart(localDayKey(now)) ? now : start + DAY_MS - 1;
}

/** "YYYY-MM" をその月の[開始, 翌月開始)に変換する */
function monthBounds(value: string): [number, number] | null {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) {
    return null;
  }
  return [new Date(year, month - 1, 1).getTime(), new Date(year, month, 1).getTime()];
}

export function shiftMonth(value: string, delta: number): string {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(year, month - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

/** "YYYY-MM" を「7月」にする。年は月ナビの入力欄が持っているので添えない */
export function monthLabel(value: string): string {
  const [, month] = value.split("-").map(Number);
  return `${month}月`;
}

/** エポックミリ秒をローカル時刻の "YYYY-MM" にする */
export function monthOf(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function inPeriod(state: UiState, ms: number): boolean {
  if (state.periodFrom !== null && ms < state.periodFrom) {
    return false;
  }
  if (state.periodToExclusive !== null && ms >= state.periodToExclusive) {
    return false;
  }
  return true;
}

/** 月選択と日付指定は排他。残っている方の入力から境界を計算し直す */
export function applyBounds(state: UiState): void {
  const bounds = state.monthValue === "" ? null : monthBounds(state.monthValue);
  if (bounds !== null) {
    [state.periodFrom, state.periodToExclusive] = bounds;
    return;
  }
  state.periodFrom = state.periodFromValue === "" ? null : dayStart(state.periodFromValue);
  const toStart = state.periodToValue === "" ? null : dayStart(state.periodToValue);
  state.periodToExclusive = toStart === null ? null : toStart + DAY_MS;
}
