import { CARD, INK, INK_SOFT, MUTED, el, signedCell } from "./dom.ts";
import type { RenderContext, StatementFilter, UiState } from "./context.ts";
import { dayStart, inPeriod } from "./period.ts";
import { formatDayHeading, formatYen } from "./format.ts";
import { primaryStatements, sortStatementsDesc, statementCommentKey } from "../domain/statement.ts";
import type { StatementEntry } from "../domain/statement.ts";
import { commentInput } from "./comment-input.ts";
import { commentText } from "../domain/ledger.ts";

const FILTERS: { key: StatementFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "in", label: "入金" },
  { key: "out", label: "出金" },
];

const CHIP_BASE =
  "min-h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const CHIP_ON = "bg-slate-900 font-semibold text-white dark:bg-sky-400 dark:text-slate-950";
const CHIP_OFF =
  "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800";

// ログ行と同じ極性色のアクセントバー。符号自体が色以外の手掛かりを担う
const ACCENT = {
  in: "bg-emerald-600 dark:bg-emerald-400",
  out: "bg-rose-700 dark:bg-rose-400",
};

// ログ行と同じ固定幅。桁数でコメント欄の位置がずれないようにする
const AMOUNT = "amount w-[120px] shrink-0 text-right text-base font-bold tabular-nums";

/** 明細の起算日(日付のみ)を期間フィルタと同じエポックミリ秒に直す */
function statementAt(statement: StatementEntry): number {
  return dayStart(statement.valueDate) ?? 0;
}

function filterChip(ctx: RenderContext, def: { key: StatementFilter; label: string }): HTMLElement {
  const active = ctx.state.statementFilter === def.key;
  const chip = el(
    "button",
    `statement-filter-${def.key} ${CHIP_BASE} ${active ? `active ${CHIP_ON}` : CHIP_OFF}`,
    def.label,
  );
  chip.setAttribute("aria-pressed", String(active));
  chip.addEventListener("click", () => {
    ctx.state.statementFilter = def.key;
    ctx.draw();
  });
  return chip;
}

function filterChips(ctx: RenderContext): HTMLElement {
  const row = el("div", "statement-filters flex gap-1.5 overflow-x-auto pb-2");
  for (const def of FILTERS) {
    row.append(filterChip(ctx, def));
  }
  return row;
}

function matchesStatement(state: UiState, statement: StatementEntry): boolean {
  if (!inPeriod(state, statementAt(statement))) {
    return false;
  }
  if (state.statementFilter === "in") {
    return statement.amount > 0;
  }
  if (state.statementFilter === "out") {
    return statement.amount < 0;
  }
  return true;
}

interface MobileEditor {
  editor: HTMLElement;
  input: HTMLInputElement;
}

// モバイル: 行タップでコメント入力を展開。空で確定すると削除になる
function mobileCommentEditor(ctx: RenderContext, key: string): MobileEditor {
  const editor = el("div", "comment-editor hidden pr-3 pb-2.5 pl-3.5 sm:hidden");
  const input = commentInput(ctx, key);
  input.classList.add(
    "min-h-10",
    "bg-white",
    "ring-slate-300",
    "dark:bg-slate-800",
    "dark:ring-slate-600",
  );
  editor.append(input);
  return { editor, input };
}

/** 摘要と、残高(コメントがあれば併記)のサブ行 */
function statementBody(ctx: RenderContext, key: string, statement: StatementEntry): HTMLElement {
  const body = el("div", "min-w-0 flex-1");
  // 摘要は振込元名や「給与」など、銀行がそのまま返す文言
  const remark = el(
    "div",
    "statement-remark truncate text-[15px] leading-snug font-semibold",
    statement.remark === "" ? "(摘要なし)" : statement.remark,
  );
  const comment = commentText(ctx.data.comments, key);
  const balanceText = `残高 ${formatYen(statement.balance)}`;
  const subline = el(
    "div",
    "subline truncate text-xs text-slate-500 dark:text-slate-400",
    comment === "" ? balanceText : `${balanceText} · ${comment}`,
  );
  body.append(remark, subline);
  return body;
}

