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
export const MUTED = "text-sm text-slate-500 dark:text-slate-400";
export const FINE_PRINT = "text-xs text-slate-500 dark:text-slate-400";
export const INPUT =
  "rounded-md bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-sky-500 focus:outline-none dark:bg-slate-800 dark:ring-slate-600";
const BTN =
  "cursor-pointer rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
export const BTN_PRIMARY = `${BTN} bg-sky-600 px-4 py-1.5 font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400`;
export const BTN_SECONDARY = `${BTN} bg-white ring-1 ring-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:ring-slate-600 dark:hover:bg-slate-700`;
export const LINK =
  "cursor-pointer text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300";
export const LINK_BUTTON = `${LINK} border-none bg-transparent p-0`;
// 極性色(WCAG AA検証済み)。符号(+/−)自体が色以外の手掛かりを担う
export const POSITIVE = "text-emerald-700 dark:text-emerald-400";
export const NEGATIVE = "text-rose-700 dark:text-rose-400";
// ログ行・日カード・KPIカードの共通の面
export const CARD =
  "rounded-[14px] bg-white ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800";

function signedClass(amount: number): string | undefined {
  if (amount > 0) {
    return POSITIVE;
  }
  if (amount < 0) {
    return NEGATIVE;
  }
  return undefined;
}

/** 符号付き金額。+(入金)は緑、−(出金)は赤で表示する */
export function signedCell(amount: number): HTMLElement {
  return el("span", signedClass(amount), formatSigned(amount));
}

export function section(className: string, title: string): HTMLElement {
  const node = el(
    "section",
    `${className} mt-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 max-sm:p-3 dark:bg-slate-900 dark:ring-slate-800`,
  );
  node.append(el("h2", "mb-3 text-base font-semibold", title));
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

// 口座色(ドット・スパークライン用)。口座IDのハッシュで安定して割り当てる
const ACCOUNT_COLORS = [
  { dot: "bg-sky-600 dark:bg-sky-400", line: "text-sky-600 dark:text-sky-400" },
  { dot: "bg-amber-600 dark:bg-amber-400", line: "text-amber-600 dark:text-amber-400" },
  { dot: "bg-emerald-600 dark:bg-emerald-400", line: "text-emerald-600 dark:text-emerald-400" },
  { dot: "bg-indigo-600 dark:bg-indigo-400", line: "text-indigo-600 dark:text-indigo-400" },
];

const HASH_BASE = 31;

export function accountColor(id: string): (typeof ACCOUNT_COLORS)[number] {
  let hash = 0;
  for (const char of id) {
    hash = Math.trunc(hash * HASH_BASE + (char.codePointAt(0) ?? 0));
  }
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

export function accountDot(id: string, sizing = "h-2 w-2"): HTMLElement {
  return el("span", `dot ${sizing} shrink-0 rounded-full ${accountColor(id).dot}`);
}
