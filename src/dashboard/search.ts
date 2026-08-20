import type { AppliedSearch, SearchTier } from "./context.ts";
import { NEAR_AMOUNT, SAME_SCALE, relativeGap } from "../domain/comments.ts";
import { NEAR_TIER, SAME_TIER, SCALE_TIER } from "./context.ts";
import type { LogEntry } from "../domain/log.ts";
import { el } from "./dom.ts";
import { formatYen } from "./format.ts";

/**
 * 検索はコメント検索と金額の揺れ検索を1つの入口(パレット)で扱う。
 * このモジュールはその判定と文言だけを持ち、画面は search-palette.ts が組む
 */

const TIER_RATIOS: Record<SearchTier, number> = {
  [SAME_TIER]: 0,
  [NEAR_TIER]: NEAR_AMOUNT,
  [SCALE_TIER]: SAME_SCALE,
};

/**
 * 数字だけの入力は金額として読む。「85,000円」のような書き写しも
 * 金額のつもりなので、カンマ・空白・「円」は取り除いてから判定する
 */
export function parseAmount(query: string): number | null {
  const digits = query.replaceAll(/[,，円\s]/gu, "");
  return /^\d+$/u.test(digits) ? Number(digits) : null;
}

/** その記録が検索に当たるか。textsはメモ・摘要など、読み合わせる文字列 */
export function matchesSearch(applied: AppliedSearch, texts: string[], amount: number): boolean {
  if (applied.kind === "text") {
    return texts.some((text) => text.includes(applied.query));
  }
  return relativeGap(applied.amount, Math.abs(amount)) <= TIER_RATIOS[applied.tier];
}

const PERCENT = 100;

/**
 * 行に添える近さバッジ。同額以外は実差のパーセントで示す。
 * 「ほぼ同額」と丸めるより、+9%と読めた方がどの記録か言い当てやすい
 */
export function tierBadgeLabel(target: number, amount: number): string {
  const value = Math.abs(amount);
  if (value === target) {
    return "同額";
  }
  const percent = Math.round(((value - target) / target) * PERCENT);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/** 適用中の条件の言い表し。解除チップと適用ボタンの両方で使う */
export function appliedSearchLabel(applied: AppliedSearch): string {
  if (applied.kind === "text") {
    return `「${applied.query}」`;
  }
  const amount = formatYen(applied.amount);
  if (applied.tier === SAME_TIER) {
    return `${amount}（同額）`;
  }
  return applied.tier === NEAR_TIER ? `${amount}±${NEAR_AMOUNT * PERCENT}%` : `${amount}（同じ桁）`;
}

/** 揺れチップの文言。範囲の実値を含め、何円まで拾うのかを選ぶ前に読めるようにする */
export function tierChipLabel(target: number, tier: SearchTier): string {
  if (tier === SAME_TIER) {
    return "完全一致";
  }
  const ratio = TIER_RATIOS[tier];
  const range = `${formatYen(Math.round(target * (1 - ratio)))}〜${formatYen(Math.round(target * (1 + ratio)))}`;
  return tier === NEAR_TIER ? `ほぼ同額 ${range}` : `同じ桁 ${range}`;
}

/** ページングを引き継いでよい範囲の判定(filterKey)に足す検索条件のキー */
export function searchKey(applied: AppliedSearch | null): string {
  if (applied === null) {
    return "";
  }
  return applied.kind === "text"
    ? `text:${applied.query}`
    : `amount:${applied.amount}:${applied.tier}`;
}

/** テキスト検索の適用中だけ、その語を返す(メモ・摘要のハイライト用) */
export function appliedQuery(applied: AppliedSearch | null): string {
  return applied?.kind === "text" ? applied.query : "";
}

type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" | "statement" }>;

/** 検索で比べる記録の金額。振替は動かした額、明細と外部入出金は符号付きの増減 */
export function searchAmountOf(entry: TransactionEntry): number {
  if (entry.kind === "transfer") {
    return entry.transfer.amount;
  }
  return entry.kind === "statement" ? entry.statement.amount : entry.change.externalDelta;
}

/** 一致部分の面。色でなく面の濃淡で示す(色で意味を持つのは口座色だけ) */
const MARK = "search-mark rounded-[3px] bg-[#eef1f5] px-[2px] font-bold dark:bg-[#1e2733]";

/**
 * 一致した部分を強調した本文。テキスト検索の適用中に、
 * なぜこの行が残っているのかをメモ・摘要の中で指し示す
 */
export function highlighted(text: string, query: string): (HTMLElement | string)[] {
  const parts = query === "" ? [text] : text.split(query);
  if (parts.length === 1) {
    return [text];
  }
  const nodes: (HTMLElement | string)[] = [];
  for (const [index, part] of parts.entries()) {
    if (index > 0) {
      nodes.push(el("span", MARK, query));
    }
    if (part !== "") {
      nodes.push(part);
    }
  }
  return nodes;
}
