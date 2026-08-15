import { CARD, INK, INK_SOFT, MUTED, accountDot, el, signedCell } from "./dom.ts";
import type { RenderContext } from "./context.ts";
import type { WorkspaceSummary } from "../domain/ledger.ts";
import { emptyMessage } from "./empty-state.ts";
import { formatYen } from "./format.ts";
import { inPeriod } from "./period.ts";
import { workspaceSummaries } from "../domain/ledger.ts";

function workspaceKpi(cls: string, label: string, amount: number): HTMLElement {
  const box = el("div", `kpi ${cls}`);
  box.append(el("div", `text-[11px] ${INK_SOFT}`, label));
  const value = el("div", "text-[13.5px] font-bold tabular-nums");
  value.append(signedCell(amount));
  box.append(value);
  return box;
}

function cardHead(ctx: RenderContext, summary: WorkspaceSummary): HTMLElement {
  const head = el("div", "flex items-center gap-2");
  head.append(accountDot(ctx.colorOf(summary.id), "h-[9px] w-[9px]"));
  head.append(el("h3", `workspace-name text-[13.5px] font-bold ${INK}`, summary.name));
  return head;
}

function cardBalance(summary: WorkspaceSummary): HTMLElement {
  const box = el("div", "kpi kpi-balance");
  box.append(
    el(
      "div",
      `text-[23px] leading-[1.1] font-bold tabular-nums ${INK}`,
      formatYen(summary.balance),
    ),
  );
  const delta = el("div", `kpi-delta mt-1 text-xs ${INK_SOFT}`);
  delta.append("期間内 ", signedCell(summary.delta));
  box.append(delta);
  return box;
}

/**
 * 帯として引ける長さ。割合はマイナスにも100%超えにもなる(残高がマイナスの口座が
 * あると、他の口座の割合が合計を追い越す)。そのままCSSの幅に渡すと不正な値として
 * 捨てられ、幅指定の無い帯がトラックいっぱいに伸びて「満杯」に見えてしまう
 */
function barShare(share: number): number {
  return Math.min(Math.max(share, 0), PERCENT);
}

/**
 * 合計に占める割合。残高の数字だけでは口座間の配分が読み取れないため、
 * 長さでも示す。スパークラインは形しか伝えず推移パネルと役割が重なるので置かない
 */
function shareBar(share: number, fillClass: string): HTMLElement {
  const box = el("div", "share");
  const head = el("div", "flex items-baseline justify-between gap-2");
  head.append(
    el("span", `text-[11px] ${INK_SOFT}`, "合計に占める割合"),
    el("span", `share-value text-xs font-bold tabular-nums ${INK}`, `${share.toFixed(1)}%`),
  );
  const track = el(
    "div",
    "mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef1f5] dark:bg-[#1e2733]",
  );
  const fill = el("div", `share-fill h-full min-w-[3px] rounded-full ${fillClass}`);
  fill.style.width = `${barShare(share)}%`;
  track.append(fill);
  box.append(head, track);
  return box;
}

function cardKpis(summary: WorkspaceSummary): HTMLElement {
  // 狭い幅では畳む。残高・増減・構成比まで読めれば口座の様子は掴める
  const kpis = el(
    "div",
    "kpis flex gap-7 border-t border-[#f1f3f7] pt-2.5 max-sm:hidden dark:border-[#1a222c]",
  );
  kpis.append(
    workspaceKpi("kpi-transfer", "振替", summary.transferNet),
    workspaceKpi("kpi-external", "外部入出金", summary.externalNet),
  );
  return kpis;
}

/** 構成比は百分率で出す */
const PERCENT = 100;

interface CardInput {
  summary: WorkspaceSummary;
  total: number;
}

/** 上辺の3pxが口座色。カードのどれがどの口座かを、見出しを読まずに見分けられる */
function workspaceCard(ctx: RenderContext, input: CardInput): HTMLElement {
  const color = ctx.colorOf(input.summary.id);
  const card = el(
    "div",
    `workspace-card flex flex-col gap-2.5 p-4 ${CARD} border-t-[3px] ${color.border}`,
  );
  const share = input.total === 0 ? 0 : (input.summary.balance / input.total) * PERCENT;
  card.append(
    cardHead(ctx, input.summary),
    cardBalance(input.summary),
    shareBar(share, color.dot),
    cardKpis(input.summary),
  );
  return card;
}

/** 残高ページの口座カード。2列に並べて口座どうしを見比べられるようにする */
function cardGrid(ctx: RenderContext, summaries: WorkspaceSummary[]): HTMLElement {
  const total = summaries.reduce((sum, summary) => sum + summary.balance, 0);
  const grid = el("div", "workspace-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2");
  for (const summary of summaries) {
    grid.append(workspaceCard(ctx, { summary, total }));
  }
  return grid;
}

export function workspaceGrid(ctx: RenderContext): HTMLElement {
  const node = el("section", "accounts");
  const summaries = workspaceSummaries(ctx.data.snapshots, ctx.ledger.transfers, (ms) =>
    inPeriod(ctx.state, ms),
  );
  node.append(
    summaries.length === 0
      ? el("p", `empty ${MUTED}`, emptyMessage(ctx))
      : cardGrid(ctx, summaries),
  );
  return node;
}
