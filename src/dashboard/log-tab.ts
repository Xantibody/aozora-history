import type { BalanceChange, LogEntry, TransferRecord } from "../domain/ledger.ts";
import { CARD, MUTED, el, signedCell } from "./dom.ts";
import type { DashboardData, LogFilter, RenderContext, UiState } from "./context.ts";
import { formatDayHeading, localDayKey } from "./format.ts";
import { latestSnapshot, logEntries } from "../domain/ledger.ts";
import { snapshotRow, transactionRow } from "./log-row.ts";
import type { AccountRef } from "../domain/parser.ts";
import { inPeriod } from "./period.ts";

const FILTERS: { key: LogFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "transfer", label: "振替" },
  { key: "in", label: "入金" },
  { key: "out", label: "出金" },
];

const CHIP_BASE =
  "min-h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const CHIP_ON = "bg-slate-900 font-semibold text-white dark:bg-sky-400 dark:text-slate-950";
const CHIP_OFF =
  "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800";

interface AccountCollector {
  accounts: AccountRef[];
  seen: Set<string>;
}

function pushUniqueAccount(collector: AccountCollector, ref: AccountRef): void {
  if (collector.seen.has(ref.id)) {
    return;
  }
  collector.accounts.push({ id: ref.id, name: ref.name });
  collector.seen.add(ref.id);
}

/** フィルタに出す口座一覧。最新スナップショットの並びを基本に、振替にしか現れない口座を補う */
function accountsOf(data: DashboardData): AccountRef[] {
  const collector: AccountCollector = { accounts: [], seen: new Set() };
  for (const account of latestSnapshot(data.snapshots)?.accounts ?? []) {
    pushUniqueAccount(collector, account);
  }
  for (const transfer of data.transfers) {
    pushUniqueAccount(collector, transfer.from);
    pushUniqueAccount(collector, transfer.to);
  }
  return collector.accounts;
}

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

// 口座での絞り込み。チップ列の見た目に合わせたセレクト
function accountFilterSelect(ctx: RenderContext): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = `account-filter ${CHIP_BASE} appearance-none ${
    ctx.state.filterAccountId === null ? CHIP_OFF : `active ${CHIP_ON}`
  }`;
  select.name = "account-filter";
  select.setAttribute("aria-label", "口座で絞り込み");
  select.append(new Option("口座 ▾", ""));
  for (const account of accountsOf(ctx.data)) {
    select.append(new Option(account.name, account.id));
  }
  select.value = ctx.state.filterAccountId ?? "";
  select.addEventListener("change", () => {
    ctx.state.filterAccountId = select.value === "" ? null : select.value;
    ctx.draw();
  });
  return select;
}

function filterChips(ctx: RenderContext): HTMLElement {
  const row = el("div", "log-filters flex gap-1.5 overflow-x-auto pb-2");
  for (const def of FILTERS) {
    row.append(filterChip(ctx, def));
  }
  row.append(accountFilterSelect(ctx));
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

function dayHeadingEl(group: DayGroup, total: number | undefined): HTMLElement {
  // 右余白はカード内の金額列の右端に合わせる(モバイル: pr-3、デスクトップ:
  // pr-3 + 削除ボタン列 w-6 + gap-3 = pr-12)
  const heading = el(
    "div",
    "day-heading flex items-baseline justify-between pt-1.5 pb-1 pr-3 pl-0.5 sm:pr-12",
  );
  heading.append(
    el("span", "text-xs font-bold text-slate-500 dark:text-slate-400", formatDayHeading(group.at)),
  );
  if (total !== undefined) {
    const cell = signedCell(total);
    cell.classList.add("day-total", "text-xs", "font-semibold", "tabular-nums");
    heading.append(cell);
  }
  return heading;
}

function dayCard(ctx: RenderContext, entries: LogEntry[]): HTMLElement {
  const card = el(
    "div",
    `day-card mb-2 divide-y divide-slate-100 overflow-hidden ${CARD} dark:divide-slate-800`,
  );
  for (const entry of entries) {
    card.append(entry.kind === "snapshot" ? snapshotRow(entry) : transactionRow(ctx, entry));
  }
  return card;
}

export function logSection(ctx: RenderContext): HTMLElement {
  const node = el("section", "log");
  node.append(filterChips(ctx));
  const entries = logEntries(ctx.data.snapshots, ctx.data.transfers).filter((entry) =>
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
