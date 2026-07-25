import type { BankApiClient } from "./bank-api.ts";
import type { HistoryStore } from "./storage.ts";

/**
 * 銀行APIを叩き直す間隔。ページを開くたびに問い合わせても銀行側の記録は
 * ほとんど変わらないため、SPAの画面遷移で何度も走らないように間隔を空ける
 */
const COLLECT_INTERVAL_MINUTES = 10;
const MS_PER_MINUTE = 60_000;
export const COLLECT_INTERVAL_MS = COLLECT_INTERVAL_MINUTES * MS_PER_MINUTE;

/** 1回に取りに行く明細の件数。取りこぼしを防ぐためAPIの上限いっぱいまで取る */
export const STATEMENT_LIMIT = 100;

export function shouldCollect(
  lastCollectedAt: number | null,
  now: number,
  intervalMs: number = COLLECT_INTERVAL_MS,
): boolean {
  if (lastCollectedAt === null) {
    return true;
  }
  // 端末の時計が巻き戻った場合も取り直せるようにする
  return now < lastCollectedAt || now - lastCollectedAt >= intervalMs;
}

export interface CollectResult {
  /** 間隔が空いていないなどで問い合わせ自体を見送った */
  skipped: boolean;
  snapshotSaved: boolean;
  statementsSaved: boolean;
  /** 片方だけ失敗することがあるため、起きたエラーはまとめて返す */
  errors: unknown[];
}

async function collectBalances(
  store: HistoryStore,
  client: BankApiClient,
  now: () => number,
): Promise<boolean> {
  const parsed = await client.spAccountBalances();
  if (parsed === null) {
    return false;
  }
  return store.recordSnapshot({ takenAt: now(), ...parsed });
}

async function collectStatements(store: HistoryStore, client: BankApiClient): Promise<boolean> {
  const parsed = await client.ordinaryStatement(STATEMENT_LIMIT);
  if (parsed === null) {
    return false;
  }
  return store.recordStatements(parsed);
}

/**
 * ログイン済みのタブと同じセッションで残高と明細を取り込む。
 * 残高と明細は独立して取りに行き、片方が失敗してももう片方は記録する
 */
export async function collectFromBank(
  store: HistoryStore,
  client: BankApiClient,
  now: () => number = Date.now,
): Promise<CollectResult> {
  const lastCollectedAt = await store.loadLastCollectedAt();
  if (!shouldCollect(lastCollectedAt, now())) {
    return { skipped: true, snapshotSaved: false, statementsSaved: false, errors: [] };
  }
  // 未ログインのページで何度も問い合わせに行かないよう、成否によらず先に印を付ける
  await store.markCollected();

  const [balances, statements] = await Promise.allSettled([
    collectBalances(store, client, now),
    collectStatements(store, client),
  ]);

  return {
    skipped: false,
    snapshotSaved: balances.status === "fulfilled" && balances.value,
    statementsSaved: statements.status === "fulfilled" && statements.value,
    errors: [balances, statements]
      .filter((result) => result.status === "rejected")
      .map((result) => (result as PromiseRejectedResult).reason),
  };
}
