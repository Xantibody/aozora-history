import type { AccountRef } from "../domain/parser.ts";
import {
  type BalanceChange,
  type BalancePoint,
  type BalanceSnapshot,
  balanceSeries,
  changeCommentKey,
  commentSuggestions,
  commentText,
  detectBalanceChanges,
  destinationTotals,
  flowTotals,
  latestRecordAt,
  latestSnapshot,
  signedAmountFor,
  sortTransfersDesc,
  transferCommentKey,
  type TransferRecord,
  transfersInvolving,
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

type Cell = string | HTMLElement;

/**
 * 画面幅を超える表はラッパー内で横スクロールさせる(モバイル対応)。
 * numericColsの列は右揃えにして桁を比べやすくする
 */
function table(headers: string[], rows: Cell[][], numericCols: number[] = []): HTMLElement {
  const numeric = new Set(numericCols);
  const align = (i: number): string => (numeric.has(i) ? "text-right" : "text-left");
  const tableEl = el("table", "w-full border-collapse");
  const thead = el("thead");
  const headRow = el("tr", "border-b border-slate-200 dark:border-slate-700");
  headRow.append(
    ...headers.map((h, i) =>
      el(
        "th",
        `px-3 py-2 text-xs font-medium whitespace-nowrap text-slate-500 max-sm:px-2 dark:text-slate-400 ${align(i)}`,
        h,
      ),
    ),
  );
  thead.append(headRow);

  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el(
      "tr",
      "border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50",
    );
    row.forEach((cell, i) => {
      const td = el(
        "td",
        `px-3 py-2 tabular-nums whitespace-nowrap max-sm:px-2 max-sm:text-sm ${align(i)}`,
      );
      td.append(cell);
      tr.append(td);
    });
    tbody.append(tr);
  }

  tableEl.append(thead, tbody);
  const scroll = el("div", "table-scroll overflow-x-auto");
  scroll.append(tableEl);
  return scroll;
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
 * <title>と「残高推移」の表でも読めるため、直接ラベルは終端の1つに絞る
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
    "balance-chart mt-3 w-full text-sky-600",
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
      "chart-end stroke-slate-50 dark:stroke-slate-800",
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

function workspaceKpi(cls: string, label: string, value: HTMLElement): HTMLElement {
  const box = el("div", `kpi ${cls}`);
  box.append(el("div", "text-xs font-medium text-slate-500 dark:text-slate-400", label));
  box.append(value);
  return box;
}

function workspaceCard(summary: WorkspaceSummary): HTMLElement {
  const card = el(
    "div",
    "workspace-card rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200 max-sm:p-3 dark:bg-slate-800/60 dark:ring-slate-700",
  );
  card.append(el("h3", "workspace-name mb-2 text-sm font-semibold", summary.name));

  const balance = el("div");
  balance.append(el("div", "text-xl font-semibold max-sm:text-lg", formatYen(summary.balance)));
  const delta = el("div", "kpi-delta mt-0.5 text-xs");
  delta.append(el("span", "text-slate-500 dark:text-slate-400", "期間内 "));
  delta.append(signedCell(summary.delta));
  balance.append(delta);

  const flowValue = (amount: number): HTMLElement => {
    const value = el("div", "text-base font-medium max-sm:text-sm");
    value.append(signedCell(amount));
    return value;
  };

  const kpis = el("div", "kpis flex flex-wrap gap-x-8 gap-y-2");
  kpis.append(
    workspaceKpi("kpi-balance", "残高", balance),
    workspaceKpi("kpi-transfer", "振替", flowValue(summary.transferNet)),
    workspaceKpi("kpi-external", "外部入出金", flowValue(summary.externalNet)),
  );
  card.append(kpis);

  if (summary.points.length >= 2) card.append(balanceChart(summary.points));
  return card;
}

const TILE =
  "rounded-lg px-4 py-3 min-w-36 ring-1 max-sm:min-w-0 max-sm:flex-[1_1_calc(50%-0.25rem)] max-sm:px-3 max-sm:py-2.5";

function balancesSection(snapshot: BalanceSnapshot): HTMLElement {
  const node = section("balances", "現在の残高");
  const list = el("div", "balance-cards flex flex-wrap gap-3 max-sm:gap-2");
  // スタットタイル。単独表示の大きい数字なので等幅数字にしない(桁揃えの必要がない)
  const balanceCard = (name: string, balance: number, tile: string, value: string): HTMLElement => {
    const card = el("div", tile);
    card.append(
      el("div", "account-name text-xs font-medium text-slate-500 dark:text-slate-400", name),
    );
    card.append(
      el(
        "div",
        `account-balance text-xl font-semibold max-sm:text-lg ${value}`,
        formatYen(balance),
      ),
    );
    return card;
  };
  for (const account of snapshot.accounts) {
    list.append(
      balanceCard(
        account.name,
        account.balance,
        `balance-card ${TILE} bg-slate-50 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700`,
        "",
      ),
    );
  }
  const total = snapshot.accounts.reduce((sum, a) => sum + a.balance, 0);
  list.append(
    balanceCard(
      "合計",
      total,
      `balance-card total ${TILE} bg-sky-50 ring-sky-200 dark:bg-sky-950/50 dark:ring-sky-900`,
      "text-sky-700 dark:text-sky-300",
    ),
  );

  node.append(list);
  node.append(
    el(
      "p",
      `updated-at mt-2 ${FINE_PRINT}`,
      `最終更新: ${snapshot.updatedAt ?? formatDateTime(snapshot.takenAt)}`,
    ),
  );
  return node;
}

/** タブに出す口座一覧。最新スナップショットの並びを基本に、振替にしか現れない口座を補う */
function tabAccounts(data: DashboardData): AccountRef[] {
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

/**
 * ダッシュボードを描画する。戻り値の再描画関数は選択中のタブや期間などの
 * UI状態を保ったまま、dataの現在の内容を描き直す(自動更新用)
 */
/** 記録がこれだけ止まっていたら、銀行サイトの変更に追従できていない可能性を警告する */
const STALE_AFTER_MS = 7 * DAY_MS;

export function renderDashboard(
  root: HTMLElement,
  data: DashboardData,
  handlers: DashboardHandlers,
  now: () => number = Date.now,
): () => void {
  let selectedFromId: string | null = null;
  let periodFrom: number | null = null;
  let periodToExclusive: number | null = null;
  let periodFromValue = "";
  let periodToValue = "";
  let monthValue = "";

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

  const periodSection = (): HTMLElement => {
    const node = el("div", "period mt-5 flex flex-wrap items-center gap-x-6 gap-y-2");

    const monthGroup = el("div", "month-nav inline-flex items-center gap-1.5");
    const monthButton = `${BTN_SECONDARY} px-2.5 py-1`;
    const prev = el("button", `month-prev ${monthButton}`, "◀");
    prev.title = "前の月";
    prev.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, -1));
    });

    const monthInput = document.createElement("input");
    monthInput.className = `${INPUT} py-1`;
    monthInput.type = "month";
    monthInput.name = "period-month";
    monthInput.value = monthValue;
    monthInput.addEventListener("change", () => selectMonth(monthInput.value));

    const next = el("button", `month-next ${monthButton}`, "▶");
    next.title = "次の月";
    next.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, 1));
    });

    monthGroup.append(prev, monthInput, next);
    node.append(el("span", `period-label ${MUTED}`, "表示月:"), monthGroup);

    const detail = el("div", "period-detail inline-flex flex-wrap items-center gap-2");

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
      el("span", `period-label ${FINE_PRINT}`, "詳細指定:"),
      fromInput,
      el("span", "period-separator", "〜"),
      toInput,
      clear,
    );
    node.append(detail);
    return node;
  };

  /** 最終記録・最終同期の時刻。記録が止まっていたら警告も出す */
  const freshnessSection = (latest: number): HTMLElement => {
    const node = el("div", `freshness mt-1 flex flex-wrap gap-x-4 gap-y-1 ${FINE_PRINT}`);
    node.append(el("span", "latest-record", `最終記録: ${formatDateTime(latest)}`));
    if (data.syncConfig !== null) {
      node.append(
        el(
          "span",
          "last-synced",
          data.lastSyncedAt === null
            ? "最終同期: まだ同期していません"
            : `最終同期: ${formatDateTime(data.lastSyncedAt)}`,
        ),
      );
    }
    if (now() - latest > STALE_AFTER_MS) {
      node.append(
        el(
          "span",
          "stale-warning font-medium text-amber-700 dark:text-amber-400",
          "⚠ 7日以上記録が増えていません。銀行サイトを見ても記録されない場合、サイトの変更に拡張が追従できていない可能性があります",
        ),
      );
    }
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

  const commentInput = (key: string): HTMLElement => {
    const input = document.createElement("input");
    input.className =
      "comment w-full min-w-40 rounded-md bg-transparent px-1.5 py-0.5 text-sm ring-1 ring-transparent transition-shadow " +
      "hover:ring-slate-300 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:outline-none " +
      "dark:hover:ring-slate-600 dark:focus:bg-slate-800";
    input.placeholder = "コメント";
    input.setAttribute("list", SUGGESTIONS_ID);
    input.value = commentText(data.comments, key);
    input.addEventListener("change", () => handlers.onCommentChange(key, input.value));
    return input;
  };

  /** 口座(workspace)ごとのKPIと残高推移。期間フィルタに追随する */
  const workspacesSection = (): HTMLElement | null => {
    const summaries = workspaceSummaries(data.snapshots, data.transfers, inPeriod);
    if (summaries.length === 0) return null;
    const node = section("workspaces", "口座別サマリー");
    // minmax(0,1fr)の明示的なカラムにしてSVGの固有幅(viewBox)でカードが広がるのを防ぐ
    const grid = el("div", "workspace-grid grid grid-cols-1 gap-3 lg:grid-cols-2");
    for (const summary of summaries) grid.append(workspaceCard(summary));
    node.append(grid);
    return node;
  };

  const transfersSection = (): HTMLElement => {
    const node = section("transfers", "振替履歴");

    const tabs = el("div", "tabs mb-3 flex flex-wrap gap-1.5");
    const tabDefs: { id: string | null; name: string }[] = [
      { id: null, name: "すべて" },
      ...tabAccounts(data),
    ];
    const tabBase =
      "tab cursor-pointer rounded-full px-3.5 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
    for (const def of tabDefs) {
      const tab = el(
        "button",
        def.id === selectedFromId
          ? `${tabBase} active bg-sky-600 font-medium text-white dark:bg-sky-500 dark:text-slate-950`
          : `${tabBase} bg-white ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:ring-slate-700 dark:hover:bg-slate-700`,
        def.name,
      );
      tab.addEventListener("click", () => {
        selectedFromId = def.id;
        draw();
      });
      tabs.append(tab);
    }
    node.append(tabs);

    const selectedId = selectedFromId;
    const filtered = sortTransfersDesc(transfersInvolving(data.transfers, selectedId)).filter((t) =>
      inPeriod(t.transferredAt),
    );
    if (filtered.length === 0) {
      node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
      return node;
    }

    const summary = el("div", `destination-summary mb-2.5 ${MUTED}`);
    const summaryItem = "summary-item ml-3 inline-block tabular-nums";
    if (selectedId === null) {
      summary.append(el("span", "summary-label", "入金先ごとの合計:"));
      for (const dest of destinationTotals(filtered)) {
        summary.append(el("span", summaryItem, `${dest.name} ${formatYen(dest.total)}`));
      }
    } else {
      const totals = flowTotals(filtered, selectedId);
      summary.append(el("span", "summary-label", "合計:"));
      const flowItem = (label: string, amount: number): HTMLElement => {
        const item = el("span", summaryItem, `${label} `);
        item.append(signedCell(amount));
        return item;
      };
      summary.append(flowItem("出金", -totals.outgoing), flowItem("入金", totals.incoming));
    }
    node.append(summary);

    // 口座を選んでいる間は、その口座から見た入出金を符号付きで表示する
    const amountCell = (t: TransferRecord): Cell =>
      selectedId === null ? formatYen(t.amount) : signedCell(signedAmountFor(t, selectedId));

    /** 誤記録(確認後のキャンセルなど)を取り除くための削除ボタン */
    const deleteButton = (t: TransferRecord): HTMLElement => {
      const button = el(
        "button",
        "delete-transfer cursor-pointer rounded px-1.5 text-slate-400 transition-colors " +
          "hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 " +
          "focus-visible:outline-sky-500 dark:hover:bg-rose-950 dark:hover:text-rose-400",
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

    const rows = filtered.map((t): Cell[] => [
      formatDateTime(t.transferredAt),
      t.from.name,
      t.to.name,
      amountCell(t),
      commentInput(transferCommentKey(t)),
      deleteButton(t),
    ]);
    node.append(table(["日時", "出金口座", "入金口座", "金額", "コメント", ""], rows, [3]));
    return node;
  };

  const externalCell = (change: BalanceChange): Cell => {
    if (change.externalDelta === 0) return "—";
    const kind = change.externalDelta > 0 ? "入金" : "出金";
    const cell = el("span");
    cell.append(signedCell(change.externalDelta), `（${kind}）`);
    return cell;
  };

  const changesSection = (): HTMLElement => {
    const node = section("changes", "残高変動");
    const changes = detectBalanceChanges(data.snapshots, data.transfers)
      .filter((c) => inPeriod(c.toTakenAt))
      .toSorted((a, b) => b.toTakenAt - a.toTakenAt);
    if (changes.length === 0) {
      node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
      return node;
    }
    const rows = changes.map((c): Cell[] => [
      formatDateTime(c.toTakenAt),
      c.accountName,
      signedCell(c.delta),
      c.transferDelta === 0 ? "—" : signedCell(c.transferDelta),
      externalCell(c),
      commentInput(changeCommentKey(c)),
    ]);
    node.append(
      table(["記録日時", "口座", "変動", "うち振替", "外部入出金", "コメント"], rows, [2, 3, 4]),
    );
    return node;
  };

  const snapshotsSection = (): HTMLElement => {
    const node = section("snapshots", "残高推移");
    const visible = data.snapshots.filter((s) => inPeriod(s.takenAt));
    if (visible.length === 0) {
      node.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
      return node;
    }
    const columns = balanceSeries(visible);
    const rows = visible.toReversed().map((snapshot): Cell[] => {
      const byId = new Map(snapshot.accounts.map((a) => [a.id, a.balance]));
      return [
        formatDateTime(snapshot.takenAt),
        ...columns.map((c) => {
          const balance = byId.get(c.id);
          return balance === undefined ? "—" : formatYen(balance);
        }),
      ];
    });
    node.append(
      table(
        ["記録日時", ...columns.map((c) => c.name)],
        rows,
        columns.map((_, i) => i + 1),
      ),
    );
    return node;
  };

  let syncStatus = "";

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

  let view: "dashboard" | "settings" = "dashboard";
  let importStatus = "";

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
    node.append(exportLink);

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
    const node = el("div", "settings-view");
    const back = el("button", `back-button ${LINK_BUTTON}`, "← ダッシュボードに戻る");
    back.addEventListener("click", () => {
      view = "dashboard";
      draw();
    });
    node.append(back, syncSection(), importExportSection());
    return node;
  };

  const settingsButton = (): HTMLElement => {
    const button = el(
      "button",
      "settings-button absolute top-6 right-6 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 max-sm:top-4 max-sm:right-3 dark:bg-slate-800 dark:ring-slate-700 dark:hover:bg-slate-700",
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

  const draw = (): void => {
    root.replaceChildren();

    if (view === "settings") {
      root.append(settingsView());
      return;
    }

    root.append(settingsButton(), suggestionList());

    const latestAt = latestRecordAt(data.snapshots, data.transfers);
    if (latestAt === null) {
      root.append(el("p", `empty ${MUTED}`, "まだ記録がありません"));
      return;
    }
    root.append(freshnessSection(latestAt));

    const latest = latestSnapshot(data.snapshots);
    if (latest !== null) root.append(balancesSection(latest));
    root.append(periodSection());
    const workspaces = workspacesSection();
    if (workspaces !== null) root.append(workspaces);
    root.append(transfersSection());
    root.append(changesSection());
    root.append(snapshotsSection());
  };

  draw();
  return draw;
}
