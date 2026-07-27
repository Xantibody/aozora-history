import { DAY_MS, inPeriod } from "./period.ts";
import { INK, INK_SOFT, SUCCESS, SURFACE, WARNING, el, signedCell } from "./dom.ts";
import type { RenderContext, UiState, ViewTab } from "./context.ts";
import { latestRecordAt, totalBalancePoints } from "../domain/ledger.ts";
import { nextTheme, themeIcon, themeLabel } from "./theme.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import { accountStrip } from "./account-strip.ts";
import { formatShortDateTime } from "./format.ts";
import { icon } from "./icons.ts";
import { monthNav } from "./month-nav.ts";
import { primaryStatements } from "../domain/statement.ts";

/** 記録がこれだけ止まっていたら、銀行サイトの変更に追従できていない可能性を警告する */
const STALE_DAYS = 7;
const STALE_AFTER_MS = STALE_DAYS * DAY_MS;

const STATUS_ICON_SIZE = 13;
const SETTINGS_ICON_SIZE = 17;

function staleWarning(): HTMLElement {
  const warning = el(
    "span",
    `stale-warning inline-flex items-center gap-1.5 font-medium ${WARNING}`,
  );
  warning.append(icon("triangle-alert", STATUS_ICON_SIZE), "7日以上記録が増えていません");
  warning.title =
    "銀行サイトを見ても記録されない場合、サイトの変更に拡張が追従できていない可能性があります";
  return warning;
}

function syncMark(): HTMLElement {
  const mark = el("span", `sync-ok shrink-0 ${SUCCESS}`);
  mark.append(icon("circle-check", STATUS_ICON_SIZE));
  return mark;
}

function lastSyncedEl(lastSyncedAt: number | null): HTMLElement {
  return el(
    "span",
    "last-synced",
    lastSyncedAt === null ? "まだ同期していません" : `同期済 ${formatShortDateTime(lastSyncedAt)}`,
  );
}

function freshnessParts(ctx: RenderContext, latest: number): HTMLElement[] {
  const parts = [
    syncMark(),
    el("span", "latest-record max-sm:hidden", `最終記録 ${formatShortDateTime(latest)}`),
  ];
  if (ctx.data.syncConfig === null) {
    return parts;
  }
  return [
    ...parts,
    el("span", "freshness-separator max-sm:hidden", " · "),
    lastSyncedEl(ctx.data.lastSyncedAt),
  ];
}

/**
 * ヘッダー右上の鮮度表示。記録が止まっていたら警告に差し替える。
 * アイコンは状態の合図でしかないため、必ず文言と併記する
 */
function freshness(ctx: RenderContext, latest: number): HTMLElement {
  const node = el(
    "span",
    `freshness inline-flex items-center gap-1.5 text-right text-[11.5px] ${INK_SOFT}`,
  );
  if (ctx.now() - latest > STALE_AFTER_MS) {
    node.append(staleWarning());
    return node;
  }
  node.append(...freshnessParts(ctx, latest));
  return node;
}

/** ヘッダー右上の丸ボタンの見た目。中身と表示条件は呼び出し側が足す */
const ROUND_BUTTON =
  `flex shrink-0 cursor-pointer items-center justify-center rounded-full ${INK_SOFT} ` +
  "bg-[#f4f6f9] ring-1 ring-[#e4e8ee] transition-colors hover:bg-[#eef1f5] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 " +
  "dark:bg-[#1a222c] dark:ring-[#243040] dark:hover:bg-[#1e2733]";

/**
 * 画面の明暗。押すたびに システム → ライト → ダーク と巡る。
 * 設定画面には置かず、見た目を変えるものは見ながら試せる場所に出す。
 * 歯車と違って狭い幅でも隠さない(下部バーに他の入口がないため)
 */
function themeButton(ctx: RenderContext): HTMLElement {
  const preference = ctx.data.theme;
  const button = el("button", `theme-button ${ROUND_BUTTON} h-[34px] w-[34px]`);
  button.append(icon(themeIcon(preference), SETTINGS_ICON_SIZE));
  const label = `テーマ: ${themeLabel(preference)}`;
  button.title = `${label}(クリックで切り替え)`;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    ctx.handlers.onChangeTheme(nextTheme(preference));
    ctx.draw();
  });
  return button;
}

function settingsButton(ctx: RenderContext): HTMLElement {
  const button = el(
    "button",
    `settings-button ${ROUND_BUTTON} max-sm:hidden sm:h-[34px] sm:w-[34px]`,
  );
  button.append(icon("settings-2", SETTINGS_ICON_SIZE));
  button.title = "設定";
  button.setAttribute("aria-label", "設定");
  button.addEventListener("click", () => {
    ctx.state.view = "settings";
    ctx.draw();
  });
  return button;
}

/** 期間の増減ラベル。「7月」のように月名または期間の種類を添える */
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
  { key: "balance", label: "残高" },
];

