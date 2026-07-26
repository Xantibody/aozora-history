import { BORDER, INK_DECOR, INK_SOFT, MUTED, SELECTED, SURFACE, el, signedCell } from "./dom.ts";
import type { BalanceChange, TransferRecord } from "../domain/ledger.ts";
import type { LogFilter, RenderContext, UiState } from "./context.ts";
import { PAGE_SIZE, moreButton, pageLimit } from "./paging.ts";
import { dayStart, inPeriod } from "./period.ts";
import { formatDayHeading, formatShortDateTime, localDayKey } from "./format.ts";
import { snapshotRow, transactionRow } from "./log-row.ts";
import type { LogEntry } from "../domain/log.ts";
import { icon } from "./icons.ts";
import { logEntries } from "../domain/log.ts";

const SPAN_ICON_SIZE = 14;

const FILTERS: { key: LogFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "transfer", label: "振替" },
  { key: "in", label: "入金" },
  { key: "out", label: "出金" },
];

const CHIP_BASE =
  "min-h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const CHIP_ON = `font-bold ${SELECTED}`;
const CHIP_OFF = `${SURFACE} ${BORDER} ${INK_SOFT} hover:bg-[#f6f7f9] dark:hover:bg-[#1a222c]`;

function filterChip(ctx: RenderContext, def: { key: LogFilter; label: string }): HTMLElement {
  const active = ctx.state.logFilter === def.key;
  const chip = el(
    "button",
    `filter-${def.key} ${CHIP_BASE} ${active ? `active ${CHIP_ON}` : CHIP_OFF}`,
    def.label,
  );
  chip.setAttribute("aria-pressed", String(active));
  chip.addEventListener("click", () => {
    ctx.state.logFilter = def.key;
    ctx.draw();
  });
  return chip;
}

/**
 * 推移から渡ってきた区間の表示。チップ本体で残高ページへ戻り、×で解除する。
 * 絞り込みが効いていることを、外した方法とセットで見せる
 */
function spanBackButton(ctx: RenderContext, span: { from: number; to: number }): HTMLElement {
  const back = el(
    "button",
    "span-back flex cursor-pointer items-center gap-2 bg-transparent",
    `${formatShortDateTime(span.from)} – ${formatShortDateTime(span.to)} の区間で絞り込み中`,
  );
  back.title = "残高ページへ戻る";
  back.addEventListener("click", () => {
    ctx.state.activeTab = "balance";
    ctx.draw();
  });
  return back;
}

function spanClearButton(ctx: RenderContext): HTMLElement {
  const clear = el("button", `span-clear flex cursor-pointer items-center ${INK_DECOR}`);
  clear.append(icon("x", SPAN_ICON_SIZE));
  clear.title = "区間の絞り込みを解除";
  clear.setAttribute("aria-label", clear.title);
  clear.addEventListener("click", () => {
    ctx.state.selectedSpan = null;
    ctx.draw();
  });
  return clear;
}

function spanChip(ctx: RenderContext, span: { from: number; to: number }): HTMLElement {
  const chip = el(
    "div",
    "span-chip ml-auto flex shrink-0 items-center gap-2 rounded-full bg-[#eef2f6] px-3 " +
      `py-1.5 text-[12.5px] ring-1 ring-[#dde4ec] dark:bg-[#1a2330] dark:ring-[#243040] ${INK_SOFT}`,
  );
  chip.append(spanBackButton(ctx, span), spanClearButton(ctx));
  return chip;
}

function filterChips(ctx: RenderContext): HTMLElement {
  const row = el("div", "log-filters flex items-center gap-1.5 overflow-x-auto pb-3.5");
  for (const def of FILTERS) {
    row.append(filterChip(ctx, def));
  }
  if (ctx.state.selectedSpan !== null) {
    row.append(spanChip(ctx, ctx.state.selectedSpan));
  }
  return row;
}

function matchesTransfer(state: UiState, transfer: TransferRecord): boolean {
  if (state.logFilter === "in" || state.logFilter === "out") {
    return false;
  }
  return (
    state.filterAccountId === null ||
    transfer.from.id === state.filterAccountId ||
    transfer.to.id === state.filterAccountId
  );
}

function matchesExternal(state: UiState, change: BalanceChange): boolean {
  if (state.logFilter === "transfer") {
    return false;
  }
  if (state.logFilter === "in" && change.externalDelta < 0) {
    return false;
  }
  if (state.logFilter === "out" && change.externalDelta > 0) {
    return false;
  }
  return state.filterAccountId === null || change.accountId === state.filterAccountId;
}

/**
 * 代表口座の明細。つかいわけ口座ではないので、口座で絞っている間は出さない。
 * 入金・出金の絞り込みは符号で判断する
 */
function matchesStatement(state: UiState, amount: number): boolean {
  if (state.logFilter === "transfer" || state.filterAccountId !== null) {
    return false;
  }
  if (state.logFilter === "in") {
    return amount > 0;
  }
  return state.logFilter === "out" ? amount < 0 : true;
}

