import type { BalanceChange, TransferRecord } from "./ledger.ts";

/**
 * 記録に紐付くコメント。台帳そのものではなく、記録に後から付ける手書きの
 * 一言なので、残高や振替の計算とは切り離しておく
 */

/**
 * textが空文字の要素は削除の記録(tombstone)で、端末間同期の際に
 * 「削除した」ことを他端末の古いコメントより優先させるために残す
 */
export interface CommentEntry {
  text: string;
  updatedAt: number;
}

export type Comments = Record<string, CommentEntry>;

/** 表示用のコメント本文。未設定・削除済みは空文字 */
export function commentText(comments: Comments, key: string): string {
  return comments[key]?.text ?? "";
}

/** コメント紐付け用の安定キー */
export function transferCommentKey(transfer: TransferRecord): string {
  return `transfer:${transfer.transferredAt}`;
}

export function changeCommentKey(change: BalanceChange): string {
  return `change:${change.accountId}:${change.toTakenAt}`;
}

/**
 * これから書くコメントが付く記録。金額の近い記録に付けたコメントを
 * 先に出すために渡す。振替の記録から金額を引くので、過去の記録も要る
 */
export interface SuggestionContext {
  amount: number;
  transfers: TransferRecord[];
}

/** 同じ額とみなす隔たり(=完全一致) */
const SAME_AMOUNT = 0;
/** ほぼ同じ額とみなす隔たり。3,000円に対する3,300円まで */
const NEAR_AMOUNT = 0.1;
/** 同じ桁とみなす隔たり。3,000円に対する6,000円まで */
const SAME_SCALE = 0.5;

/**
 * 金額の近さの段階。同額 → ほぼ同額 → 同じ桁 → それ以外。
 *
 * 隔たりをそのまま順位にすると、数十円の違いで普段使いの候補が押しのけられる。
 * 段階に丸めておけば、同じくらい近い候補のなかは今までどおり使用回数で並ぶ
 */
const NEARNESS_RATIOS = [SAME_AMOUNT, NEAR_AMOUNT, SAME_SCALE];
const FAR = NEARNESS_RATIOS.length;

/** 2つの金額の隔たり。桁が違えば1に近づく(3,000円と80,000円は「遠い」) */
function relativeGap(amount: number, other: number): number {
  const scale = Math.max(Math.abs(amount), Math.abs(other));
  return scale === 0 ? SAME_AMOUNT : Math.abs(amount - other) / scale;
}

/** 金額の分からないコメント(明細に付けたものなど)は、最後の段階として扱う */
function nearnessOf(amount: number, used: number[]): number {
  const closest = Math.min(...used.map((value) => relativeGap(amount, value)));
  const tier = NEARNESS_RATIOS.findIndex((ratio) => closest <= ratio);
  return tier === -1 ? FAR : tier;
}

interface Stat {
  count: number;
  lastAt: number;
  /** そのコメントを使った記録の金額。引けなかったものは入らない */
  amounts: number[];
}

/** 旧形式から移行したコメントはupdatedAtが0のため、キー末尾の記録時刻でも比べる */
function recordedAtOf(key: string): number {
  return Number(key.slice(key.lastIndexOf(":") + 1)) || 0;
}

/** そのコメントが1件の記録に使われていたことを、集計に足す */
function addUse(stat: Stat, use: { key: string; updatedAt: number }, amount?: number): Stat {
  return {
    count: stat.count + 1,
    lastAt: Math.max(stat.lastAt, use.updatedAt, recordedAtOf(use.key)),
    amounts: amount === undefined ? stat.amounts : [...stat.amounts, amount],
  };
}

const EMPTY_STAT: Stat = { count: 0, lastAt: 0, amounts: [] };

function collectStats(comments: Comments, amounts: Map<string, number>): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  for (const [key, { text, updatedAt }] of Object.entries(comments)) {
    if (text !== "") {
      stats.set(text, addUse(stats.get(text) ?? EMPTY_STAT, { key, updatedAt }, amounts.get(key)));
    }
  }
  return stats;
}

/** コメントのキーから、そのコメントが付いている振替の金額を引く索引 */
function amountsByKey(transfers: TransferRecord[]): Map<string, number> {
  return new Map(transfers.map((transfer) => [transferCommentKey(transfer), transfer.amount]));
}

/** 並べ替えに使う分だけ取り出した候補。金額は近さに畳んだので持たない */
interface Ranked {
  text: string;
  nearness: number;
  count: number;
  lastAt: number;
}

/**
 * コメント欄の入力候補。削除の記録を除き、使用回数の多い順
 * (同数なら記録またはコメント編集が新しい順)に並べる。
 *
 * 記録を渡した場合は、金額の近さを先に見る。同じ額を動かすときは同じ用途で
 * あることが多く、よく使う候補を上から順に読むより先に見つかる
 */
export function commentSuggestions(comments: Comments, context?: SuggestionContext): string[] {
  const stats = collectStats(comments, amountsByKey(context?.transfers ?? []));
  const ranked: Ranked[] = [...stats.entries()].map(([text, stat]) => ({
    text,
    count: stat.count,
    lastAt: stat.lastAt,
    // 金額を渡されていなければ、近さでは差を付けない
    nearness: context === undefined ? SAME_AMOUNT : nearnessOf(context.amount, stat.amounts),
  }));
  return ranked
    .toSorted(
      (left, right) =>
        left.nearness - right.nearness || right.count - left.count || right.lastAt - left.lastAt,
    )
    .map((entry) => entry.text);
}