const TAB_BASE =
  "view-tab min-h-11 cursor-pointer border-b-2 bg-transparent px-0.5 pt-2 pb-2.5 text-sm transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";

function tabButton(ctx: RenderContext, def: { key: ViewTab; label: string }): HTMLElement {
  const selected = def.key === ctx.state.activeTab;
  const tab = el(
    "button",
    selected
      ? `${TAB_BASE} active border-[#0f172a] font-bold ${INK} dark:border-[#e6ecf3]`
      : `${TAB_BASE} border-transparent ${INK_SOFT}`,
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
  const tabs = el("div", "view-tabs flex gap-6 max-sm:hidden");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "表示切り替え");
  for (const def of TABS) {
    tabs.append(tabButton(ctx, def));
  }
  return tabs;
}

/** 残高ページの合計。このページの主役なので大きく取る */
function summaryLabel(ctx: RenderContext, totals: BalancePoint[]): HTMLElement {
  const label = el("div", `text-[11.5px] tracking-[.04em] ${INK_SOFT}`);
  label.append(`合計残高 · ${periodLabel(ctx.state)} `);
  const lastTotal = totals.at(-1);
  const delta = lastTotal === undefined ? 0 : lastTotal.balance - totals[0].balance;
  const deltaCell = signedCell(delta);
  deltaCell.classList.add("total-delta", "text-sm", "font-bold");
  label.append(deltaCell);
  return label;
}

function bigBalance(balance: number): HTMLElement {
  const big = el(
    "div",
    `total-balance text-4xl font-bold tracking-[-.02em] tabular-nums ${INK}`,
    balance.toLocaleString("ja-JP"),
  );
  big.append(el("span", "text-base font-medium", "円"));
  return big;
}

function totalSummary(ctx: RenderContext): HTMLElement {
  const visible = ctx.data.snapshots.filter((snapshot) => inPeriod(ctx.state, snapshot.takenAt));
  const totals = totalBalancePoints(visible);
  const summary = el("div", "total-summary pt-1 pb-3");
  summary.append(summaryLabel(ctx, totals));
  // 大きい数字は期間内最新の合計。期間を絞っていなければ現在の合計と一致する
  const total = totals.at(-1) ?? totalBalancePoints(ctx.data.snapshots).at(-1);
  if (total !== undefined) {
    summary.append(bigBalance(total.balance));
  }
  return summary;
}

function headerTitle(ctx: RenderContext, latest: number | null): HTMLElement {
  const left = el(
    "div",
    "flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:w-auto sm:flex-nowrap",
  );
  left.append(el("h1", `shrink-0 text-[15px] font-bold ${INK}`, "つかいわけ口座"));
  if (latest !== null) {
    left.append(monthNav(ctx));
  }
  return left;
}

function headerStatus(ctx: RenderContext, latest: number | null): HTMLElement {
  const side = el("div", "flex min-w-0 items-center gap-2 max-sm:w-full sm:gap-3");
  // 狭い幅では鮮度が1行を占めるので、設定は下部バーに任せて歯車を出さない
  if (latest !== null) {
    side.append(freshness(ctx, latest));
  }
  side.append(themeButton(ctx), settingsButton(ctx));
  return side;
}

function headerTopRow(ctx: RenderContext, latest: number | null): HTMLElement {
  const row = el("div", "flex flex-wrap items-center justify-between gap-x-4 gap-y-1");
  row.append(headerTitle(ctx, latest), headerStatus(ctx, latest));
  return row;
}

/** つかいわけ口座の記録がまだない場合。明細だけあるならタブは出す */
function noRecordsBody(ctx: RenderContext): HTMLElement[] {
  const spacer = el("div", "pb-3");
  return primaryStatements(ctx.data.statements).length > 0 ? [spacer, viewTabs(ctx)] : [spacer];
}

/**
 * ヘッダー。1段目にタイトル・月ナビ・鮮度・設定、2段目にページごとの残高、
 * 3段目にタブ。月ナビを独立した段にしていたのをやめ、4段積みを解消している
 */
export function header(ctx: RenderContext): HTMLElement {
  const node = el(
    "header",
    `dashboard-header border-b border-[#e8ebf0] ${SURFACE} dark:border-[#1e2733]`,
  );
  const inner = el("div", "mx-auto max-w-[1040px] px-4 pt-3.5 sm:px-7");
  node.append(inner);
  const latest = latestRecordAt(ctx.data.snapshots, ctx.data.transfers);
  inner.append(headerTopRow(ctx, latest));
  if (latest === null) {
    inner.append(...noRecordsBody(ctx));
    return node;
  }
  inner.append(
    ctx.state.activeTab === "log" ? accountStrip(ctx) : totalSummary(ctx),
    viewTabs(ctx),
  );
  return node;
}
