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

/**
 * コメント欄の入力候補。削除の記録を除き、使用回数の多い順
 * (同数なら記録またはコメント編集が新しい順)に並べる
 */
export function commentSuggestions(comments: Comments): string[] {
  const stats = new Map<string, { count: number; lastAt: number }>();
  for (const [key, { text, updatedAt }] of Object.entries(comments)) {
    if (text !== "") {
      // 旧形式から移行したコメントはupdatedAtが0のため、キー末尾の記録時刻でも比べる
      const recordedAt = Number(key.slice(key.lastIndexOf(":") + 1)) || 0;
      const entry = stats.get(text) ?? { count: 0, lastAt: 0 };
      entry.count += 1;
      entry.lastAt = Math.max(entry.lastAt, updatedAt, recordedAt);
      stats.set(text, entry);
    }
  }
  return [...stats.entries()]
    .toSorted(([, left], [, right]) => right.count - left.count || right.lastAt - left.lastAt)
    .map(([text]) => text);
}

/** コメント紐付け用の安定キー */
export function transferCommentKey(transfer: TransferRecord): string {
  return `transfer:${transfer.transferredAt}`;
}

export function changeCommentKey(change: BalanceChange): string {
  return `change:${change.accountId}:${change.toTakenAt}`;
}
