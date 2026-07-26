import { svgEl } from "./dom.ts";

/**
 * Lucide (ISC) のアイコンから、この画面で使うものだけを写して同梱する。
 * npm 依存を足さないのは、拡張の配布サイズを増やさないため。
 *
 * 色は必ず currentColor で、親の文字色に追従させる。意味を持つアイコン
 * (同期状態・警告)は必ずテキストと併記し、アイコンだけで伝えない
 */
const ICONS = {
  "settings-2":
    '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-up": '<path d="m18 15-6-6-6 6"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  "circle-check": '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  "triangle-alert":
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  list:
    '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>' +
    '<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  "chart-line": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/>' +
    '<line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>' +
    '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>' +
    '<path d="M2 12h2"/><path d="M20 12h2"/>' +
    '<path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon:
    '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803' +
    'a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
} as const;

export type IconName = keyof typeof ICONS;

const STROKE = "2";
/** 本文に添える大きさ。行の高さに収まり、単独でも潰れない */
const DEFAULT_SIZE = 16;

/**
 * 図形を組み立てた見本。innerHTMLへの代入はそのたびにHTMLの構文解析が走り、
 * ログ1行ごとに矢印と鉛筆を置くこの画面では再描画の大半をそこで使ってしまう。
 * 名前ごとに一度だけ組み立て、以降は複製する
 */
const templates = new Map<IconName, SVGElement>();

function template(name: IconName): SVGElement {
  const cached = templates.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": STROKE,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  // 同梱の定数のみを入れる。外から渡された文字列は流し込まない
  svg.innerHTML = ICONS[name];
  templates.set(name, svg);
  return svg;
}

export function icon(name: IconName, size = DEFAULT_SIZE, className = ""): SVGElement {
  const svg = template(name).cloneNode(true) as SVGElement;
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", `icon shrink-0 ${className}`.trim());
  return svg;
}
