import { CARD, FINE_PRINT, MUTED, accountColor, accountDot, el, signedCell } from "./dom.ts";
import { MIN_CHART_POINTS, sparkline } from "./charts.ts";
import type { RenderContext } from "./context.ts";
import type { WorkspaceSummary } from "../domain/ledger.ts";
import { formatYen } from "./format.ts";
import { inPeriod } from "./period.ts";
import { workspaceSummaries } from "../domain/ledger.ts";

function workspaceKpi(cls: string, label: string, amount: number): HTMLElement {
  const box = el("div", `kpi ${cls}`);
  box.append(el("div", "text-[11px] text-slate-500 dark:text-slate-400", label));
  const value = el("div", "text-sm font-semibold tabular-nums");
  value.append(signedCell(amount));
  box.append(value);
  return box;
}

function cardHead(summary: WorkspaceSummary): HTMLElement {
  const head = el("div", "mb-1 flex items-center gap-2");
  head.append(accountDot(summary.id));
  head.append(el("h3", "workspace-name text-sm font-semibold", summary.name));
  return head;
}

function cardBalanceRow(summary: WorkspaceSummary): HTMLElement {
  const mid = el("div", "flex items-end justify-between gap-3");
  const balance = el("div", "kpi kpi-balance");
  balance.append(el("div", "text-[22px] font-bold tabular-nums", formatYen(summary.balance)));
  const delta = el("div", `kpi-delta ${FINE_PRINT}`);
  delta.append("期間内 ", signedCell(summary.delta));
  balance.append(delta);
  mid.append(balance);
  if (summary.points.length >= MIN_CHART_POINTS) {
    mid.append(sparkline(summary.points, `workspace-sparkline ${accountColor(summary.id).line}`));
  }
  return mid;
}

function cardKpis(summary: WorkspaceSummary): HTMLElement {
  const kpis = el(
    "div",
    "kpis mt-2.5 flex gap-5 border-t border-slate-100 pt-2.5 dark:border-slate-800",
  );
  kpis.append(
    workspaceKpi("kpi-transfer", "振替", summary.transferNet),
    workspaceKpi("kpi-external", "外部入出金", summary.externalNet),
  );
  return kpis;
}

function workspaceCard(summary: WorkspaceSummary): HTMLElement {
  const card = el("div", `workspace-card p-3.5 ${CARD}`);
  card.append(cardHead(summary), cardBalanceRow(summary), cardKpis(summary));
  return card;
}

export function accountsSection(ctx: RenderContext): HTMLElement {
  const node = el("section", "accounts pt-1");
  const summaries = workspaceSummaries(ctx.data.snapshots, ctx.data.transfers, (ms) =>
    inPeriod(ctx.state, ms),
  );
  if (summaries.length === 0) {
    node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
    return node;
  }
  const grid = el("div", "workspace-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2");
  for (const summary of summaries) {
    grid.append(workspaceCard(summary));
  }
  node.append(grid);
  return node;
}
