import type { BalancePoint, BalanceSnapshot } from "../domain/ledger.ts";
import { CARD, FINE_PRINT, MUTED, accountDot, el, signedCell } from "./dom.ts";
import { MIN_CHART_POINTS, balanceChart } from "./charts.ts";
import { formatShortDateTime, formatYen } from "./format.ts";
import type { RenderContext } from "./context.ts";
import { inPeriod } from "./period.ts";
import { totalBalancePoints } from "../domain/ledger.ts";

function snapshotTotals(total: number, prevTotal: number | null): HTMLElement {
  const right = el("div", "text-right");
  right.append(el("div", "snapshot-total text-[15px] font-bold tabular-nums", formatYen(total)));
  if (prevTotal !== null) {
    const diff = el("div", `snapshot-diff tabular-nums ${FINE_PRINT}`);
    diff.append(signedCell(total - prevTotal));
    right.append(diff);
  }
  return right;
}

function snapshotSummary(
  snapshot: BalanceSnapshot,
  total: number,
  prevTotal: number | null,
): HTMLElement {
  const summary = el(
    "summary",
    "snapshot-summary flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900",
  );
  const left = el("div");
  left.append(
    el("div", "text-sm font-semibold tabular-nums", formatShortDateTime(snapshot.takenAt)),
    el("div", FINE_PRINT, "残高スナップショット"),
  );
  summary.append(left, snapshotTotals(total, prevTotal));
  return summary;
}

function snapshotBreakdown(snapshot: BalanceSnapshot): HTMLElement {
  const breakdown = el(
    "div",
    "snapshot-detail border-t border-slate-100 px-3.5 py-2 dark:border-slate-800",
  );
  for (const account of snapshot.accounts) {
    const line = el("div", "flex items-center justify-between gap-3 py-1 text-sm");
    const name = el("span", "flex items-center gap-2");
    name.append(accountDot(account.id, "h-1.5 w-1.5"), account.name);
    line.append(name, el("span", "tabular-nums", formatYen(account.balance)));
    breakdown.append(line);
  }
  return breakdown;
}

function snapshotItem(
  snapshot: BalanceSnapshot,
  total: number,
  prevTotal: number | null,
): HTMLElement {
  const item = document.createElement("details");
  item.className = "snapshot-item";
  // 行タップで口座ごとの内訳を開く
  item.append(snapshotSummary(snapshot, total, prevTotal), snapshotBreakdown(snapshot));
  return item;
}

function chartCard(totals: BalancePoint[]): HTMLElement {
  const chartBox = el("div", `total-chart p-3.5 ${CARD}`);
  chartBox.append(
    el(
      "div",
      "chart-label text-xs font-semibold text-slate-500 dark:text-slate-400",
      "合計残高の推移",
    ),
    balanceChart(totals),
  );
  return chartBox;
}

function snapshotList(visible: BalanceSnapshot[], totals: BalancePoint[]): HTMLElement {
  const list = el(
    "div",
    `snapshot-list divide-y divide-slate-100 overflow-hidden ${CARD} dark:divide-slate-800`,
  );
  for (const [index, snapshot] of visible.entries()) {
    const total = totals[index].balance;
    const prevTotal = index > 0 ? totals[index - 1].balance : null;
    list.prepend(snapshotItem(snapshot, total, prevTotal));
  }
  return list;
}

export function historySection(ctx: RenderContext): HTMLElement {
  const node = el("section", "history flex flex-col gap-2.5 pt-1");
  const visible = ctx.data.snapshots.filter((snapshot) => inPeriod(ctx.state, snapshot.takenAt));
  if (visible.length === 0) {
    node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
    return node;
  }
  const totals = totalBalancePoints(visible);
  if (totals.length >= MIN_CHART_POINTS) {
    node.append(chartCard(totals));
  }
  node.append(snapshotList(visible, totals));
  return node;
}
