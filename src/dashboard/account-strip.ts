import { BORDER, INK, INK_DECOR, INK_SOFT, SELECTED, SURFACE, accountDot, el } from "./dom.ts";
import type { RenderContext } from "./context.ts";
import type { WorkspaceSummary } from "../domain/ledger.ts";
import { formatYen } from "./format.ts";
import { icon } from "./icons.ts";
import { inPeriod } from "./period.ts";
import { workspaceSummaries } from "../domain/ledger.ts";

/**
 * ログページの口座の帯。合計と口座残高は取引を読むうえでの文脈でしかないため、
 * カード面を持たせず1行に圧縮する。残高そのものを見たいときは残高ページへ。
 *
 * チップのタップが口座での絞り込みを兼ねる。フィルタ行に口座セレクトを置くと
 * 同じ操作の入口が2つになるため、そちらは廃止した
 */

const CHIP_BASE =
  "account-chip flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-full px-[11px] " +
  "text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";

const HINT_ICON_SIZE = 14;

function toggleAccount(ctx: RenderContext, accountId: string): void {
  ctx.state.filterAccountId = ctx.state.filterAccountId === accountId ? null : accountId;
  ctx.draw();
}

function accountChip(ctx: RenderContext, summary: WorkspaceSummary): HTMLElement {
  const selected = ctx.state.filterAccountId === summary.id;
  const chip = el(
    "button",
    selected
      ? `${CHIP_BASE} active ${SELECTED}`
      : `${CHIP_BASE} ${SURFACE} ${BORDER} ${INK_SOFT} hover:bg-[#f6f7f9] dark:hover:bg-[#1a222c]`,
  );
  chip.setAttribute("aria-pressed", String(selected));
  chip.append(
    accountDot(ctx.colorOf(summary.id), "h-2 w-2"),
    el("span", "chip-name", summary.name),
    el("span", "chip-balance font-bold tabular-nums", formatYen(summary.balance)),
  );
  chip.addEventListener("click", () => {
    toggleAccount(ctx, summary.id);
  });
  return chip;
}

/** 合計。面を持たせず、数字だけを置いて口座チップに場所を譲る */
function totalLine(total: number, delta: number): HTMLElement {
  const line = el("div", "strip-total flex shrink-0 items-baseline gap-1.5");
  line.append(el("span", `text-[11.5px] ${INK_SOFT}`, "合計"));
  const amount = el(
    "span",
    `total-balance text-[22px] font-bold tracking-[-.01em] tabular-nums sm:text-2xl ${INK}`,
    total.toLocaleString("ja-JP"),
  );
  amount.append(el("span", "text-[13px] font-medium", "円"));
  line.append(amount);
  const deltaCell = el(
    "span",
    `total-delta text-[13px] font-bold tabular-nums ${INK_SOFT}`,
    delta === 0 ? "±0" : `${delta > 0 ? "+" : "-"}${Math.abs(delta).toLocaleString("ja-JP")}`,
  );
  line.append(deltaCell);
  return line;
}

function chipRail(ctx: RenderContext, summaries: WorkspaceSummary[]): HTMLElement {
  const chips = el("div", "account-chips flex min-w-0 items-center gap-2 overflow-x-auto");
  for (const summary of summaries) {
    chips.append(accountChip(ctx, summary));
  }
  // 横に続きがあることの合図。スクロールできると気づけないと口座を選べない
  if (summaries.length > 0) {
    const hint = el("span", `scroll-hint shrink-0 ${INK_DECOR}`);
    hint.append(icon("chevron-right", HINT_ICON_SIZE));
    chips.append(hint);
  }
  return chips;
}

export function accountStrip(ctx: RenderContext): HTMLElement {
  const summaries = workspaceSummaries(ctx.data.snapshots, ctx.ledger.transfers, (ms) =>
    inPeriod(ctx.state, ms),
  );
  const total = summaries.reduce((sum, summary) => sum + summary.balance, 0);
  const delta = summaries.reduce((sum, summary) => sum + summary.delta, 0);
  const strip = el(
    "div",
    "account-strip flex items-center gap-3 overflow-hidden pt-1 pb-3 sm:gap-4",
  );
  strip.append(totalLine(total, delta), chipRail(ctx, summaries));
  return strip;
}
