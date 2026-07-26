import {
  CHART,
  PLOT_BOTTOM,
  appendEndMarker,
  appendGrid,
  appendSeries,
  chartScale,
  markerPoints,
} from "./charts.ts";
import { formatDateTime, formatYen } from "./format.ts";
import type { BalancePoint } from "../domain/ledger.ts";
import type { ChartScale } from "./charts.ts";
import { svgEl } from "./dom.ts";

/**
 * 推移パネルの折れ線。素の残高グラフに、選択区間・出来事の目印・
 * 出入りの目盛りを重ねたもの。どの段階で何が動いたかを1枚で辿らせる。
 *
 * 図の中に文字は置かない。SVGは幅なりに拡縮されるため、狭い画面では
 * 5px相当まで縮んで読めなくなり、長い口座名や大きな金額では互いに重なる。
 * 値・日付・出来事の名前はパネル側がHTMLで出す
 */

const HALF = 2;
/** 出入りの目盛り帯。グラフの下に置き、取引の分布を一望させる */
const RUG_GAP = 6;
const RUG_MIN = 9;
const RUG_MAX = 20;
const RUG_WIDTH = 3;
/**
 * 目盛りを置く最小の間隔。幅ぶんしか空けないと隣どうしが接して1枚の黒帯になり、
 * 何件あるのかも分からなくなる。隙間を足して1本ずつを数えられる密度に保つ
 */
const RUG_PITCH = 5;
/** 帯の下に残す余白。帯が図の縁に貼り付いて見えないだけの幅 */
const RUG_BOTTOM_PAD = 4;
const RUG_TOP = PLOT_BOTTOM + RUG_GAP;
/** 折れ線と目盛り帯を合わせた全体の高さ */
const TREND_HEIGHT = RUG_TOP + RUG_MAX + RUG_BOTTOM_PAD;
/** 同じ点を2回選んだときも帯が見えるだけの幅を残す */
const MIN_SPAN_WIDTH = 1;
const HIT_RADIUS = "14";

export interface ChartSpan {
  from: number;
  to: number;
}

export interface RugMark {
  at: number;
  amount: number;
  /**
   * 口座色。どの口座から出入りしたのかを高さと合わせて一望できるようにする。
   * SVGの塗りは背景色では変わらないため、currentColorを差し替えるクラスを渡す
   */
  inkClass: string;
}

interface Picker {
  scale: ChartScale;
  onPick: (at: number) => void;
}

export interface TrendChartOptions {
  span: ChartSpan | null;
  /** 合計を大きく動かした出来事の時刻。名前はパネル側が凡例で出す */
  events: number[];
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
 * 合計残高を大きく動かした出来事の目印。名前を出せるものだけに引く
 * (ラベルの付かない破線は「何かがあった」としか言わず読み手の負担になる)。
 * 名前と日付はパネルの凡例が受け持ち、ここでは位置だけを示す
 */
function appendEvents(svg: SVGElement, events: number[], scale: ChartScale): void {
  for (const at of events) {
    const line = String(scale.xAt(at));
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

interface RugBar {
  center: number;
  height: number;
  inkClass: string;
}

/**
 * 同じ位置に重なる目盛りは、いちばん大きいものだけ残す。
 * 取引が増えると帯が塗り潰れ、分布どころか1件も読めなくなるため
 */
function thinRug(marks: RugMark[], scale: ChartScale): RugBar[] {
  const heights = rugHeights(marks);
  const byBucket = new Map<number, RugBar>();
  for (const [index, mark] of marks.entries()) {
    const bucket = Math.round(scale.xAt(mark.at) / RUG_PITCH);
    const bar = {
      center: bucket * RUG_PITCH,
      height: heights[index],
      inkClass: mark.inkClass,
    };
    const kept = byBucket.get(bucket);
    if (kept === undefined || bar.height > kept.height) {
      byBucket.set(bucket, bar);
    }
  }
  return [...byBucket.values()];
}

function appendRug(svg: SVGElement, marks: RugMark[], scale: ChartScale): void {
  for (const bar of thinRug(marks, scale)) {
    svg.append(
      svgEl(
        "rect",
        {
          x: String(bar.center - RUG_WIDTH / HALF),
          y: String(RUG_TOP + (RUG_MAX - bar.height)),
          width: String(RUG_WIDTH),
          height: String(bar.height),
          rx: String(RUG_WIDTH / HALF),
          fill: "currentColor",
        },
        `chart-rug ${bar.inkClass}`,
      ),
    );
  }
}

function pickTarget(point: BalancePoint, picker: Picker): SVGElement {
  const { scale, onPick } = picker;
  const hit = svgEl(
    "circle",
    {
      cx: String(scale.xAt(point.takenAt)),
      cy: String(scale.yAt(point.balance)),
      r: HIT_RADIUS,
      fill: "transparent",
    },
    "chart-hit cursor-pointer",
  );
  const title = svgEl("title");
  title.textContent = `${formatDateTime(point.takenAt)} ${formatYen(point.balance)}`;
  hit.append(title);
  hit.addEventListener("click", () => {
    onPick(point.takenAt);
  });
  return hit;
}

/**
 * 点を選ぶための当たり判定。ホバーでは日時と残高を読める。
 * 見えているマーカーにだけ置く。間引かれた点にも置くと、判定が幾重にも
 * 重なって狙った点を掴めないうえ、選んだ覚えのない日時が区間の端になる
 */
function appendPickTargets(svg: SVGElement, points: BalancePoint[], picker: Picker): void {
  const last = points.at(-1);
  if (last === undefined) {
    return;
  }
  for (const point of [...markerPoints(points, picker.scale), last]) {
    svg.append(pickTarget(point, picker));
  }
}

function trendSvg(): SVGElement {
  return svgEl(
    "svg",
    {
      viewBox: `0 0 ${CHART.width} ${TREND_HEIGHT}`,
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
