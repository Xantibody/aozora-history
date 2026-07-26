import { BORDER, INK_SOFT, MUTED, SELECTED, SURFACE, el, signedCell } from "./dom.ts";
import type { BalanceChange, TransferRecord } from "../domain/ledger.ts";
import type { LogFilter, RenderContext, UiState } from "./context.ts";
import { formatDayHeading, localDayKey } from "./format.ts";
import { snapshotRow, transactionRow } from "./log-row.ts";
import type { LogEntry } from "../domain/log.ts";
import { inPeriod } from "./period.ts";
import { logEntries } from "../domain/log.ts";

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

function filterChips(ctx: RenderContext): HTMLElement {
  const row = el("div", "log-filters flex gap-1.5 overflow-x-auto pb-3.5");
  for (const def of FILTERS) {
    row.append(filterChip(ctx, def));
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

function matchesLog(state: UiState, entry: LogEntry): boolean {
  if (!inPeriod(state, entry.at)) {
    return false;
  }
  if (entry.kind === "transfer") {
    return matchesTransfer(state, entry.transfer);
  }
  if (entry.kind === "external") {
    return matchesExternal(state, entry.change);
  }
  // 記録行は従属情報。何かで絞り込んでいる間はノイズになるため出さない
  return state.logFilter === "all" && state.filterAccountId === null;
}

// 日計は外部入出金の合計のみ(振替は口座間移動なので合計に含めない)
function externalDayTotals(entries: LogEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "external") {
      continue;
    }
    const key = localDayKey(entry.at);
    totals.set(key, (totals.get(key) ?? 0) + entry.change.externalDelta);
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

export function logSection(ctx: RenderContext): HTMLElement {
  const node = el("section", "log");
  node.append(filterChips(ctx));
  const entries = logEntries(ctx.data.snapshots, ctx.ledger.transfers).filter((entry) =>
    matchesLog(ctx.state, entry),
  );
  if (entries.length === 0) {
    node.append(el("p", `empty mt-2 ${MUTED}`, "まだ記録がありません"));
    return node;
  }
  const totals = externalDayTotals(entries);
  for (const group of groupByDay(entries)) {
    node.append(dayHeadingEl(group, totals.get(group.day)), dayCard(ctx, group.entries));
  }
  return node;
}
