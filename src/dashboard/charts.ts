import { formatDateTime, formatYen, shortDate } from "./format.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import { svgEl } from "./dom.ts";

/** グラフ・スパークラインを描くのに必要な最小の点数 */
export const MIN_CHART_POINTS = 2;

const HALF = 2;

// 折れ線グラフの寸法。右側は終端の金額ラベル分の余白
const CHART = { width: 640, height: 160, left: 8, right: 76, top: 16, bottom: 22 };
const PLOT_RIGHT = CHART.width - CHART.right;
const PLOT_BOTTOM = CHART.height - CHART.bottom;

interface ChartScale {
  t0: number;
  tN: number;
  xAt: (time: number) => number;
  yAt: (balance: number) => number;
}

function lastPoint(points: BalancePoint[]): BalancePoint {
  const last = points.at(-1);
  if (last === undefined) {
    throw new Error("点が空の系列は描画できません");
  }
  return last;
}

function chartScale(points: BalancePoint[]): ChartScale {
  const { left, top } = CHART;
  const t0 = points[0].takenAt;
  const tN = lastPoint(points).takenAt;
  const balances = points.map((point) => point.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const xAt = (time: number): number =>
    tN === t0 ? left : left + ((time - t0) / (tN - t0)) * (PLOT_RIGHT - left);
  const yAt = (balance: number): number =>
    max === min
      ? (top + PLOT_BOTTOM) / HALF
      : PLOT_BOTTOM - ((balance - min) / (max - min)) * (PLOT_BOTTOM - top);
  return { t0, tN, xAt, yAt };
}

function appendGrid(svg: SVGElement): void {
  // 罫線は面から1段ずらしたヘアライン
  for (const gridY of [CHART.top, (CHART.top + PLOT_BOTTOM) / HALF, PLOT_BOTTOM]) {
    svg.append(
      svgEl(
        "line",
        {
          x1: String(CHART.left),
          y1: String(gridY),
          x2: String(PLOT_RIGHT),
          y2: String(gridY),
          "stroke-width": "1",
        },
        "chart-grid stroke-slate-200 dark:stroke-slate-700",
      ),
    );
  }
}

function seriesCoords(points: BalancePoint[], scale: ChartScale): string[] {
  return points.map((point) => `${scale.xAt(point.takenAt)},${scale.yAt(point.balance)}`);
}

function appendSeries(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
  const coords = seriesCoords(points, scale).join(" ");
  const baseline = `${CHART.left},${PLOT_BOTTOM}`;
  const closing = `${scale.xAt(scale.tN)},${PLOT_BOTTOM}`;
  svg.append(
    svgEl(
      "polygon",
      {
        points: `${baseline} ${coords} ${closing}`,
        fill: "currentColor",
        "fill-opacity": "0.1",
      },
      "chart-area",
    ),
    svgEl(
      "polyline",
      {
        points: coords,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      },
      "chart-line",
    ),
  );
}

function appendEndMarker(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
  // 終端マーカーはカード面の色のリングで線から浮かせる
  const last = lastPoint(points);
  const cx = String(scale.xAt(last.takenAt));
  const cy = String(scale.yAt(last.balance));
  svg.append(
    svgEl(
      "circle",
      { cx, cy, r: "4", fill: "currentColor", "stroke-width": "2" },
      "chart-end stroke-white dark:stroke-slate-950",
    ),
  );
}

// ラベルは系列色ではなくテキスト用のインクで描く
const LABEL_INK = "fill-slate-500 dark:fill-slate-400";
const END_LABEL_OFFSET_X = 8;
const END_LABEL_OFFSET_Y = 4;
const X_LABEL_BASELINE_PAD = 6;

function chartLabel(text: string, attrs: Record<string, string>, cls: string): SVGElement {
  const node = svgEl("text", { "font-size": "11", ...attrs }, cls);
  node.textContent = text;
  return node;
}

function appendLabels(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
  const last = lastPoint(points);
  const endX = String(scale.xAt(scale.tN) + END_LABEL_OFFSET_X);
  const endY = String(scale.yAt(last.balance) + END_LABEL_OFFSET_Y);
  const baseline = String(CHART.height - X_LABEL_BASELINE_PAD);
  svg.append(
    chartLabel(formatYen(last.balance), { x: endX, y: endY }, `chart-end-label ${LABEL_INK}`),
    chartLabel(
      shortDate(scale.t0),
      { x: String(CHART.left), y: baseline },
      `chart-x-label ${LABEL_INK}`,
    ),
    chartLabel(
      shortDate(scale.tN),
      { x: String(PLOT_RIGHT), y: baseline, "text-anchor": "end" },
      `chart-x-label ${LABEL_INK}`,
    ),
  );
}

function appendHoverTargets(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
  // ホバーで各点の日時と残高を読めるようにする(マークより広い当たり判定)
  for (const point of points) {
    const cx = String(scale.xAt(point.takenAt));
    const cy = String(scale.yAt(point.balance));
    const hit = svgEl("circle", { cx, cy, r: "14", fill: "transparent" }, "chart-hit");
    const title = svgEl("title");
    title.textContent = `${formatDateTime(point.takenAt)} ${formatYen(point.balance)}`;
    hit.append(title);
    svg.append(hit);
  }
}

/**
 * 残高推移の折れ線。系列は1つなので凡例は置かずアクセント1色
 * (ライト・ダーク両面で検証済みのsky-600)で描く。各点の値はホバーの
 * <title>と推移タブのスナップショット一覧でも読めるため、直接ラベルは
 * 終端の1つに絞る
 */
export function balanceChart(points: BalancePoint[]): SVGElement {
  const scale = chartScale(points);
  const svg = svgEl(
    "svg",
    { viewBox: `0 0 ${CHART.width} ${CHART.height}`, role: "img", "aria-label": "残高推移" },
    "balance-chart mt-3 w-full text-sky-600 dark:text-sky-400",
  );
  appendGrid(svg);
  appendSeries(svg, points, scale);
  appendEndMarker(svg, points, scale);
  appendLabels(svg, points, scale);
  appendHoverTargets(svg, points, scale);
  return svg;
}

const SPARK = { width: 120, height: 36, pad: 5 };

function sparkScale(points: BalancePoint[]): ChartScale {
  const { width, height, pad } = SPARK;
  const t0 = points[0].takenAt;
  const tN = lastPoint(points).takenAt;
  const balances = points.map((point) => point.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const xAt = (time: number): number =>
    tN === t0 ? pad : pad + ((time - t0) / (tN - t0)) * (width - pad - pad);
  const yAt = (balance: number): number =>
    max === min
      ? height / HALF
      : height - pad - ((balance - min) / (max - min)) * (height - pad - pad);
  return { t0, tN, xAt, yAt };
}

/**
 * ヘッダーと口座カード用の小さな折れ線(120×36)。値はラベルにせず
 * 形だけ見せる(正確な値は推移タブ・口座カードの数字で読める)
 */
export function sparkline(points: BalancePoint[], className: string): SVGElement {
  const scale = sparkScale(points);
  const svg = svgEl(
    "svg",
    { viewBox: `0 0 ${SPARK.width} ${SPARK.height}`, "aria-hidden": "true" },
    `${className} h-9 w-[120px] shrink-0`,
  );
  const coords = seriesCoords(points, scale).join(" ");
  const cx = String(scale.xAt(scale.tN));
  const cy = String(scale.yAt(lastPoint(points).balance));
  svg.append(
    svgEl("polyline", {
      points: coords,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    }),
    svgEl("circle", { cx, cy, r: "3", fill: "currentColor" }),
  );
  return svg;
}
