import { BTN_PRIMARY, CARD, INK, INK_SOFT, MUTED, el, signedCell } from "./dom.ts";
import type { ChartEvent, ChartSpan, RugMark } from "./trend-chart.ts";
import { detectBalanceChanges, totalBalancePoints } from "../domain/ledger.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import { MIN_CHART_POINTS } from "./charts.ts";
import type { RenderContext } from "./context.ts";
import { formatShortDateTime } from "./format.ts";
import { inPeriod } from "./period.ts";
import { trendChart } from "./trend-chart.ts";

/**
 * 推移パネル。「どの段階で・何にお金が動いたか」を1枚から辿れるようにする。
 *
 * 折れ線は合計残高の形、下の目盛り帯は取引ひとつひとつ、破線は合計を大きく
 * 動かした出来事。区間を選ぶとログ側の絞り込みになり、グラフから明細へ降りられる
 */

/** 破線を引く出来事の数。増やすとグラフが読めなくなるので上位だけに絞る */
const MAX_EVENTS = 2;

function visibleSnapshots(ctx: RenderContext): BalancePoint[] {
  return totalBalancePoints(
    ctx.data.snapshots.filter((snapshot) => inPeriod(ctx.state, snapshot.takenAt)),
  );
}

/** 合計残高を動かした外部入出金のうち、絶対額の大きいもの */
function topEvents(ctx: RenderContext): ChartEvent[] {
  return detectBalanceChanges(ctx.data.snapshots, ctx.ledger.transfers)
    .filter((change) => change.externalDelta !== 0 && inPeriod(ctx.state, change.toTakenAt))
    .toSorted((left, right) => Math.abs(right.externalDelta) - Math.abs(left.externalDelta))
    .slice(0, MAX_EVENTS)
    .map((change) => ({
      at: change.toTakenAt,
      label: `${change.accountName} ${signedCell(change.externalDelta).textContent ?? ""}`,
    }));
}

/** 目盛り帯に出す取引。振替は口座間の移動でも「いつ何が動いたか」の手掛かりになる */
function rugMarks(ctx: RenderContext): RugMark[] {
  return ctx.ledger.transfers
    .filter((transfer) => inPeriod(ctx.state, transfer.transferredAt))
    .map((transfer) => ({
      at: transfer.transferredAt,
      amount: transfer.amount,
      fillClass: ctx.colorOf(transfer.from.id).dot,
    }));
}

/** 2回のクリックで区間を決める。1回目は始点、2回目で締める */
function pickPoint(ctx: RenderContext, at: number): void {
  const span = ctx.state.selectedSpan;
  const started = span !== null && span.from === span.to;
  ctx.state.selectedSpan = started
    ? { from: Math.min(span.from, at), to: Math.max(span.from, at) }
    : { from: at, to: at };
  ctx.draw();
}

function spanTotal(points: BalancePoint[], span: ChartSpan): number {
  const inside = points.filter((point) => point.takenAt >= span.from && point.takenAt <= span.to);
  const [first] = inside;
  const last = inside.at(-1);
  return first === undefined || last === undefined ? 0 : last.balance - first.balance;
}

function spanFigures(points: BalancePoint[], span: ChartSpan): HTMLElement {
  const left = el("div", "flex flex-col gap-1");
  const label = el("div", `text-[12.5px] ${INK_SOFT}`);
  label.append(`選択中の区間 ${formatShortDateTime(span.from)} → ${formatShortDateTime(span.to)}`);
  const total = el("div", `span-total text-[13px] font-bold ${INK}`);
  total.append("この区間 ", signedCell(spanTotal(points, span)));
  left.append(label, total);
  return left;
}

function openInLogButton(ctx: RenderContext): HTMLElement {
  const open = el("button", `span-open ${BTN_PRIMARY} text-[12.5px]`, "この区間をログで見る →");
  open.addEventListener("click", () => {
    ctx.state.activeTab = "log";
    ctx.draw();
  });
  return open;
}

function spanSummary(ctx: RenderContext, points: BalancePoint[]): HTMLElement {
  const span = ctx.state.selectedSpan;
  const bar = el(
    "div",
    "span-summary flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f3f7] " +
      "bg-[#fbfcfd] px-[18px] pt-3.5 pb-4 dark:border-[#1a222c] dark:bg-[#0f1620]",
  );
  bar.append(
    ...(span === null
      ? [el("p", MUTED, "グラフの点を2つ選ぶと、その区間の出入りをログで追えます")]
      : [spanFigures(points, span), openInLogButton(ctx)]),
  );
  return bar;
}

export function trendPanel(ctx: RenderContext): HTMLElement {
  const node = el("section", `history overflow-hidden ${CARD}`);
  const points = visibleSnapshots(ctx);
  if (points.length < MIN_CHART_POINTS) {
    node.append(el("p", `empty p-4 ${MUTED}`, "推移を描くには残高の記録が2件以上必要です"));
    return node;
  }
  const head = el("div", "px-[18px] pt-4");
  head.append(el("div", `chart-label text-[13.5px] font-bold ${INK}`, "合計残高の推移"));
  head.append(
    trendChart(points, {
      span: ctx.state.selectedSpan,
      events: topEvents(ctx),
      rug: rugMarks(ctx),
      onPickPoint: (at) => {
        pickPoint(ctx, at);
      },
    }),
  );
  node.append(head, spanSummary(ctx, points));
  return node;
}
