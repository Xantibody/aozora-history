import type { BalancePoint, BalanceSnapshot } from "../domain/ledger.ts";
import { CARD, FINE_PRINT, MUTED, accountDot, el, signedCell } from "./dom.ts";
import { PAGE_SIZE, moreButton, pageLimit } from "./paging.ts";
import type { RenderContext, UiState } from "./context.ts";
import { formatShortDateTime, formatYen } from "./format.ts";
import { emptyMessage } from "./empty-state.ts";
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

function snapshotBreakdown(ctx: RenderContext, snapshot: BalanceSnapshot): HTMLElement {
  const breakdown = el(
    "div",
    "snapshot-detail border-t border-slate-100 px-3.5 py-2 dark:border-slate-800",
  );
  for (const account of snapshot.accounts) {
    const line = el("div", "flex items-center justify-between gap-3 py-1 text-sm");
    const name = el("span", "flex items-center gap-2");
    name.append(accountDot(ctx.colorOf(account.id), "h-1.5 w-1.5"), account.name);
    line.append(name, el("span", "tabular-nums", formatYen(account.balance)));
    breakdown.append(line);
  }
  return breakdown;
}

interface SnapshotTotals {
  total: number;
  prevTotal: number | null;
}

/**
 * 行タップで口座ごとの内訳を開く。中身は開かれるまで組み立てない。
 * 一覧のほとんどの行は畳まれたままなので、先に作ると口座数ぶんの行を
 * 見られないまま並べることになる
 */
function snapshotItem(
  ctx: RenderContext,
  snapshot: BalanceSnapshot,
  totals: SnapshotTotals,
): HTMLElement {
  const item = document.createElement("details");
  item.className = "snapshot-item";
  item.append(snapshotSummary(snapshot, totals.total, totals.prevTotal));
  item.addEventListener("toggle", () => {
    if (item.open && item.querySelector(".snapshot-detail") === null) {
      item.append(snapshotBreakdown(ctx, snapshot));
    }
  });
  return item;
}

/** 積み上げた件数を引き継いでよい範囲。期間が変われば並ぶものも変わる */
function periodKey(state: UiState): string {
  return `${state.periodFrom}|${state.periodToExclusive}`;
}

/**
 * 新しい順に上限まで。古い方から作って先頭に差し込むと、打ち切ったときに
 * 残るのがいちばん古い側になってしまうため、新しい方から数える
 */
function snapshotList(
  ctx: RenderContext,
  visible: BalanceSnapshot[],
  totals: BalancePoint[],
): HTMLElement {
  const list = el(
    "div",
    `snapshot-list divide-y divide-slate-100 overflow-hidden ${CARD} dark:divide-slate-800`,
  );
  const limit = pageLimit(ctx.state.snapshotPaging, periodKey(ctx.state));
  for (let index = visible.length - 1; index >= 0 && visible.length - index <= limit; index -= 1) {
    list.append(
      snapshotItem(ctx, visible[index], {
        total: totals[index].balance,
        prevTotal: index > 0 ? totals[index - 1].balance : null,
      }),
    );
  }
  return list;
}

/** 残高スナップショットの一覧。推移パネルが形を、この表が値を担う */
export function snapshotSection(ctx: RenderContext): HTMLElement {
  const node = el("section", "snapshots");
  const visible = ctx.data.snapshots.filter((snapshot) => inPeriod(ctx.state, snapshot.takenAt));
  if (visible.length === 0) {
    node.append(el("p", `empty ${MUTED}`, emptyMessage(ctx)));
    return node;
  }
  node.append(snapshotList(ctx, visible, totalBalancePoints(visible)));
  const rest = visible.length - ctx.state.snapshotPaging.limit;
  if (rest > 0) {
    node.append(
      moreButton(rest, () => {
        ctx.state.snapshotPaging.limit += PAGE_SIZE;
        ctx.draw();
      }),
    );
  }
  return node;
}
