import { BTN_PRIMARY, CARD, FINE_PRINT, INK, INK_SOFT, MUTED, el, signedCell } from "./dom.ts";
import type { ChartSpan, RugMark } from "./trend-chart.ts";
import { detectBalanceChanges, totalBalancePoints } from "../domain/ledger.ts";
import { formatShortDateTime, formatTime, formatYen } from "./format.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import { MIN_CHART_POINTS } from "./charts.ts";
import type { RenderContext } from "./context.ts";
import { inPeriod } from "./period.ts";
import { trendChart } from "./trend-chart.ts";

/**
 * 推移パネル。「どの段階で・何にお金が動いたか」を1枚から辿れるようにする。
 *
 * 折れ線は合計残高の形、下の目盛り帯は取引ひとつひとつ、破線は合計を大きく
 * 動かした出来事。区間を選ぶとログ側の絞り込みになり、グラフから明細へ降りられる。
 *
 * 値・日付・出来事の名前はグラフの中ではなくHTMLで出す。SVGは幅なりに
 * 拡縮されるため、中に置いた文字は狭い画面で読めない大きさまで縮み、
 * 長い口座名や大きな金額どうしで重なってしまう
 */

/** 破線を引く出来事の数。増やすとグラフが読めなくなるので上位だけに絞る */
const MAX_EVENTS = 2;

interface TrendEvent {
  at: number;
  label: string;
}

function visibleSnapshots(ctx: RenderContext): BalancePoint[] {
  return totalBalancePoints(
    ctx.data.snapshots.filter((snapshot) => inPeriod(ctx.state, snapshot.takenAt)),
  );
}

/**
 * 合計残高を動かした外部入出金のうち、絶対額の大きいもの。
 * 凡例と破線を左から順に読み合わせられるよう、選んだあとは時刻順に戻す
 */
function topEvents(ctx: RenderContext): TrendEvent[] {
  return detectBalanceChanges(ctx.data.snapshots, ctx.ledger.transfers)
    .filter((change) => change.externalDelta !== 0 && inPeriod(ctx.state, change.toTakenAt))
    .toSorted((left, right) => Math.abs(right.externalDelta) - Math.abs(left.externalDelta))
    .slice(0, MAX_EVENTS)
    .toSorted((left, right) => left.toTakenAt - right.toTakenAt)
    .map((change) => ({
      at: change.toTakenAt,
      label: `${change.accountName} ${signedCell(change.externalDelta).textContent ?? ""}`,
    }));
}

/**
 * グラフ見出しの右に置く最新の合計。
 * 終端に置いていた金額ラベルの代わりで、桁が伸びても欠けず、縮んでも読める
 */
function latestLabel(points: BalancePoint[]): HTMLElement {
  const last = points.at(-1);
  const node = el("div", `chart-latest text-[13px] font-bold tabular-nums ${INK}`);
  node.append(last === undefined ? "" : formatYen(last.balance));
  return node;
}

/** 年をまたぐ期間か。またぐなら M/D だけでは去年の同じ日付と区別が付かない */
function spansYears(points: BalancePoint[]): boolean {
  const [first] = points;
  const last = points.at(-1) ?? first;
  return new Date(first.takenAt).getFullYear() !== new Date(last.takenAt).getFullYear();
}

function axisDate(epochMs: number, withYear: boolean): string {
  const date = new Date(epochMs);
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  return withYear ? `${date.getFullYear()}/${monthDay}` : monthDay;
}

/** グラフの下に置く期間の両端。目盛り帯と重ならないよう図の外に出す */
function axisRow(points: BalancePoint[], withYear: boolean): HTMLElement {
  const [first] = points;
  const last = points.at(-1) ?? first;
  const row = el("div", `chart-axis mt-1.5 flex items-baseline justify-between ${FINE_PRINT}`);
  row.append(
    el("span", "chart-axis-from tabular-nums", axisDate(first.takenAt, withYear)),
    el("span", "chart-axis-to tabular-nums", axisDate(last.takenAt, withYear)),
  );
  return row;
}

/**
 * 破線の凡例。図の中に名前を置くと、長い口座名どうしや終端の金額と重なるため
 * 外に出す。並びは破線と同じ左からの順で、どれがどれかは日時で辿れる
 */
function eventLegend(events: TrendEvent[], withYear: boolean): HTMLElement {
  const row = el("div", `chart-events mt-1.5 flex flex-wrap gap-x-4 gap-y-1 ${FINE_PRINT}`);
  for (const event of events) {
    const item = el("span", "chart-event-item inline-flex items-baseline gap-1.5");
    item.append(
      el(
        "span",
        `tabular-nums ${INK_SOFT}`,
        `${axisDate(event.at, withYear)} ${formatTime(event.at)}`,
      ),
      el("span", undefined, event.label),
    );
    row.append(item);
  }
  return row;
}

/** 目盛り帯に出す取引。振替は口座間の移動でも「いつ何が動いたか」の手掛かりになる */
function rugMarks(ctx: RenderContext): RugMark[] {
  return ctx.ledger.transfers
    .filter((transfer) => inPeriod(ctx.state, transfer.transferredAt))
    .map((transfer) => ({
      at: transfer.transferredAt,
      amount: transfer.amount,
      inkClass: ctx.colorOf(transfer.from.id).line,
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

/** 見出し。左に何のグラフか、右に最新の合計 */
function titleRow(points: BalancePoint[]): HTMLElement {
  const row = el("div", "flex items-baseline justify-between gap-3");
  row.append(
    el("div", `chart-label text-[13.5px] font-bold ${INK}`, "合計残高の推移"),
    latestLabel(points),
  );
  return row;
}

/** 見出し・グラフ・期間の両端・破線の凡例をこの順に積む */
function chartHead(ctx: RenderContext, points: BalancePoint[]): HTMLElement {
  const head = el("div", "px-[18px] pt-4 pb-3");
  const events = topEvents(ctx);
  const withYear = spansYears(points);
  head.append(
    titleRow(points),
    trendChart(points, {
      span: ctx.state.selectedSpan,
      events: events.map((event) => event.at),
      rug: rugMarks(ctx),
      onPickPoint: (at) => {
        pickPoint(ctx, at);
      },
    }),
    axisRow(points, withYear),
    ...(events.length === 0 ? [] : [eventLegend(events, withYear)]),
  );
  return head;
}

export function trendPanel(ctx: RenderContext): HTMLElement {
  const node = el("section", `history overflow-hidden ${CARD}`);
  const points = visibleSnapshots(ctx);
  if (points.length < MIN_CHART_POINTS) {
    node.append(el("p", `empty p-4 ${MUTED}`, "推移を描くには残高の記録が2件以上必要です"));
    return node;
  }
  node.append(chartHead(ctx, points), spanSummary(ctx, points));
  return node;
}
