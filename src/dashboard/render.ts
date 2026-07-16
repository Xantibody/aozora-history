import type { AccountRef } from "../domain/parser.ts";
import {
  type BalancePoint,
  type BalanceSnapshot,
  changeCommentKey,
  commentSuggestions,
  commentText,
  latestRecordAt,
  latestSnapshot,
  type LogEntry,
  logEntries,
  sortTransfersDesc,
  totalBalancePoints,
  transferCommentKey,
  type TransferRecord,
  type WorkspaceSummary,
  workspaceSummaries,
} from "../domain/ledger.ts";
import {
  DEFAULT_OBJECT_KEY,
  parseSyncConfigJson,
  type SyncConfig,
} from "../infrastructure/r2sync.ts";
import type { Comments } from "../domain/ledger.ts";

export interface DashboardData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Comments;
  deletions: Record<string, number>;
  syncConfig: SyncConfig | null;
  lastSyncedAt: number | null;
}

export interface DashboardHandlers {
  onCommentChange(key: string, text: string): void;
  onDeleteTransfer(transfer: TransferRecord): void;
  onSaveSyncConfig(config: SyncConfig): Promise<string>;
  onSyncNow(): Promise<string>;
  onImportFile(text: string): Promise<string>;
}

export function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function formatSigned(amount: number): string {
  if (amount === 0) return "±0円";
  return (amount > 0 ? "+" : "-") + formatYen(Math.abs(amount));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatShortDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(epochMs)}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDayHeading(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

/** 日付グループ用のキー。ローカル時刻の暦日で区切る */
function localDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** 家計簿ソフトなどへの取り込み用CSV。金額は数値のまま出す */
export function transfersCsv(transfers: TransferRecord[], comments: Comments): string {
  const rows = sortTransfersDesc(transfers).map((t) =>
    [
      formatDateTime(t.transferredAt),
      t.from.name,
      t.to.name,
      String(t.amount),
      commentText(comments, transferCommentKey(t)),
    ]
      .map(csvField)
      .join(","),
  );
  // ExcelがUTF-8として認識できるようBOMを付ける
  return `﻿${["日時,出金口座,入金口座,金額,コメント", ...rows].join("\r\n")}\r\n`;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// クラス名の先頭は意味を表すマーカー(テストとイベント処理のフック)、
// 続くTailwindユーティリティが見た目を担う
const MUTED = "text-sm text-slate-500 dark:text-slate-400";
const FINE_PRINT = "text-xs text-slate-500 dark:text-slate-400";
const INPUT =
  "rounded-md bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-sky-500 focus:outline-none dark:bg-slate-800 dark:ring-slate-600";
const BTN =
  "cursor-pointer rounded-lg text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const BTN_PRIMARY = `${BTN} bg-sky-600 px-4 py-1.5 font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400`;
const BTN_SECONDARY = `${BTN} bg-white ring-1 ring-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:ring-slate-600 dark:hover:bg-slate-700`;
const LINK =
  "cursor-pointer text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300";
const LINK_BUTTON = `${LINK} border-none bg-transparent p-0`;
// 極性色(WCAG AA検証済み)。符号(+/−)自体が色以外の手掛かりを担う
const POSITIVE = "text-emerald-700 dark:text-emerald-400";
const NEGATIVE = "text-rose-700 dark:text-rose-400";
// ログ行・日カード・KPIカードの共通の面
const CARD = "rounded-[14px] bg-white ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800";

/** 符号付き金額。+(入金)は緑、−(出金)は赤で表示する */
function signedCell(amount: number): HTMLElement {
  const cls = amount > 0 ? POSITIVE : amount < 0 ? NEGATIVE : undefined;
  return el("span", cls, formatSigned(amount));
}

function section(className: string, title: string): HTMLElement {
  const node = el(
    "section",
    `${className} mt-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 max-sm:p-3 dark:bg-slate-900 dark:ring-slate-800`,
  );
  node.append(el("h2", "mb-3 text-base font-semibold", title));
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs: Record<string, string> = {}, className?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (className !== undefined) node.setAttribute("class", className);
  return node;
}

function shortDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 折れ線グラフの寸法。右側は終端の金額ラベル分の余白
const CHART = { width: 640, height: 160, left: 8, right: 76, top: 16, bottom: 22 };

/**
 * 残高推移の折れ線。系列は1つなので凡例は置かずアクセント1色
 * (ライト・ダーク両面で検証済みのsky-600)で描く。各点の値はホバーの
 * <title>と推移タブのスナップショット一覧でも読めるため、直接ラベルは
 * 終端の1つに絞る
 */
function balanceChart(points: BalancePoint[]): SVGElement {
  const { width, height, left, right, top, bottom } = CHART;
  const plotRight = width - right;
  const plotBottom = height - bottom;
  const t0 = points[0].takenAt;
  const tN = points.at(-1)!.takenAt;
  const balances = points.map((p) => p.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const x = (t: number): number =>
    tN === t0 ? left : left + ((t - t0) / (tN - t0)) * (plotRight - left);
  const y = (b: number): number =>
    max === min
      ? (top + plotBottom) / 2
      : plotBottom - ((b - min) / (max - min)) * (plotBottom - top);

  const svg = svgEl(
    "svg",
    { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "残高推移" },
    "balance-chart mt-3 w-full text-sky-600 dark:text-sky-400",
  );

  // 罫線は面から1段ずらしたヘアライン
  for (const gy of [top, (top + plotBottom) / 2, plotBottom]) {
    svg.append(
      svgEl(
        "line",
        {
          x1: String(left),
          y1: String(gy),
          x2: String(plotRight),
          y2: String(gy),
          "stroke-width": "1",
        },
        "chart-grid stroke-slate-200 dark:stroke-slate-700",
      ),
    );
  }

  const coords = points.map((p) => `${x(p.takenAt)},${y(p.balance)}`);
  svg.append(
    svgEl(
      "polygon",
      {
        points: `${left},${plotBottom} ${coords.join(" ")} ${x(tN)},${plotBottom}`,
        fill: "currentColor",
        "fill-opacity": "0.1",
      },
      "chart-area",
    ),
  );
  svg.append(
    svgEl(
      "polyline",
      {
        points: coords.join(" "),
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      },
      "chart-line",
    ),
  );

  // 終端マーカーはカード面の色のリングで線から浮かせる
  const last = points.at(-1)!;
  svg.append(
    svgEl(
      "circle",
      {
        cx: String(x(last.takenAt)),
        cy: String(y(last.balance)),
        r: "4",
        fill: "currentColor",
        "stroke-width": "2",
      },
      "chart-end stroke-white dark:stroke-slate-950",
    ),
  );

  // ラベルは系列色ではなくテキスト用のインクで描く
  const label = (text: string, attrs: Record<string, string>, cls: string): SVGElement => {
    const node = svgEl("text", { "font-size": "11", ...attrs }, cls);
    node.textContent = text;
    return node;
  };
  const ink = "fill-slate-500 dark:fill-slate-400";
  svg.append(
    label(
      formatYen(last.balance),
      { x: String(x(tN) + 8), y: String(y(last.balance) + 4) },
      `chart-end-label ${ink}`,
    ),
    label(shortDate(t0), { x: String(left), y: String(height - 6) }, `chart-x-label ${ink}`),
    label(
      shortDate(tN),
      { x: String(plotRight), y: String(height - 6), "text-anchor": "end" },
      `chart-x-label ${ink}`,
    ),
  );

  // ホバーで各点の日時と残高を読めるようにする(マークより広い当たり判定)
  for (const p of points) {
    const hit = svgEl(
      "circle",
      { cx: String(x(p.takenAt)), cy: String(y(p.balance)), r: "14", fill: "transparent" },
      "chart-hit",
    );
    const title = svgEl("title");
    title.textContent = `${formatDateTime(p.takenAt)} ${formatYen(p.balance)}`;
    hit.append(title);
    svg.append(hit);
  }
  return svg;
}

/**
 * ヘッダーと口座カード用の小さな折れ線(120×36)。値はラベルにせず
 * 形だけ見せる(正確な値は推移タブ・口座カードの数字で読める)
 */
function sparkline(points: BalancePoint[], className: string): SVGElement {
  const W = 120;
  const H = 36;
  const PAD = 5;
  const t0 = points[0].takenAt;
  const tN = points.at(-1)!.takenAt;
  const balances = points.map((p) => p.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const x = (t: number): number => (tN === t0 ? PAD : PAD + ((t - t0) / (tN - t0)) * (W - PAD * 2));
  const y = (b: number): number =>
    max === min ? H / 2 : H - PAD - ((b - min) / (max - min)) * (H - PAD * 2);

  const svg = svgEl(
    "svg",
    { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" },
    `${className} h-9 w-[120px] shrink-0`,
  );
  svg.append(
    svgEl("polyline", {
      points: points.map((p) => `${x(p.takenAt)},${y(p.balance)}`).join(" "),
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    }),
    svgEl("circle", {
      cx: String(x(tN)),
      cy: String(y(points.at(-1)!.balance)),
      r: "3",
      fill: "currentColor",
    }),
  );
  return svg;
}

// 口座色(ドット・スパークライン用)。口座IDのハッシュで安定して割り当てる
const ACCOUNT_COLORS = [
  { dot: "bg-sky-600 dark:bg-sky-400", line: "text-sky-600 dark:text-sky-400" },
  { dot: "bg-amber-600 dark:bg-amber-400", line: "text-amber-600 dark:text-amber-400" },
  { dot: "bg-emerald-600 dark:bg-emerald-400", line: "text-emerald-600 dark:text-emerald-400" },
  { dot: "bg-indigo-600 dark:bg-indigo-400", line: "text-indigo-600 dark:text-indigo-400" },
];

function accountColor(id: string): (typeof ACCOUNT_COLORS)[number] {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

function accountDot(id: string, sizing = "h-2 w-2"): HTMLElement {
  return el("span", `dot ${sizing} shrink-0 rounded-full ${accountColor(id).dot}`);
}

/** フィルタに出す口座一覧。最新スナップショットの並びを基本に、振替にしか現れない口座を補う */
function accountsOf(data: DashboardData): AccountRef[] {
  const accounts: AccountRef[] = [];
  const seen = new Set<string>();
  const latest = latestSnapshot(data.snapshots);
  for (const account of latest?.accounts ?? []) {
    accounts.push({ id: account.id, name: account.name });
    seen.add(account.id);
  }
  for (const t of data.transfers) {
    for (const ref of [t.from, t.to]) {
      if (seen.has(ref.id)) continue;
      accounts.push(ref);
      seen.add(ref.id);
    }
  }
  return accounts;
}

/** "YYYY-MM-DD" をローカル時刻の日付境界(エポックミリ秒)に変換する */
function dayStart(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM" をその月の[開始, 翌月開始)に変換する */
function monthBounds(value: string): [number, number] | null {
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return null;
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
}

function shiftMonth(value: string, delta: number): string {
  const [y, m] = value.split("-").map(Number);
  const shifted = new Date(y, m - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** 記録がこれだけ止まっていたら、銀行サイトの変更に追従できていない可能性を警告する */
const STALE_AFTER_MS = 7 * DAY_MS;

type ViewTab = "log" | "accounts" | "history";
type LogFilter = "all" | "transfer" | "in" | "out";

/**
 * ダッシュボードを描画する。戻り値の再描画関数は選択中のタブや期間などの
 * UI状態を保ったまま、dataの現在の内容を描き直す(自動更新用)
 */
export function renderDashboard(
  root: HTMLElement,
  data: DashboardData,
  handlers: DashboardHandlers,
  now: () => number = Date.now,
): () => void {
  let view: "dashboard" | "settings" = "dashboard";
  let activeTab: ViewTab = "log";
  let logFilter: LogFilter = "all";
  let filterAccountId: string | null = null;
  let detailOpen = false;
  let periodFrom: number | null = null;
  let periodToExclusive: number | null = null;
  let periodFromValue = "";
  let periodToValue = "";
  let monthValue = "";
  let syncStatus = "";
  let importStatus = "";

  const inPeriod = (ms: number): boolean => {
    if (periodFrom !== null && ms < periodFrom) return false;
    if (periodToExclusive !== null && ms >= periodToExclusive) return false;
    return true;
  };

  /** 月選択と日付指定は排他。残っている方の入力から境界を計算し直す */
  const applyBounds = (): void => {
    const bounds = monthValue === "" ? null : monthBounds(monthValue);
    if (bounds !== null) {
      [periodFrom, periodToExclusive] = bounds;
      return;
    }
    periodFrom = periodFromValue === "" ? null : dayStart(periodFromValue);
    const toStart = periodToValue === "" ? null : dayStart(periodToValue);
    periodToExclusive = toStart === null ? null : toStart + DAY_MS;
  };

  const selectMonth = (value: string): void => {
    monthValue = value;
    periodFromValue = periodToValue = "";
    applyBounds();
    draw();
  };

  /** ◀ 月 ▶ のナビ。詳細指定を開くと日付範囲の入力に切り替えられる */
  const monthNav = (): HTMLElement => {
    const node = el("div", "period flex flex-wrap items-center gap-x-1 gap-y-2 pt-3 pb-2");

    const roundButton =
      "shrink-0 cursor-pointer rounded-full bg-white text-[13px] text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 max-sm:h-11 max-sm:w-11 sm:h-9 sm:w-9 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800";
    const prev = el("button", `month-prev ${roundButton}`, "◀");
    prev.title = "前の月";
    prev.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, -1));
    });

    const monthInput = document.createElement("input");
    monthInput.className =
      "month-input flex-1 cursor-pointer border-none bg-transparent text-center text-[15px] font-semibold tabular-nums focus:outline-2 focus:outline-sky-500 sm:max-w-44 sm:flex-none";
    monthInput.type = "month";
    monthInput.name = "period-month";
    monthInput.value = monthValue;
    monthInput.title = "表示月(空欄は全期間)";
    monthInput.addEventListener("change", () => selectMonth(monthInput.value));

    const next = el("button", `month-next ${roundButton}`, "▶");
    next.title = "次の月";
    next.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, 1));
    });

    const toggle = el("button", `period-detail-toggle ${LINK_BUTTON} ml-1 text-[13px]`, "詳細指定");
    toggle.setAttribute("aria-expanded", String(detailOpen));
    toggle.addEventListener("click", () => {
      detailOpen = !detailOpen;
      draw();
    });

    node.append(prev, monthInput, next, toggle);

    const detail = el(
      "div",
      `period-detail w-full flex-wrap items-center gap-2 ${detailOpen ? "flex" : "hidden"}`,
    );

    const dateInput = `${INPUT} py-1`;
    const fromInput = document.createElement("input");
    fromInput.className = dateInput;
    fromInput.type = "date";
    fromInput.name = "period-from";
    fromInput.value = periodFromValue;
    fromInput.addEventListener("change", () => {
      monthValue = "";
      periodFromValue = fromInput.value;
      applyBounds();
      draw();
    });

    const toInput = document.createElement("input");
    toInput.className = dateInput;
    toInput.type = "date";
    toInput.name = "period-to";
    toInput.value = periodToValue;
    toInput.addEventListener("change", () => {
      monthValue = "";
      periodToValue = toInput.value;
      applyBounds();
      draw();
    });

    const clear = el("button", `period-clear ${LINK_BUTTON} text-sm`, "クリア");
    clear.addEventListener("click", () => selectMonth(""));

    detail.append(
      el("span", `period-label ${FINE_PRINT}`, "期間:"),
      fromInput,
      el("span", "period-separator", "〜"),
      toInput,
      clear,
    );
    node.append(detail);
    return node;
  };

  const SUGGESTIONS_ID = "comment-suggestions";

  const suggestionList = (): HTMLElement => {
    const list = el("datalist");
    list.id = SUGGESTIONS_ID;
    for (const text of commentSuggestions(data.comments)) {
      const option = document.createElement("option");
      option.value = text;
      list.append(option);
    }
    return list;
  };

  const commentInput = (key: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.className =
      "comment w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-sm ring-1 ring-transparent transition-shadow " +
      "hover:ring-slate-300 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:outline-none " +
      "dark:hover:ring-slate-600 dark:focus:bg-slate-800";
    input.placeholder = "コメント";
    input.setAttribute("list", SUGGESTIONS_ID);
    input.value = commentText(data.comments, key);
    input.addEventListener("change", () => handlers.onCommentChange(key, input.value));
    return input;
  };

  /** ヘッダー右上の鮮度表示。記録が止まっていたら同期表示の位置に警告を出す */
  const freshness = (latest: number): HTMLElement => {
    const node = el("span", "freshness text-right text-[11px] text-slate-500 dark:text-slate-400");
    if (now() - latest > STALE_AFTER_MS) {
      const warning = el(
        "span",
        "stale-warning font-medium text-amber-700 dark:text-amber-400",
        "⚠ 7日以上記録が増えていません",
      );
      warning.title =
        "銀行サイトを見ても記録されない場合、サイトの変更に拡張が追従できていない可能性があります";
      node.append(warning);
      return node;
    }
    node.append(
      el("span", "latest-record max-sm:hidden", `最終記録 ${formatShortDateTime(latest)}`),
    );
    if (data.syncConfig !== null) {
      node.append(el("span", "freshness-separator max-sm:hidden", " · "));
      node.append(
        el(
          "span",
          "last-synced",
          data.lastSyncedAt === null
            ? "まだ同期していません"
            : `同期済 ${formatShortDateTime(data.lastSyncedAt)}`,
        ),
      );
    }
    return node;
  };

  const settingsButton = (): HTMLElement => {
    const button = el(
      "button",
      "settings-button flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-50 text-base ring-1 ring-slate-200 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 max-sm:h-11 max-sm:w-11 sm:h-10 sm:w-10 dark:bg-slate-900 dark:ring-slate-700 dark:hover:bg-slate-800",
      "⚙",
    );
    button.title = "設定";
    button.setAttribute("aria-label", "設定");
    button.addEventListener("click", () => {
      view = "settings";
      draw();
    });
    return button;
  };

  /** 期間の増減ラベル。「7月 +272,520円」のように月名または期間の種類を添える */
  const periodLabel = (): string => {
    if (monthValue !== "") {
      const [, m] = monthValue.split("-").map(Number);
      return `${m}月`;
    }
    if (periodFrom !== null || periodToExclusive !== null) return "期間内";
    return "全期間";
  };

  const TABS: { key: ViewTab; label: string }[] = [
    { key: "log", label: "ログ" },
    { key: "accounts", label: "口座別" },
    { key: "history", label: "推移" },
  ];

  const viewTabs = (): HTMLElement => {
    const tabs = el("div", "view-tabs flex gap-4 sm:gap-5");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "表示切り替え");
    const tabBase =
      "view-tab min-h-11 cursor-pointer border-b-2 bg-transparent px-0.5 pt-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
    for (const def of TABS) {
      const selected = def.key === activeTab;
      const tab = el(
        "button",
        selected
          ? `${tabBase} active border-sky-600 font-semibold text-slate-900 dark:border-sky-400 dark:text-slate-100`
          : `${tabBase} border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200`,
        def.label,
      );
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(selected));
      tab.addEventListener("click", () => {
        activeTab = def.key;
        draw();
      });
      tabs.append(tab);
    }
    return tabs;
  };

  /** ヘッダー: タイトル・鮮度・合計残高とスパークライン・タブ */
  const header = (): HTMLElement => {
    const node = el(
      "header",
      "dashboard-header border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
    );
    const inner = el("div", "mx-auto max-w-[760px] px-4 pt-3 sm:px-6 sm:pt-4");
    node.append(inner);

    const latest = latestRecordAt(data.snapshots, data.transfers);

    const row = el("div", "flex items-center justify-between gap-3");
    row.append(el("h1", "text-[15px] font-bold sm:text-base", "つかいわけ口座"));
    const side = el("div", "flex items-center gap-2 sm:gap-3");
    if (latest !== null) side.append(freshness(latest));
    side.append(settingsButton());
    row.append(side);
    inner.append(row);

    if (latest === null) {
      inner.append(el("div", "pb-3"));
      return node;
    }

    const visible = data.snapshots.filter((s) => inPeriod(s.takenAt));
    const totals = totalBalancePoints(visible);
    const summary = el("div", "total-summary pt-1 pb-3");

    const label = el("div", FINE_PRINT);
    label.append(`合計残高 · ${periodLabel()} `);
    const delta = totals.length === 0 ? 0 : totals.at(-1)!.balance - totals[0].balance;
    const deltaCell = signedCell(delta);
    deltaCell.classList.add("total-delta", "font-semibold", "tabular-nums");
    label.append(deltaCell);
    summary.append(label);

    // 大きい数字は期間内最新の合計。期間を絞っていなければ現在の合計と一致する
    const total = totals.at(-1) ?? totalBalancePoints(data.snapshots).at(-1);
    if (total !== undefined) {
      const balanceRow = el("div", "flex items-end justify-between gap-3");
      const big = el(
        "div",
        "total-balance text-3xl font-bold tracking-tight tabular-nums sm:text-[34px]",
        total.balance.toLocaleString("ja-JP"),
      );
      big.append(el("span", "text-[15px] font-medium sm:text-[17px]", "円"));
      balanceRow.append(big);
      if (totals.length >= 2) {
        balanceRow.append(sparkline(totals, "total-sparkline text-sky-600 dark:text-sky-400"));
      }
      summary.append(balanceRow);
    }
    inner.append(summary, viewTabs());
    return node;
  };

  // ---- ログタブ ----

  const FILTERS: { key: LogFilter; label: string }[] = [
    { key: "all", label: "すべて" },
    { key: "transfer", label: "振替" },
    { key: "in", label: "入金" },
    { key: "out", label: "出金" },
  ];

  const chipBase =
    "min-h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
  const chipOn = "bg-slate-900 font-semibold text-white dark:bg-sky-400 dark:text-slate-950";
  const chipOff =
    "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800";

  const filterChips = (): HTMLElement => {
    const row = el("div", "log-filters flex gap-1.5 overflow-x-auto pb-2");
    for (const def of FILTERS) {
      const active = logFilter === def.key;
      const chip = el(
        "button",
        `filter-${def.key} ${chipBase} ${active ? `active ${chipOn}` : chipOff}`,
        def.label,
      );
      chip.setAttribute("aria-pressed", String(active));
      chip.addEventListener("click", () => {
        logFilter = def.key;
        draw();
      });
      row.append(chip);
    }

    // 口座での絞り込み。チップ列の見た目に合わせたセレクト
    const select = document.createElement("select");
    select.className = `account-filter ${chipBase} appearance-none ${
      filterAccountId === null ? chipOff : `active ${chipOn}`
    }`;
    select.name = "account-filter";
    select.setAttribute("aria-label", "口座で絞り込み");
    select.append(new Option("口座 ▾", ""));
    for (const account of accountsOf(data)) {
      select.append(new Option(account.name, account.id));
    }
    select.value = filterAccountId ?? "";
    select.addEventListener("change", () => {
      filterAccountId = select.value === "" ? null : select.value;
      draw();
    });
    row.append(select);
    return row;
  };

  const matchesLog = (e: LogEntry): boolean => {
    if (!inPeriod(e.at)) return false;
    switch (e.kind) {
      case "transfer":
        if (logFilter === "in" || logFilter === "out") return false;
        return (
          filterAccountId === null ||
          e.transfer.from.id === filterAccountId ||
          e.transfer.to.id === filterAccountId
        );
      case "external":
        if (logFilter === "transfer") return false;
        if (logFilter === "in" && e.change.externalDelta < 0) return false;
        if (logFilter === "out" && e.change.externalDelta > 0) return false;
        return filterAccountId === null || e.change.accountId === filterAccountId;
      case "snapshot":
        // 記録行は従属情報。何かで絞り込んでいる間はノイズになるため出さない
        return logFilter === "all" && filterAccountId === null;
    }
  };

  // 左端のアクセントバー。種類が色以外でも読めるよう、本文の矢印表記が向きを担う
  const ACCENT = {
    transfer: "bg-sky-600 dark:bg-sky-400",
    in: "bg-emerald-600 dark:bg-emerald-400",
    out: "bg-rose-700 dark:bg-rose-400",
  };

  const strongName = (name: string): HTMLElement => el("strong", "font-semibold", name);

  const logTitle = (e: Extract<LogEntry, { kind: "transfer" | "external" }>): HTMLElement => {
    const title = el("div", "log-title text-[15px] leading-snug");
    if (e.kind === "transfer") {
      title.append(strongName(e.transfer.from.name), " → ", strongName(e.transfer.to.name));
    } else if (e.change.externalDelta > 0) {
      title.append("外部 → ", strongName(e.change.accountName));
    } else {
      title.append(strongName(e.change.accountName), " → 外部");
    }
    return title;
  };

  /** 誤記録(確認後のキャンセルなど)を取り除くための削除ボタン(デスクトップはホバーで表示) */
  const deleteButton = (t: TransferRecord): HTMLElement => {
    const button = el(
      "button",
      "delete-transfer cursor-pointer rounded px-1.5 text-slate-400 opacity-0 transition-opacity " +
        "group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-700 " +
        "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 " +
        "max-sm:hidden dark:hover:bg-rose-950 dark:hover:text-rose-400",
      "×",
    );
    const detail = `${formatDateTime(t.transferredAt)} ${t.from.name} → ${t.to.name} ${formatYen(t.amount)}`;
    button.title = "この振替を削除";
    button.setAttribute("aria-label", `振替を削除: ${detail}`);
    button.addEventListener("click", () => {
      if (!window.confirm(`この振替の記録を削除しますか?\n${detail}`)) return;
      handlers.onDeleteTransfer(t);
      draw();
    });
    return button;
  };

  // モバイルのスワイプ削除で見せるパネルの幅
  const SWIPE_PANEL_PX = 72;

  /**
   * モバイルの左スワイプ削除。行の中身を滑らせて右端の削除パネルを見せる。
   * settle()はタップがスワイプの後始末(閉じる等)で消費されたかを返す
   */
  const attachSwipeDelete = (
    row: HTMLElement,
    slider: HTMLElement,
    t: TransferRecord,
  ): { settle(): boolean } => {
    const detail = `${formatDateTime(t.transferredAt)} ${t.from.name} → ${t.to.name} ${formatYen(t.amount)}`;
    const panel = el(
      "button",
      "swipe-delete absolute inset-y-0 right-0 w-[72px] cursor-pointer bg-rose-700 text-[13px] font-semibold text-white sm:hidden dark:bg-rose-400 dark:text-slate-950",
      "削除",
    );
    panel.setAttribute("aria-label", `振替を削除: ${detail}`);
    panel.addEventListener("click", () => {
      if (!window.confirm(`この振替の記録を削除しますか?\n${detail}`)) return;
      handlers.onDeleteTransfer(t);
      draw();
    });
    row.prepend(panel);

    let open = false;
    let swiped = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let lastDx = 0;
    const setOffset = (px: number): void => {
      slider.style.transform = `translateX(${px}px)`;
    };

    row.addEventListener(
      "touchstart",
      (event) => {
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        dragging = false;
      },
      { passive: true },
    );
    row.addEventListener(
      "touchmove",
      (event) => {
        const moveX = event.touches[0].clientX - startX;
        const moveY = event.touches[0].clientY - startY;
        // 縦方向の動きが主ならページのスクロールを優先する
        if (!dragging && Math.abs(moveY) > Math.abs(moveX)) return;
        dragging = true;
        lastDx = moveX + (open ? -SWIPE_PANEL_PX : 0);
        setOffset(Math.max(-SWIPE_PANEL_PX, Math.min(0, lastDx)));
      },
      { passive: true },
    );
    row.addEventListener("touchend", () => {
      if (!dragging) return;
      swiped = true;
      open = lastDx < -SWIPE_PANEL_PX / 2;
      setOffset(open ? -SWIPE_PANEL_PX : 0);
    });

    return {
      settle: () => {
        if (open) {
          open = false;
          swiped = false;
          setOffset(0);
          return true;
        }
        if (swiped) {
          swiped = false;
          return true;
        }
        return false;
      },
    };
  };

  /** 振替・外部入出金の1行。モバイルは行タップでコメント入力を展開する */
  const transactionRow = (e: Extract<LogEntry, { kind: "transfer" | "external" }>): HTMLElement => {
    const key = e.kind === "transfer" ? transferCommentKey(e.transfer) : changeCommentKey(e.change);
    const accent =
      e.kind === "transfer" ? ACCENT.transfer : e.change.externalDelta > 0 ? ACCENT.in : ACCENT.out;

    const row = el("div", "log-row group relative overflow-hidden");
    // スワイプ削除のパネルを覆えるよう、行の中身はカードと同じ面に載せて滑らせる
    const slider = el(
      "div",
      "swipe-slider relative flex items-stretch bg-white transition-transform duration-150 dark:bg-slate-950",
    );
    slider.append(el("span", `accent w-1 shrink-0 ${accent}`));

    const col = el("div", "min-w-0 flex-1");
    const main = el(
      "div",
      "flex min-h-14 items-center gap-3 py-2 pr-3 pl-3.5 sm:min-h-[52px] sm:pl-3",
    );

    // デスクトップは時刻を左の列に出す(モバイルはサブ行)
    main.append(
      el(
        "span",
        "time w-[38px] shrink-0 text-xs tabular-nums text-slate-400 max-sm:hidden",
        formatTime(e.at),
      ),
    );

    const body = el("div", "min-w-0 flex-1");
    body.append(logTitle(e));
    const comment = commentText(data.comments, key);
    body.append(
      el(
        "div",
        "subline truncate text-xs text-slate-500 sm:hidden dark:text-slate-400",
        comment === "" ? formatTime(e.at) : `${formatTime(e.at)} · ${comment}`,
      ),
    );
    main.append(body);

    // デスクトップは常時インラインで編集できる
    const inline = commentInput(key);
    inline.classList.add("max-sm:hidden", "sm:w-[220px]", "shrink-0");
    main.append(inline);

    const amount =
      e.kind === "transfer"
        ? el("span", "amount text-base font-bold tabular-nums", formatYen(e.transfer.amount))
        : el(
            "span",
            `amount text-base font-bold tabular-nums ${e.change.externalDelta > 0 ? POSITIVE : NEGATIVE}`,
            formatSigned(e.change.externalDelta),
          );
    main.append(amount);

    if (e.kind === "transfer") main.append(deleteButton(e.transfer));
    col.append(main);

    // モバイル: 行タップでコメント入力を展開。空で確定すると削除になる(onCommentChange側の仕様)
    const editor = el("div", "comment-editor hidden pr-3 pb-2.5 pl-3.5 sm:hidden");
    const mobileInput = commentInput(key);
    mobileInput.classList.add(
      "min-h-10",
      "bg-white",
      "ring-slate-300",
      "dark:bg-slate-800",
      "dark:ring-slate-600",
    );
    editor.append(mobileInput);
    col.append(editor);
    slider.append(col);
    row.append(slider);

    const swipe = e.kind === "transfer" ? attachSwipeDelete(row, slider, e.transfer) : null;

    row.addEventListener("click", (event) => {
      // スワイプで開いた行のタップは閉じる操作。編集の展開と混ざらないようにする
      if (swipe?.settle() === true) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input,button,a,select") !== null) return;
      editor.classList.toggle("hidden");
      if (!editor.classList.contains("hidden")) mobileInput.focus();
    });

    return row;
  };

  /** 残高記録の従属行。取引ではないので背景をわずかに沈めて区別する */
  const snapshotRow = (e: Extract<LogEntry, { kind: "snapshot" }>): HTMLElement => {
    const row = el(
      "div",
      "snapshot-row flex items-center gap-2.5 bg-[#fcfdfe] py-2 pr-3.5 pl-[18px] dark:bg-transparent",
    );
    row.append(
      el(
        "span",
        "badge rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400",
        "記録",
      ),
    );
    const text = el("span", FINE_PRINT);
    text.append(`${formatTime(e.at)} · 残高スナップショット · 合計 `);
    text.append(
      el(
        "strong",
        "font-semibold text-slate-700 tabular-nums dark:text-slate-300",
        formatYen(e.total),
      ),
    );
    row.append(text);
    return row;
  };

  const logSection = (): HTMLElement => {
    const node = el("section", "log");
    node.append(filterChips());

    const entries = logEntries(data.snapshots, data.transfers).filter(matchesLog);
    if (entries.length === 0) {
      node.append(el("p", `empty mt-2 ${MUTED}`, "まだ記録がありません"));
      return node;
    }

    // 日計は外部入出金の合計のみ(振替は口座間移動なので合計に含めない)
    const dayTotals = new Map<string, number>();
    for (const e of entries) {
      if (e.kind !== "external") continue;
      const key = localDayKey(e.at);
      dayTotals.set(key, (dayTotals.get(key) ?? 0) + e.change.externalDelta);
    }

    let currentDay = "";
    let card: HTMLElement | null = null;
    for (const e of entries) {
      const day = localDayKey(e.at);
      if (day !== currentDay) {
        currentDay = day;
        const heading = el(
          "div",
          "day-heading flex items-baseline justify-between px-0.5 pt-1.5 pb-1",
        );
        heading.append(
          el(
            "span",
            "text-xs font-bold text-slate-500 dark:text-slate-400",
            formatDayHeading(e.at),
          ),
        );
        const total = dayTotals.get(day);
        if (total !== undefined) {
          const cell = signedCell(total);
          cell.classList.add("day-total", "text-xs", "font-semibold", "tabular-nums");
          heading.append(cell);
        }
        card = el(
          "div",
          `day-card mb-2 divide-y divide-slate-100 overflow-hidden ${CARD} dark:divide-slate-800`,
        );
        node.append(heading, card);
      }
      card!.append(e.kind === "snapshot" ? snapshotRow(e) : transactionRow(e));
    }
    return node;
  };

  // ---- 口座別タブ ----

  const workspaceKpi = (cls: string, label: string, amount: number): HTMLElement => {
    const box = el("div", `kpi ${cls}`);
    box.append(el("div", "text-[11px] text-slate-500 dark:text-slate-400", label));
    const value = el("div", "text-sm font-semibold tabular-nums");
    value.append(signedCell(amount));
    box.append(value);
    return box;
  };

  const workspaceCard = (summary: WorkspaceSummary): HTMLElement => {
    const card = el("div", `workspace-card p-3.5 ${CARD}`);

    const head = el("div", "mb-1 flex items-center gap-2");
    head.append(accountDot(summary.id));
    head.append(el("h3", "workspace-name text-sm font-semibold", summary.name));
    card.append(head);

    const mid = el("div", "flex items-end justify-between gap-3");
    const balance = el("div", "kpi kpi-balance");
    balance.append(el("div", "text-[22px] font-bold tabular-nums", formatYen(summary.balance)));
    const delta = el("div", `kpi-delta ${FINE_PRINT}`);
    delta.append("期間内 ", signedCell(summary.delta));
    balance.append(delta);
    mid.append(balance);
    if (summary.points.length >= 2) {
      mid.append(sparkline(summary.points, `workspace-sparkline ${accountColor(summary.id).line}`));
    }
    card.append(mid);

    const kpis = el(
      "div",
      "kpis mt-2.5 flex gap-5 border-t border-slate-100 pt-2.5 dark:border-slate-800",
    );
    kpis.append(
      workspaceKpi("kpi-transfer", "振替", summary.transferNet),
      workspaceKpi("kpi-external", "外部入出金", summary.externalNet),
    );
    card.append(kpis);
    return card;
  };

  const accountsSection = (): HTMLElement => {
    const node = el("section", "accounts pt-1");
    const summaries = workspaceSummaries(data.snapshots, data.transfers, inPeriod);
    if (summaries.length === 0) {
      node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
      return node;
    }
    const grid = el("div", "workspace-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2");
    for (const summary of summaries) grid.append(workspaceCard(summary));
    node.append(grid);
    return node;
  };

  // ---- 推移タブ ----

  const snapshotItem = (
    snapshot: BalanceSnapshot,
    total: number,
    prevTotal: number | null,
  ): HTMLElement => {
    const item = document.createElement("details");
    item.className = "snapshot-item";

    const summary = el(
      "summary",
      "snapshot-summary flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900",
    );
    const left = el("div");
    left.append(
      el("div", "text-sm font-semibold tabular-nums", formatShortDateTime(snapshot.takenAt)),
    );
    left.append(el("div", FINE_PRINT, "残高スナップショット"));
    const right = el("div", "text-right");
    right.append(el("div", "snapshot-total text-[15px] font-bold tabular-nums", formatYen(total)));
    if (prevTotal !== null) {
      const diff = el("div", `snapshot-diff tabular-nums ${FINE_PRINT}`);
      diff.append(signedCell(total - prevTotal));
      right.append(diff);
    }
    summary.append(left, right);
    item.append(summary);

    // 行タップで口座ごとの内訳を開く
    const breakdown = el(
      "div",
      "snapshot-detail border-t border-slate-100 px-3.5 py-2 dark:border-slate-800",
    );
    for (const account of snapshot.accounts) {
      const line = el("div", "flex items-center justify-between gap-3 py-1 text-sm");
      const name = el("span", "flex items-center gap-2");
      name.append(accountDot(account.id, "h-1.5 w-1.5"), account.name);
      line.append(name, el("span", "tabular-nums", formatYen(account.balance)));
      breakdown.append(line);
    }
    item.append(breakdown);
    return item;
  };

  const historySection = (): HTMLElement => {
    const node = el("section", "history flex flex-col gap-2.5 pt-1");
    const visible = data.snapshots.filter((s) => inPeriod(s.takenAt));
    if (visible.length === 0) {
      node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
      return node;
    }

    const totals = totalBalancePoints(visible);
    if (totals.length >= 2) {
      const chartBox = el("div", `total-chart p-3.5 ${CARD}`);
      chartBox.append(
        el(
          "div",
          `chart-label text-xs font-semibold text-slate-500 dark:text-slate-400`,
          "合計残高の推移",
        ),
      );
      chartBox.append(balanceChart(totals));
      node.append(chartBox);
    }

    const list = el(
      "div",
      `snapshot-list divide-y divide-slate-100 overflow-hidden ${CARD} dark:divide-slate-800`,
    );
    visible.forEach((snapshot, i) => {
      const total = totals[i].balance;
      const prevTotal = i > 0 ? totals[i - 1].balance : null;
      list.prepend(snapshotItem(snapshot, total, prevTotal));
    });
    node.append(list);
    return node;
  };

  // ---- 設定画面 ----

  const syncField = (
    label: string,
    name: string,
    value: string,
    type = "text",
  ): [HTMLElement, HTMLInputElement] => {
    const row = el(
      "label",
      "sync-field flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300",
    );
    row.append(el("span", undefined, label));
    const input = document.createElement("input");
    input.className = `${INPUT} text-slate-900 dark:text-slate-100`;
    input.type = type;
    input.name = name;
    input.value = value;
    row.append(input);
    return [row, input];
  };

  const syncSection = (): HTMLElement => {
    const node = section("sync", "同期 (Cloudflare R2)");
    const config = data.syncConfig;

    const [accountRow, accountInput] = syncField(
      "アカウントID",
      "sync-account-id",
      config?.accountId ?? "",
    );
    const [bucketRow, bucketInput] = syncField("バケット", "sync-bucket", config?.bucket ?? "");
    const [keyRow, keyInput] = syncField(
      "オブジェクトキー",
      "sync-object-key",
      config?.objectKey ?? DEFAULT_OBJECT_KEY,
    );
    const [akRow, akInput] = syncField(
      "アクセスキーID",
      "sync-access-key-id",
      config?.accessKeyId ?? "",
    );
    const [skRow, skInput] = syncField(
      "シークレットアクセスキー",
      "sync-secret",
      config?.secretAccessKey ?? "",
      "password",
    );

    const form = el(
      "div",
      "sync-form mb-3 grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2",
    );
    form.append(accountRow, bucketRow, keyRow, akRow, skRow);
    node.append(form);

    const showStatus = (message: string): void => {
      syncStatus = message;
      draw();
    };

    const save = el("button", `save-config ${BTN_SECONDARY} px-4 py-1.5`, "設定を保存");
    save.addEventListener("click", () => {
      void handlers
        .onSaveSyncConfig({
          accountId: accountInput.value.trim(),
          bucket: bucketInput.value.trim(),
          objectKey: keyInput.value.trim() === "" ? DEFAULT_OBJECT_KEY : keyInput.value.trim(),
          accessKeyId: akInput.value.trim(),
          secretAccessKey: skInput.value.trim(),
        })
        .then(showStatus);
    });

    const syncNow = el("button", `sync-now ${BTN_PRIMARY}`, "今すぐ同期");
    syncNow.addEventListener("click", () => {
      syncStatus = "同期中…";
      draw();
      void handlers.onSyncNow().then(showStatus);
    });

    const buttons = el("div", "sync-buttons flex gap-2.5");
    buttons.append(save, syncNow);
    node.append(buttons);

    if (config !== null) {
      const exportLink = document.createElement("a");
      exportLink.className = `export-config mt-3 inline-block text-sm ${LINK}`;
      exportLink.download = "aozora-history-sync-config.json";
      exportLink.textContent = "同期設定をエクスポート";
      exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(config))}`;
      node.append(exportLink);
    }

    const importConfigRow = el(
      "label",
      "import-config-row mt-3 flex flex-wrap items-center gap-2.5 text-sm",
    );
    importConfigRow.append(el("span", undefined, "設定JSONをインポート:"));
    const importConfigInput = document.createElement("input");
    importConfigInput.type = "file";
    importConfigInput.name = "import-config-file";
    importConfigInput.accept = ".json,application/json";
    importConfigInput.addEventListener("change", () => {
      const file = importConfigInput.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => {
        try {
          return handlers.onSaveSyncConfig(parseSyncConfigJson(text)).then(showStatus);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          showStatus(`読み込みに失敗しました: ${message}`);
        }
      });
    });
    importConfigRow.append(importConfigInput);
    node.append(importConfigRow);
    node.append(
      el(
        "p",
        `note ${FINE_PRINT}`,
        "エクスポートした設定ファイルにはシークレットアクセスキーが平文で含まれる。他端末に取り込んだら削除すること。",
      ),
    );

    node.append(el("p", `sync-status min-h-[1.2em] ${MUTED}`, syncStatus));
    return node;
  };

  const importExportSection = (): HTMLElement => {
    const node = section("import-export", "インポート / エクスポート");

    const exportLink = document.createElement("a");
    exportLink.className = `export mb-3 inline-block text-sm ${LINK}`;
    exportLink.download = "aozora-history.json";
    exportLink.textContent = "JSONをエクスポート";
    const ledger = {
      snapshots: data.snapshots,
      transfers: data.transfers,
      comments: data.comments,
      deletions: data.deletions,
    };
    exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(ledger))}`;

    const csvLink = document.createElement("a");
    csvLink.className = `export-csv mb-3 inline-block text-sm ${LINK}`;
    csvLink.download = "aozora-history.csv";
    csvLink.textContent = "振替履歴をCSVでエクスポート";
    csvLink.href = `data:text/csv;charset=utf-8,${encodeURIComponent(transfersCsv(data.transfers, data.comments))}`;

    const exportRow = el("div", "export-row flex flex-wrap gap-x-6");
    exportRow.append(exportLink, csvLink);
    node.append(exportRow);

    const importRow = el("label", "import-row flex flex-wrap items-center gap-2.5 text-sm");
    importRow.append(el("span", undefined, "JSONをインポート(現在の記録とマージ):"));
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.name = "import-file";
    fileInput.accept = ".json,application/json";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file === undefined) return;
      importStatus = "読み込み中…";
      draw();
      void file
        .text()
        .then((text) => handlers.onImportFile(text))
        .then((message) => {
          importStatus = message;
          draw();
        });
    });
    importRow.append(fileInput);
    node.append(importRow);

    node.append(
      el(
        "p",
        `note ${FINE_PRINT}`,
        "R2上のオブジェクトやエクスポートしたファイルと同じ形式のJSONを読み込めます。",
      ),
    );
    node.append(el("p", `import-status min-h-[1.2em] ${MUTED}`, importStatus));
    return node;
  };

  const settingsView = (): HTMLElement => {
    const node = el("div", "settings-view mx-auto max-w-[760px] px-4 py-4 sm:px-6");
    const back = el("button", `back-button ${LINK_BUTTON}`, "← ダッシュボードに戻る");
    back.addEventListener("click", () => {
      view = "dashboard";
      draw();
    });
    node.append(back, syncSection(), importExportSection());
    return node;
  };

  /**
   * 再描画でフォーカスが失われないよう、描画前の位置を覚えて復元する関数を返す。
   * 要素は作り直されるため、意味マーカー(クラス名の先頭)とname/aria-label/
   * テキストで同じ役割の要素を探し直す
   */
  const captureFocus = (): (() => void) | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
    const marker = active.classList[0];
    if (marker === undefined || !/^[a-z][\w-]*$/i.test(marker)) return null;
    const name = active.getAttribute("name");
    const label = active.getAttribute("aria-label");
    const text = active.textContent;
    return () => {
      const candidates = [...root.querySelectorAll<HTMLElement>(`.${marker}`)];
      const target =
        candidates.find((c) => name !== null && c.getAttribute("name") === name) ??
        candidates.find((c) => label !== null && c.getAttribute("aria-label") === label) ??
        candidates.find((c) => c.textContent === text) ??
        candidates[0];
      target?.focus();
    };
  };

  const draw = (): void => {
    const restoreFocus = captureFocus();
    drawView();
    restoreFocus?.();
  };

  const drawView = (): void => {
    root.replaceChildren();

    if (view === "settings") {
      root.append(settingsView());
      return;
    }

    root.append(suggestionList(), header());

    const main = el("main", "mx-auto max-w-[760px] px-4 pb-8 sm:px-6");
    root.append(main);

    if (latestRecordAt(data.snapshots, data.transfers) === null) {
      main.append(el("p", `empty pt-4 ${MUTED}`, "まだ記録がありません"));
      return;
    }

    main.append(monthNav());
    if (activeTab === "log") main.append(logSection());
    else if (activeTab === "accounts") main.append(accountsSection());
    else main.append(historySection());
  };

  draw();
  return draw;
}