/** 推移で選んだ区間。選んでいなければ素通りさせる */
function inSelectedSpan(state: UiState, at: number): boolean {
  const span = state.selectedSpan;
  return span === null || (at >= span.from && at <= span.to);
}

function matchesLog(state: UiState, entry: LogEntry): boolean {
  if (!inPeriod(state, entry.at) || !inSelectedSpan(state, entry.at)) {
    return false;
  }
  if (entry.kind === "transfer") {
    return matchesTransfer(state, entry.transfer);
  }
  if (entry.kind === "statement") {
    return matchesStatement(state, entry.statement.amount);
  }
  if (entry.kind === "external") {
    return matchesExternal(state, entry.change);
  }
  // 記録行は従属情報。何かで絞り込んでいる間はノイズになるため出さない
  return state.logFilter === "all" && state.filterAccountId === null;
}

/** 口座の外と出入りした額だけ。振替は口座間の移動なので日計に含めない */
function dayFlow(entry: LogEntry): number {
  if (entry.kind === "external") {
    return entry.change.externalDelta;
  }
  return entry.kind === "statement" ? entry.statement.amount : 0;
}

function externalDayTotals(entries: LogEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const flow = dayFlow(entry);
    if (flow !== 0) {
      const key = localDayKey(entry.at);
      totals.set(key, (totals.get(key) ?? 0) + flow);
    }
  }
  return totals;
}

interface DayGroup {
  day: string;
  at: number;
  entries: LogEntry[];
}

function groupByDay(entries: LogEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const day = localDayKey(entry.at);
    const current = groups.at(-1);
    if (current !== undefined && current.day === day) {
      current.entries.push(entry);
    } else {
      groups.push({ day, at: entry.at, entries: [entry] });
    }
  }
  return groups;
}

/** 日の見出し。カードの外に置き、その日の取引がどこからどこまでかを示す */
function dayHeadingEl(group: DayGroup, total: number | undefined): HTMLElement {
  const heading = el("div", "day-heading flex items-baseline justify-between px-1 pb-2.5");
  heading.append(
    el("span", `text-xs font-bold tracking-[.03em] ${INK_SOFT}`, formatDayHeading(group.at)),
  );
  if (total !== undefined) {
    const cell = signedCell(total);
    cell.classList.add("day-total", "text-xs", "font-bold");
    heading.append(cell);
  }
  return heading;
}

/** 1取引=1カード。カードの切れ目が取引の切れ目になり、行の境目を罫線で探さずに済む */
function dayCard(ctx: RenderContext, entries: LogEntry[]): HTMLElement {
  const list = el("div", "day-card mb-4 flex flex-col gap-2");
  for (const entry of entries) {
    list.append(entry.kind === "snapshot" ? snapshotRow(entry) : transactionRow(ctx, entry));
  }
  return list;
}

/** 積み上げた件数を引き継いでよい範囲。絞り込みが変われば並びも変わる */
function filterKey(state: UiState): string {
  return [
    state.logFilter,
    state.filterAccountId,
    state.periodFrom,
    state.periodToExclusive,
    state.selectedSpan?.from,
    state.selectedSpan?.to,
  ].join("|");
}

function logMoreButton(ctx: RenderContext, rest: number): HTMLElement {
  const more = moreButton(rest, () => {
    ctx.state.logPaging.limit += PAGE_SIZE;
    ctx.draw();
  });
  more.classList.add("log-more", "mt-1", "mb-4");
  return more;
}

function visibleEntries(ctx: RenderContext): LogEntry[] {
  return logEntries({
    snapshots: ctx.data.snapshots,
    transfers: ctx.ledger.transfers,
    statements: ctx.data.statements,
    dayStart,
  }).filter((entry) => matchesLog(ctx.state, entry));
}

/** 日ごとのカードを上限まで積み、残りがあれば続きを足すボタンで締める */
function dayCards(ctx: RenderContext, entries: LogEntry[]): HTMLElement[] {
  // 日計は絞り込んだ全件から出す。表示を打ち切っても「その日の合計」は変わらない
  const totals = externalDayTotals(entries);
  const limit = pageLimit(ctx.state.logPaging, filterKey(ctx.state));
  const nodes = groupByDay(entries.slice(0, limit)).flatMap((group) => [
    dayHeadingEl(group, totals.get(group.day)),
    dayCard(ctx, group.entries),
  ]);
  return entries.length > limit ? [...nodes, logMoreButton(ctx, entries.length - limit)] : nodes;
}

export function logSection(ctx: RenderContext): HTMLElement {
  const node = el("section", "log");
  node.append(filterChips(ctx));
  const entries = visibleEntries(ctx);
  node.append(
    ...(entries.length === 0
      ? [el("p", `empty mt-2 ${MUTED}`, "まだ記録がありません")]
      : dayCards(ctx, entries)),
  );
  return node;
}