function statementAmount(statement: StatementEntry): HTMLElement {
  const polarity = statement.amount > 0 ? INK : INK_SOFT;
  const amount = signedCell(statement.amount);
  amount.className = `${AMOUNT} ${polarity}`;
  return amount;
}

function statementMain(ctx: RenderContext, key: string, statement: StatementEntry): HTMLElement {
  const main = el(
    "div",
    "flex min-h-14 items-center gap-3 py-2 pr-3 pl-3.5 sm:min-h-[52px] sm:pl-3",
  );
  // デスクトップは常時インラインで編集できる
  const inline = commentInput(ctx, key);
  inline.classList.add("max-sm:hidden", "sm:w-[220px]", "shrink-0");
  main.append(statementBody(ctx, key, statement), inline, statementAmount(statement));
  return main;
}

function attachRowToggle(row: HTMLElement, parts: MobileEditor): void {
  row.addEventListener("click", (event) => {
    const { target } = event;
    if (target instanceof Element && target.closest("input,button,a,select") !== null) {
      return;
    }
    parts.editor.classList.toggle("hidden");
    if (!parts.editor.classList.contains("hidden")) {
      parts.input.focus();
    }
  });
}

/** 明細1行。振替と違い銀行側の記録なので削除はできない */
function statementRow(ctx: RenderContext, statement: StatementEntry): HTMLElement {
  const key = statementCommentKey(statement);
  const { editor, input } = mobileCommentEditor(ctx, key);
  const col = el("div", "min-w-0 flex-1");
  col.append(statementMain(ctx, key, statement), editor);
  const row = el("div", "statement-row group relative flex items-stretch");
  row.append(
    el("span", `accent w-1 shrink-0 ${statement.amount > 0 ? ACCENT.in : ACCENT.out}`),
    col,
  );
  attachRowToggle(row, { editor, input });
  return row;
}

interface DayGroup {
  valueDate: string;
  total: number;
  entries: StatementEntry[];
}

function groupByDay(entries: StatementEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (current !== undefined && current.valueDate === entry.valueDate) {
      current.entries.push(entry);
      current.total += entry.amount;
    } else {
      groups.push({ valueDate: entry.valueDate, total: entry.amount, entries: [entry] });
    }
  }
  return groups;
}

function dayHeadingEl(group: DayGroup): HTMLElement {
  const heading = el(
    "div",
    "day-heading flex items-baseline justify-between pt-1.5 pr-3 pb-1 pl-0.5",
  );
  const at = dayStart(group.valueDate) ?? 0;
  heading.append(
    el("span", "text-xs font-bold text-slate-500 dark:text-slate-400", formatDayHeading(at)),
  );
  const cell = signedCell(group.total);
  cell.classList.add("day-total", "text-xs", "font-semibold", "tabular-nums");
  heading.append(cell);
  return heading;
}

function dayCard(ctx: RenderContext, entries: StatementEntry[]): HTMLElement {
  const card = el(
    "div",
    `day-card mb-2 divide-y divide-slate-100 overflow-hidden ${CARD} dark:divide-slate-800`,
  );
  for (const entry of entries) {
    card.append(statementRow(ctx, entry));
  }
  return card;
}

function emptyMessage(ctx: RenderContext): string {
  if (primaryStatements(ctx.data.statements).length === 0) {
    return "まだ明細がありません。銀行サイトにログインすると自動で取得します";
  }
  return "この期間の明細はありません";
}

/**
 * 代表口座(普通預金)の入出金明細。振込・給与など外部との入出金を日ごとに並べる。
 * つかいわけ口座の明細は口座ごとのログに出るため、ここでは代表口座の分だけを扱う
 */
export function statementsSection(ctx: RenderContext): HTMLElement {
  const node = el("section", "statements");
  node.append(filterChips(ctx));
  const entries = sortStatementsDesc(primaryStatements(ctx.data.statements)).filter((statement) =>
    matchesStatement(ctx.state, statement),
  );
  if (entries.length === 0) {
    node.append(el("p", `empty mt-2 ${MUTED}`, emptyMessage(ctx)));
    return node;
  }
  for (const group of groupByDay(entries)) {
    node.append(dayHeadingEl(group), dayCard(ctx, group.entries));
  }
  return node;
}
