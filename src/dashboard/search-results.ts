import type { AppliedSearch, RenderContext, SearchTier } from "./context.ts";
import { BADGE, BORDER, INK, INK_SOFT, INK_WEAK, SELECTED, SURFACE, el } from "./dom.ts";
import { NEAR_TIER, SAME_TIER, SCALE_TIER } from "./context.ts";
import { SAME_SCALE, commentCandidates, commentText, relativeGap } from "../domain/comments.ts";
import { allLogEntries, entryMatchesSearch } from "./log-filter.ts";
import {
  appliedSearchLabel,
  highlighted,
  parseAmount,
  searchAmountOf,
  tierBadgeLabel,
  tierChipLabel,
} from "./search.ts";
import { applySearch, probeOf } from "./search-actions.ts";
import { formatShortDate, formatSigned, formatYen } from "./format.ts";
import type { CommentCandidate } from "../domain/comments.ts";
import type { LogEntry } from "../domain/log.ts";
import { commentKeyOf } from "./memo-field.ts";
import { logTitle } from "./log-title.ts";

/** 検索パレットの中身(候補と揺れチップ)。枠と入力は search-palette.ts が持つ */

type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" | "statement" }>;

/** 候補の行数。全部は出さない。目的は一覧ではなく、絞り込む条件を選ぶこと */
const COMMENT_LIMIT = 4;
const RECORD_LIMIT = 5;

/** 候補の選択面。区間チップの地色と同じ */
const CANDIDATE_HOVER = "hover:bg-[#eef2f6] dark:hover:bg-[#1a2330]";

export interface PaletteRefs {
  results: HTMLElement;
  apply: HTMLButtonElement;
  input: HTMLInputElement;
}

function sectionHeading(text: string): HTMLElement {
  return el("div", `px-3 pt-3 pb-1.5 text-[11.5px] font-bold tracking-[.03em] ${INK_WEAK}`, text);
}

/** 使った金額のあたり。1件だけなら実額、複数なら平均に「前後」を添える */
function amountHint(amounts: number[]): string {
  if (amounts.length === 0) {
    return "";
  }
  const average = Math.round(amounts.reduce((sum, value) => sum + value, 0) / amounts.length);
  return `${formatYen(average)}${amounts.length > 1 ? " 前後" : ""}`;
}

/** コメント候補。金額クエリなら金額の近い順、それ以外は入力の部分一致で絞る */
function candidateList(ctx: RenderContext, amount: number | null): CommentCandidate[] {
  const { comments } = ctx.data;
  if (amount === null) {
    const query = ctx.state.searchQuery;
    return commentCandidates(comments, ctx.ledger.transfers)
      .filter((candidate) => candidate.text.includes(query))
      .slice(0, COMMENT_LIMIT);
  }
  return commentCandidates(comments, ctx.ledger.transfers, amount)
    .filter((candidate) =>
      candidate.amounts.some((used) => relativeGap(amount, used) <= SAME_SCALE),
    )
    .slice(0, COMMENT_LIMIT);
}

interface CandidateView {
  query: string;
  top: boolean;
}

function candidateRow(
  ctx: RenderContext,
  candidate: CommentCandidate,
  view: CandidateView,
): HTMLElement {
  const row = el(
    "button",
    `search-comment flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-3 py-2.5 ` +
      `text-left ${view.top ? "bg-[#eef2f6] dark:bg-[#1a2330] " : ""}${CANDIDATE_HOVER}`,
  );
  const text = el("span", `min-w-0 flex-1 truncate text-sm ${INK}`);
  text.append(...highlighted(candidate.text, view.query));
  row.append(
    text,
    el("span", `shrink-0 text-xs tabular-nums ${INK_WEAK}`, `${candidate.count}回`),
    el(
      "span",
      `shrink-0 text-xs font-bold tabular-nums ${INK_SOFT}`,
      amountHint(candidate.amounts),
    ),
  );
  row.addEventListener("click", () => {
    applySearch(ctx, { kind: "text", query: candidate.text });
  });
  return row;
}

function candidateSection(
  ctx: RenderContext,
  candidates: CommentCandidate[],
  query: string,
): HTMLElement {
  const section = el("div", "search-comments");
  section.append(sectionHeading("コメントに一致 · 使用回数順"));
  for (const [index, candidate] of candidates.entries()) {
    section.append(candidateRow(ctx, candidate, { query, top: index === 0 }));
  }
  return section;
}

/** 記録行の金額。ログ行と同じ言い方(振替は額、入出金は符号付き)の小さい版 */
function recordAmount(entry: TransactionEntry): HTMLElement {
  const value = searchAmountOf(entry);
  const text = entry.kind === "transfer" ? formatYen(value) : formatSigned(value);
  const inkFor = entry.kind !== "transfer" && value < 0 ? INK_SOFT : INK;
  return el("span", `shrink-0 text-sm font-bold tabular-nums ${inkFor}`, text);
}

/** 金額クエリのときは、この行がどれだけ近いのかを添える */
function nearnessOf(probe: AppliedSearch, entry: TransactionEntry): HTMLElement[] {
  if (probe.kind !== "amount") {
    return [];
  }
  const badge = el(
    "span",
    `nearness-badge py-[2px] text-[11px] font-bold whitespace-nowrap ${BADGE}`,
    tierBadgeLabel(probe.amount, searchAmountOf(entry)),
  );
  return [badge];
}

