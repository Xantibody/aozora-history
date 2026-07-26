import {
  CHART,
  LABEL_INK,
  PLOT_BOTTOM,
  appendEndMarker,
  appendGrid,
  appendLabels,
  appendSeries,
  chartLabel,
  chartScale,
} from "./charts.ts";
import { formatDateTime, formatYen } from "./format.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import type { ChartScale } from "./charts.ts";
import { svgEl } from "./dom.ts";

/**
 * 推移パネルの折れ線。素の残高グラフに、選択区間・出来事の目印・
 * 出入りの目盛りを重ねたもの。どの段階で何が動いたかを1枚で辿らせる
 */

const HALF = 2;
const EVENT_LABEL_PAD = 5;
/** 出入りの目盛り帯。グラフの下に置き、取引の分布を一望させる */
const RUG_BAND = 28;
const RUG_GAP = 6;
const RUG_MIN = 9;
const RUG_MAX = 20;
const RUG_WIDTH = 3;
/** 同じ点を2回選んだときも帯が見えるだけの幅を残す */
const MIN_SPAN_WIDTH = 1;
const HIT_RADIUS = "14";

export interface ChartSpan {
  from: number;
  to: number;
}

export interface ChartEvent {
  at: number;
  label: string;
}

export interface RugMark {
  at: number;
  amount: number;
  /** 口座色。どの口座から出入りしたのかを高さと合わせて一望できるようにする */
  fillClass: string;
}

interface Picker {
  scale: ChartScale;
  onPick: (at: number) => void;
}

export interface TrendChartOptions {
  span: ChartSpan | null;
  events: ChartEvent[];
  rug: RugMark[];
  /** 点をクリックしたときに呼ぶ。2点で区間を決める */
  onPickPoint: (at: number) => void;
}

/** 選択中の区間。面より一段濃い矩形をグラフの背面に敷く */
function appendSpan(svg: SVGElement, span: ChartSpan, scale: ChartScale): void {
  const from = Math.max(span.from, scale.t0);
  const to = Math.min(span.to, scale.tN);
  const left = scale.xAt(from);
  const right = scale.xAt(to);
  const width = Math.max(Math.abs(right - left), MIN_SPAN_WIDTH);
  const start = Math.min(left, right);
  svg.append(
    svgEl(
      "rect",
      {
        x: String(start),
        y: String(CHART.top),
        width: String(width),
        height: String(PLOT_BOTTOM - CHART.top),
      },
      "chart-span fill-[#eef2f6] dark:fill-[#1a2330]",
    ),
  );
}

/**
 * 合計残高を大きく動かした出来事の目印。ラベルの付かない破線は
 * 「何かがあった」としか言わず読み手の負担にしかならないため、
 * 名前を出せるものだけに引く
 */
function appendEvents(svg: SVGElement, events: ChartEvent[], scale: ChartScale): void {
  for (const event of events) {
    const at = scale.xAt(event.at);
    const line = String(at);
    svg.append(
      svgEl(
        "line",
        {
          x1: line,
          y1: String(CHART.top),
          x2: line,
          y2: String(PLOT_BOTTOM),
          "stroke-width": "1",
          "stroke-dasharray": "3 3",
        },
        "chart-event stroke-[#94a3b8] dark:stroke-[#7f8b99]",
      ),
      chartLabel(
        event.label,
        { x: String(at + EVENT_LABEL_PAD), y: String(CHART.top + EVENT_LABEL_PAD) },
        `chart-event-label ${LABEL_INK}`,
      ),
    );
  }
}

/** 対数スケール。線形だと1件の大口で他が潰れ、分布が読めなくなる */
function rugHeights(marks: RugMark[]): number[] {
  const scaled = marks.map((mark) => Math.log10(Math.abs(mark.amount) + 1));
  const min = Math.min(...scaled);
  const max = Math.max(...scaled);
  return scaled.map((value) => {
    const ratio = max === min ? 1 : (value - min) / (max - min);
    return RUG_MIN + ratio * (RUG_MAX - RUG_MIN);
  });
}

function appendRug(svg: SVGElement, marks: RugMark[], scale: ChartScale): void {
  const heights = rugHeights(marks);
  const top = PLOT_BOTTOM + RUG_GAP;
  for (const [index, mark] of marks.entries()) {
    const height = heights[index];
    const center = scale.xAt(mark.at);
    svg.append(
      svgEl(
        "rect",
        {
          x: String(center - RUG_WIDTH / HALF),
          y: String(top + (RUG_MAX - height)),
          width: String(RUG_WIDTH),
          height: String(height),
          rx: String(RUG_WIDTH / HALF),
        },
        `chart-rug ${mark.fillClass}`,
      ),
    );
  }
}

/** 点を選ぶための当たり判定。ホバーでは日時と残高を読める */
function appendPickTargets(svg: SVGElement, points: BalancePoint[], picker: Picker): void {
  const { scale, onPick } = picker;
  for (const point of points) {
    const cx = String(scale.xAt(point.takenAt));
    const cy = String(scale.yAt(point.balance));
    const hit = svgEl(
      "circle",
      { cx, cy, r: HIT_RADIUS, fill: "transparent" },
      "chart-hit cursor-pointer",
    );
    const title = svgEl("title");
    title.textContent = `${formatDateTime(point.takenAt)} ${formatYen(point.balance)}`;
    hit.append(title);
    hit.addEventListener("click", () => {
      onPick(point.takenAt);
    });
    svg.append(hit);
  }
}

function trendSvg(): SVGElement {
  return svgEl(
    "svg",
    {
      viewBox: `0 0 ${CHART.width} ${CHART.height + RUG_BAND}`,
      role: "img",
      "aria-label": "合計残高の推移",
    },
    "balance-chart mt-3 w-full text-[#0f172a] dark:text-[#e6ecf3]",
  );
}

/** 折れ線そのもの。区間と目盛りはこの前後に重ねる */
function appendPlot(svg: SVGElement, points: BalancePoint[], scale: ChartScale): void {
  appendGrid(svg);
  appendSeries(svg, points, scale);
  appendEndMarker(svg, points, scale);
  appendLabels(svg, points, scale);
}

export function trendChart(points: BalancePoint[], options: TrendChartOptions): SVGElement {
  const scale = chartScale(points);
  const svg = trendSvg();
  if (options.span !== null) {
    appendSpan(svg, options.span, scale);
  }
  appendPlot(svg, points, scale);
  appendEvents(svg, options.events, scale);
  appendRug(svg, options.rug, scale);
  appendPickTargets(svg, points, { scale, onPick: options.onPickPoint });
  return svg;
}
