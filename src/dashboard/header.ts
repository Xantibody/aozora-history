import { DAY_MS, inPeriod } from "./period.ts";
import { FINE_PRINT, el, signedCell } from "./dom.ts";
import { MIN_CHART_POINTS, sparkline } from "./charts.ts";
import type { RenderContext, UiState, ViewTab } from "./context.ts";
import { latestRecordAt, totalBalancePoints } from "../domain/ledger.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import { formatShortDateTime } from "./format.ts";

/** 記録がこれだけ止まっていたら、銀行サイトの変更に追従できていない可能性を警告する */
const STALE_DAYS = 7;
const STALE_AFTER_MS = STALE_DAYS * DAY_MS;

function staleWarning(): HTMLElement {
  const warning = el(
    "span",
    "stale-warning font-medium text-amber-700 dark:text-amber-400",
    "⚠ 7日以上記録が増えていません",
  );
  warning.title =
    "銀行サイトを見ても記録されない場合、サイトの変更に拡張が追従できていない可能性があります";
  return warning;
}

function lastSyncedEl(lastSyncedAt: number | null): HTMLElement {
  return el(
    "span",
    "last-synced",
    lastSyncedAt === null ? "まだ同期していません" : `同期済 ${formatShortDateTime(lastSyncedAt)}`,
  );
}

/** ヘッダー右上の鮮度表示。記録が止まっていたら同期表示の位置に警告を出す */
function freshness(ctx: RenderContext, latest: number): HTMLElement {
  const node = el("span", "freshness text-right text-[11px] text-slate-500 dark:text-slate-400");
  if (ctx.now() - latest > STALE_AFTER_MS) {
    node.append(staleWarning());
    return node;
  }
  node.append(el("span", "latest-record max-sm:hidden", `最終記録 ${formatShortDateTime(latest)}`));
  if (ctx.data.syncConfig !== null) {
    node.append(
      el("span", "freshness-separator max-sm:hidden", " · "),
      lastSyncedEl(ctx.data.lastSyncedAt),
    );
  }
  return node;
}

function settingsButton(ctx: RenderContext): HTMLElement {
  const button = el(
    "button",
    "settings-button flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-50 text-base ring-1 ring-slate-200 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 max-sm:h-11 max-sm:w-11 sm:h-10 sm:w-10 dark:bg-slate-900 dark:ring-slate-700 dark:hover:bg-slate-800",
    "⚙",
  );
  button.title = "設定";
  button.setAttribute("aria-label", "設定");
  button.addEventListener("click", () => {
    ctx.state.view = "settings";
    ctx.draw();
  });
  return button;
}

/** 期間の増減ラベル。「7月 +272,520円」のように月名または期間の種類を添える */
function periodLabel(state: UiState): string {
  if (state.monthValue !== "") {
    const [, month] = state.monthValue.split("-").map(Number);
    return `${month}月`;
  }
  if (state.periodFrom !== null || state.periodToExclusive !== null) {
    return "期間内";
  }
  return "全期間";
}

const TABS: { key: ViewTab; label: string }[] = [
  { key: "log", label: "ログ" },
  { key: "accounts", label: "口座別" },
  { key: "history", label: "推移" },
];

const TAB_BASE =
  "view-tab min-h-11 cursor-pointer border-b-2 bg-transparent px-0.5 pt-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";

function tabButton(ctx: RenderContext, def: { key: ViewTab; label: string }): HTMLElement {
  const selected = def.key === ctx.state.activeTab;
  const tab = el(
    "button",
    selected
      ? `${TAB_BASE} active border-sky-600 font-semibold text-slate-900 dark:border-sky-400 dark:text-slate-100`
      : `${TAB_BASE} border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200`,
    def.label,
  );
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", String(selected));
  tab.addEventListener("click", () => {
    ctx.state.activeTab = def.key;
    ctx.draw();
  });
  return tab;
}

function viewTabs(ctx: RenderContext): HTMLElement {
  const tabs = el("div", "view-tabs flex gap-4 sm:gap-5");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "表示切り替え");
  for (const def of TABS) {
    tabs.append(tabButton(ctx, def));
  }
  return tabs;
}

function summaryLabel(ctx: RenderContext, totals: BalancePoint[]): HTMLElement {
  const label = el("div", FINE_PRINT);
  label.append(`合計残高 · ${periodLabel(ctx.state)} `);
  const lastTotal = totals.at(-1);
  const delta = lastTotal === undefined ? 0 : lastTotal.balance - totals[0].balance;
  const deltaCell = signedCell(delta);
  deltaCell.classList.add("total-delta", "font-semibold", "tabular-nums");
  label.append(deltaCell);
  return label;
}

function balanceRow(totals: BalancePoint[], total: BalancePoint): HTMLElement {
  const row = el("div", "flex items-end justify-between gap-3");
  const big = el(
    "div",
    "total-balance text-3xl font-bold tracking-tight tabular-nums sm:text-[34px]",
    total.balance.toLocaleString("ja-JP"),
  );
  big.append(el("span", "text-[15px] font-medium sm:text-[17px]", "円"));
  row.append(big);
  if (totals.length >= MIN_CHART_POINTS) {
    row.append(sparkline(totals, "total-sparkline text-sky-600 dark:text-sky-400"));
  }
  return row;
}

function totalSummary(ctx: RenderContext): HTMLElement {
  const visible = ctx.data.snapshots.filter((snapshot) => inPeriod(ctx.state, snapshot.takenAt));
  const totals = totalBalancePoints(visible);
  const summary = el("div", "total-summary pt-1 pb-3");
  summary.append(summaryLabel(ctx, totals));
  // 大きい数字は期間内最新の合計。期間を絞っていなければ現在の合計と一致する
  const total = totals.at(-1) ?? totalBalancePoints(ctx.data.snapshots).at(-1);
  if (total !== undefined) {
    summary.append(balanceRow(totals, total));
  }
  return summary;
}

function headerTopRow(ctx: RenderContext, latest: number | null): HTMLElement {
  const row = el("div", "flex items-center justify-between gap-3");
  row.append(el("h1", "text-[15px] font-bold sm:text-base", "つかいわけ口座"));
  const side = el("div", "flex items-center gap-2 sm:gap-3");
  if (latest !== null) {
    side.append(freshness(ctx, latest));
  }
  side.append(settingsButton(ctx));
  row.append(side);
  return row;
}

/** ヘッダー: タイトル・鮮度・合計残高とスパークライン・タブ */
export function header(ctx: RenderContext): HTMLElement {
  const node = el(
    "header",
    "dashboard-header border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
  );
  const inner = el("div", "mx-auto max-w-[760px] px-4 pt-3 sm:px-6 sm:pt-4");
  node.append(inner);
  const latest = latestRecordAt(ctx.data.snapshots, ctx.data.transfers);
  inner.append(headerTopRow(ctx, latest));
  if (latest === null) {
    inner.append(el("div", "pb-3"));
    return node;
  }
  inner.append(totalSummary(ctx), viewTabs(ctx));
  return node;
}
