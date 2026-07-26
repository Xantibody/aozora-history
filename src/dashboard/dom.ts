import { formatSigned } from "./format.ts";

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// クラス名の先頭は意味を表すマーカー(テストとイベント処理のフック)、
// 続くTailwindユーティリティが見た目を担う

/**
 * 文字の濃さは3段。意味の重みをサイズと濃淡で表し、色には持たせない。
 * どれも載る面の上で 4.5:1 以上あり、本文に使える
 */
export const INK = "text-[#0f172a] dark:text-[#e6ecf3]";
export const INK_SOFT = "text-[#5b6675] dark:text-[#c3cedb]";
export const INK_WEAK = "text-[#64748b] dark:text-[#9aa7b6]";
/** 矢印や補助アイコンなど、読まなくても意味が通る装飾だけに使う */
export const INK_DECOR = "text-[#94a3b8] dark:text-[#7f8b99]";

export const MUTED = `text-sm ${INK_WEAK}`;
export const FINE_PRINT = `text-xs ${INK_WEAK}`;

/** カードの面と罫線。影は使わず罫線だけで面を分ける */
export const SURFACE = "bg-white dark:bg-[#121821]";
export const BORDER = "ring-1 ring-[#e8ebf0] dark:ring-[#1e2733]";
export const CARD = `rounded-[14px] ${SURFACE} ${BORDER}`;
/** カードの中を区切る罫。外周より一段薄い */
export const DIVIDER = "border-[#f1f3f7] dark:border-[#1a222c]";

/** 選択中のチップ・主ボタン。面を反転させて示す */
export const SELECTED = "bg-[#0f172a] text-white dark:bg-[#1c2733] dark:text-[#e6ecf3]";
/** バッジの地色。この上でも本文の濃さが 4.5:1 を満たす */
export const BADGE = `rounded-[5px] bg-[#eef1f5] px-[7px] dark:bg-[#1e2733] ${INK_SOFT}`;
/** 推移で選んだ区間の帯 */
export const SPAN_HIGHLIGHT = "bg-[#eef2f6] dark:bg-[#1a2330]";
/** 同期済みの合図。必ずテキストと併記する */
export const SUCCESS = "text-[#2f8f5b] dark:text-[#3fa66f]";
/** 記録が止まっているときの警告。同上 */
export const WARNING = "text-amber-700 dark:text-amber-400";

export const INPUT =
  "h-[38px] rounded-[9px] bg-white px-3 text-sm ring-1 ring-[#dfe4ea] focus:ring-2 focus:ring-sky-500 focus:outline-none dark:bg-[#121821] dark:ring-[#243040]";
const BTN =
  "cursor-pointer rounded-[9px] text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
export const BTN_PRIMARY = `${BTN} ${SELECTED} px-4 py-2 font-semibold`;
export const BTN_SECONDARY = `${BTN} ${SURFACE} px-3.5 py-2 ring-1 ring-[#e4e8ee] hover:bg-[#f6f7f9] dark:ring-[#243040] dark:hover:bg-[#1a222c]`;
export const LINK =
  "cursor-pointer text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300";
export const LINK_BUTTON = `${LINK} border-none bg-transparent p-0`;

/**
 * 符号付き金額。色で入金・出金を分けず、符号とインクの濃淡で示す。
 * 色で意味を持つのは口座色だけに絞っているため
 */
export function signedCell(amount: number): HTMLElement {
  return el("span", `tabular-nums ${amount < 0 ? INK_SOFT : INK}`, formatSigned(amount));
}

export function section(className: string, title: string): HTMLElement {
  const node = el("section", `${className} mt-3.5 p-4 max-sm:p-3 ${CARD}`);
  node.append(el("h2", `mb-3 text-[13.5px] font-bold ${INK}`, title));
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(
  tag: string,
  attrs: Record<string, string> = {},
  className?: string,
): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  if (className !== undefined) {
    node.setAttribute("class", className);
  }
  return node;
}

/**
 * 口座色(ドット・スパークライン用)。
 *
 * 色覚特性があっても隣り合う色を取り違えないよう、Okabe-Ito の配色から
 * 互いに離れた6色を使う。赤と緑、緑と橙のような紛らわしい組は入れていない。
 * 色だけに意味を持たせず、口座名は必ず文字でも出す
 */
const ACCOUNT_COLORS = [
  {
    dot: "bg-[#0072B2] dark:bg-[#56B4E9]",
    line: "text-[#0072B2] dark:text-[#56B4E9]",
    border: "border-[#0072B2] dark:border-[#56B4E9]",
  },
  {
    dot: "bg-[#D55E00] dark:bg-[#E69F00]",
    line: "text-[#D55E00] dark:text-[#E69F00]",
    border: "border-[#D55E00] dark:border-[#E69F00]",
  },
  {
    dot: "bg-[#009E73] dark:bg-[#3FC7A1]",
    line: "text-[#009E73] dark:text-[#3FC7A1]",
    border: "border-[#009E73] dark:border-[#3FC7A1]",
  },
  {
    dot: "bg-[#AA5A87] dark:bg-[#CC79A7]",
    line: "text-[#AA5A87] dark:text-[#CC79A7]",
    border: "border-[#AA5A87] dark:border-[#CC79A7]",
  },
  {
    dot: "bg-[#5B5EA6] dark:bg-[#9A9CE0]",
    line: "text-[#5B5EA6] dark:text-[#9A9CE0]",
    border: "border-[#5B5EA6] dark:border-[#9A9CE0]",
  },
  {
    dot: "bg-[#8C6D1F] dark:bg-[#D9C55A]",
    line: "text-[#8C6D1F] dark:text-[#D9C55A]",
    border: "border-[#8C6D1F] dark:border-[#D9C55A]",
  },
];

export type AccountColor = (typeof ACCOUNT_COLORS)[number];

/**
 * 並び順で色を割り当てる。IDのハッシュだと口座数が少なくても色がぶつかり、
 * 別の口座が同じ色になって見分けられないことがある
 */
export function accountColorAt(index: number): AccountColor {
  return ACCOUNT_COLORS[index % ACCOUNT_COLORS.length];
}

/** 口座色の四角。円より角のある形の方が小さくても識別しやすい */
export function accountDot(color: AccountColor, sizing = "h-2 w-2"): HTMLElement {
  return el("span", `dot ${sizing} shrink-0 rounded-[3px] ${color.dot}`);
}