/** テキストクエリのときは、一致したメモを添える(なぜ出たのかを読める) */
function memoOf(ctx: RenderContext, entry: TransactionEntry, probe: AppliedSearch): HTMLElement[] {
  const memo = commentText(ctx.data.comments, commentKeyOf(entry));
  if (memo === "") {
    return [];
  }
  const note = el("span", `min-w-0 truncate text-[12.5px] ${INK_SOFT}`);
  note.append("· ", ...highlighted(memo, probe.kind === "text" ? probe.query : ""));
  return [note];
}

/** ログ行と同じ文法のタイトルを、1行に収まる形に詰め直す */
function recordTitle(
  ctx: RenderContext,
  entry: TransactionEntry,
  probe: AppliedSearch,
): HTMLElement {
  const title = logTitle(ctx, entry);
  title.classList.remove("flex-wrap");
  title.classList.add("flex-1", "flex-nowrap", "overflow-hidden", "whitespace-nowrap");
  title.append(...nearnessOf(probe, entry), ...memoOf(ctx, entry, probe));
  return title;
}

function recordRow(ctx: RenderContext, entry: TransactionEntry, probe: AppliedSearch): HTMLElement {
  const row = el(
    "button",
    "search-record flex w-full cursor-pointer items-center gap-3 rounded-[9px] px-3 py-2.5 " +
      "text-left hover:bg-[#f6f7f9] dark:hover:bg-[#1a222c]",
  );
  row.append(
    el("span", `w-11 shrink-0 text-xs tabular-nums ${INK_WEAK}`, formatShortDate(entry.at)),
    recordTitle(ctx, entry, probe),
    recordAmount(entry),
  );
  row.addEventListener("click", () => {
    applySearch(ctx, probe);
  });
  return row;
}

function recordMatches(ctx: RenderContext, probe: AppliedSearch): TransactionEntry[] {
  return allLogEntries(ctx)
    .filter(
      (entry): entry is TransactionEntry =>
        entry.kind !== "snapshot" && entryMatchesSearch(ctx, probe, entry),
    )
    .slice(0, RECORD_LIMIT);
}

function recordSection(
  ctx: RenderContext,
  records: TransactionEntry[],
  probe: AppliedSearch,
): HTMLElement {
  const section = el("div", "search-records");
  section.append(sectionHeading("記録に一致 · 新しい順"));
  for (const entry of records) {
    section.append(recordRow(ctx, entry, probe));
  }
  return section;
}

const TIER_CHIP =
  "search-tier h-7 shrink-0 cursor-pointer rounded-full px-[11px] text-xs transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";
const TIER_CHIP_OFF = `${SURFACE} ${BORDER} ${INK_SOFT} hover:bg-[#f6f7f9] dark:hover:bg-[#1a222c]`;

const TIERS: SearchTier[] = [SAME_TIER, NEAR_TIER, SCALE_TIER];

interface TierView {
  amount: number;
  tier: SearchTier;
}

function tierChip(ctx: RenderContext, view: TierView, rerender: () => void): HTMLElement {
  const active = ctx.state.searchTier === view.tier;
  const chip = el(
    "button",
    `${TIER_CHIP} ${active ? `active font-bold ${SELECTED}` : TIER_CHIP_OFF}`,
    tierChipLabel(view.amount, view.tier),
  );
  chip.setAttribute("aria-pressed", String(active));
  chip.addEventListener("click", () => {
    ctx.state.searchTier = view.tier;
    rerender();
  });
  return chip;
}

/** 金額クエリのときだけ出す、近さの段階の選び直し */
function tierRow(ctx: RenderContext, amount: number, rerender: () => void): HTMLElement {
  const row = el("div", "search-tiers flex flex-wrap items-center gap-2 px-3.5 pt-3 sm:px-[18px]");
  row.append(el("span", `text-xs ${INK_WEAK}`, `${formatYen(amount)}の揺れ:`));
  for (const tier of TIERS) {
    row.append(tierChip(ctx, { amount, tier }, rerender));
  }
  return row;
}

function sectionParts(
  ctx: RenderContext,
  probe: AppliedSearch | null,
  rerender: () => void,
): HTMLElement[] {
  const query = ctx.state.searchQuery;
  const amount = query === "" ? null : parseAmount(query);
  const candidates = candidateList(ctx, amount);
  const records = probe === null ? [] : recordMatches(ctx, probe);
  const empty =
    query !== "" && candidates.length === 0 && records.length === 0
      ? [el("p", `search-empty px-5 py-6 text-sm ${INK_WEAK}`, "一致する記録がありません")]
      : [];
  return [
    ...(amount === null ? [] : [tierRow(ctx, amount, rerender)]),
    ...(candidates.length === 0
      ? []
      : [candidateSection(ctx, candidates, amount === null ? query : "")]),
    ...(probe === null || records.length === 0 ? [] : [recordSection(ctx, records, probe)]),
    ...empty,
  ];
}

/**
 * 候補の描き直し。入力のたびに呼ぶので、全画面のdraw()ではなく
 * パレットの中身だけを組み直す(入力のフォーカスと文字を保つため)
 */
export function renderResults(ctx: RenderContext, refs: PaletteRefs): void {
  const probe = probeOf(ctx.state);
  const rerender = (): void => {
    // 揺れチップで段階を選び直したとき。Enterでそのまま適用できるよう入力へ戻す
    renderResults(ctx, refs);
    refs.input.focus();
  };
  refs.results.replaceChildren(...sectionParts(ctx, probe, rerender));
  refs.apply.disabled = probe === null;
  refs.apply.textContent =
    probe === null ? "ログを絞り込む" : `ログを${appliedSearchLabel(probe)}で絞り込む`;
}
