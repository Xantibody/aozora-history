import type { BalancePoint } from "../domain/ledger.ts";
import { svgEl } from "./dom.ts";

/** グラフ・スパークラインを描くのに必要な最小の点数 */
export const MIN_CHART_POINTS = 2;

const HALF = 2;

/**
 * 折れ線グラフの寸法。
 *
 * 図の中に文字を置かないため、ラベル用の余白は取らない。SVGは幅なりに
 * 拡縮されるので、中に置いた文字は狭い画面で5px相当まで縮んで読めなくなり、
 * 長い口座名や大きな金額では互いに重なる。値と日付はグラフの外にHTMLで出す
 */
export const CHART = { width: 640, height: 148, left: 8, right: 8, top: 16, bottom: 10 };
const PLOT_RIGHT = CHART.width - CHART.right;
export const PLOT_BOTTOM = CHART.height - CHART.bottom;

export interface ChartScale {
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

export function chartScale(points: BalancePoint[]): ChartScale {
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

export function appendGrid(svg: SVGElement): void {
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
        "chart-grid stroke-[#eef0f4] dark:stroke-[#1e2733]",
      ),
    );
  }
}

function seriesCoords(points: BalancePoint[], scale: ChartScale): string[] {
  return points.map((point) => `${scale.xAt(point.takenAt)},${scale.yAt(point.balance)}`);
}

export function appendSeries(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
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

/**
 * 途中のマーカーを置く最小の間隔。直径6に隙間を足した値。
 * 記録が増えるとマーカーが重なって線が太い帯に潰れ、形が読めなくなる
 */
const POINT_MIN_GAP = 8;

/**
 * 間隔が空いている点だけを残す。終端は必ず含める(いちばん新しい記録は
 * 落とさない)。当たり判定もこの並びに合わせる。見えていない点を選べても
 * 隣とどちらを掴んだのか分からず、密集していると狙って選べない
 */
export function markerPoints(points: BalancePoint[], scale: ChartScale): BalancePoint[] {
  const kept: BalancePoint[] = [];
  let lastX = -Infinity;
  for (const point of points.slice(0, -1)) {
    const at = scale.xAt(point.takenAt);
    if (at - lastX >= POINT_MIN_GAP) {
      kept.push(point);
      lastX = at;
    }
  }
  return kept;
}

export function appendEndMarker(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
  // 途中の点は白抜き、終端だけ塗る。どこが最新かを形で示す
  for (const point of markerPoints(points, scale)) {
    const cx = String(scale.xAt(point.takenAt));
    const cy = String(scale.yAt(point.balance));
    svg.append(
      svgEl(
        "circle",
        { cx, cy, r: "3", stroke: "currentColor", "stroke-width": "2" },
        "chart-point fill-white dark:fill-[#121821]",
      ),
    );
  }
  // 終端マーカーはカード面の色のリングで線から浮かせる
  const last = lastPoint(points);
  const cx = String(scale.xAt(last.takenAt));
  const cy = String(scale.yAt(last.balance));
  svg.append(
    svgEl(
      "circle",
      { cx, cy, r: "4", fill: "currentColor", "stroke-width": "2" },
      "chart-end stroke-white dark:stroke-[#121821]",
    ),
  );
}
