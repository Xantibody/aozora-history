import type { BankApiClient } from "./bank-api.ts";
import type { HistoryStore } from "./storage.ts";
import type { SubAccount } from "../domain/parser.ts";
import { statementsExplainBalance } from "../domain/statement.ts";

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

/** 定額自動振替の設定は多くても口座数程度。1回で取り切れる件数にしておく */
export const AUTO_TRANSFER_LIMIT = 100;

/**
 * 1つのAPIの結果。savedだけでは「取れたが記録に変化がなかった」と
 * 「そもそも取れなかった」を区別できないため、取れた件数も持つ
 */
export interface Collected {
  /** 銀行が返した件数。nullは取得できなかった(形が違う・ログイン切れなど) */
  count: number | null;
  /** 記録に変化があって保存したか */
  saved: boolean;
}

const NOT_FETCHED: Collected = { count: null, saved: false };

export interface CollectResult {
  /** 間隔が空いていないなどで問い合わせ自体を見送った */
  skipped: boolean;
  balances: Collected;
  statements: Collected;
  /** つかいわけ口座ごとの明細。countは取り込めた明細の合計 */
  accountStatements: Collected;
  autoTransfers: Collected;
  /** 一部だけ失敗することがあるため、起きたエラーはまとめて返す */
  errors: unknown[];
}

interface BalanceResult extends Collected {
  accounts: SubAccount[];
}

async function collectBalances(
  store: HistoryStore,
  client: BankApiClient,
  now: () => number,
): Promise<BalanceResult> {
  const parsed = await client.spAccountBalances();
  if (parsed === null) {
    return { ...NOT_FETCHED, accounts: [] };
  }
  const saved = await store.recordSnapshot({ takenAt: now(), ...parsed });
  return { count: parsed.accounts.length, saved, accounts: parsed.accounts };
}

async function collectStatements(store: HistoryStore, client: BankApiClient): Promise<Collected> {
  const parsed = await client.ordinaryStatement(STATEMENT_LIMIT);
  if (parsed === null) {
    return NOT_FETCHED;
  }
  return { count: parsed.length, saved: await store.recordStatements(parsed) };
}

async function collectAutoTransfers(
  store: HistoryStore,
  client: BankApiClient,
): Promise<Collected> {
  const parsed = await client.autoTransfers(AUTO_TRANSFER_LIMIT);
  if (parsed === null) {
    return NOT_FETCHED;
  }
  return { count: parsed.length, saved: await store.recordAutoTransfers(parsed) };
}

function addCount(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

interface AccountStatementsResult extends Collected {
  errors: unknown[];
}

/**
 * つかいわけ口座ごとの入出金明細。自動引落のように残高だけが動く出金は、
 * ここでしか摘要が取れない。
 *
 * 明細の最新残高がその口座の残高と合うことを確かめてから取り込む。
 * 1口座目で失敗したらエンドポイント自体が使えないとみて残りは試さない
 * (ページを開くたびに口座数ぶん叩き続けない)
 */
async function collectAccountStatements(
  store: HistoryStore,
  client: BankApiClient,
  accounts: SubAccount[],
): Promise<AccountStatementsResult> {
  const [account, ...rest] = accounts;
  if (account === undefined) {
    return { ...NOT_FETCHED, errors: [] };
  }
  try {
    const parsed = await client.spAccountStatement(account.id, STATEMENT_LIMIT);
    // countが0より大きいのにsavedが偽なら、明細は取れたが残高の検算で弾かれている
    const stored =
      parsed !== null && statementsExplainBalance(parsed, account.balance)
        ? await store.recordStatements(parsed)
        : false;
    // 1口座ずつ順に。並べて投げると、使えないエンドポイントを口座数ぶん叩いてしまう
    const next = await collectAccountStatements(store, client, rest);
    return {
      count: addCount(parsed?.length ?? null, next.count),
      saved: stored || next.saved,
      errors: next.errors,
    };
  } catch (error) {
    return { ...NOT_FETCHED, errors: [error] };
  }
}

/** 呼び出し側でしか使わない口座一覧やエラーを落とし、結果だけにする */
function onlyCollected({ count, saved }: Collected): Collected {
  return { count, saved };
}

/** 例外で終わった問い合わせは「取得できなかった」として扱う(理由は errors に入る) */
function settled(result: PromiseSettledResult<Collected>): Collected {
  return result.status === "fulfilled" ? onlyCollected(result.value) : NOT_FETCHED;
}

function reasonsOf(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => (result as PromiseRejectedResult).reason);
}

/**
 * ログイン済みのタブと同じセッションで残高・明細・定額自動振替の設定を取り込む。
 * それぞれ独立して取りに行き、1つが失敗しても他は記録する
 */
export async function collectFromBank(
  store: HistoryStore,
  client: BankApiClient,
  now: () => number = Date.now,
): Promise<CollectResult> {
  const lastCollectedAt = await store.loadLastCollectedAt();
  if (!shouldCollect(lastCollectedAt, now())) {
    return {
      skipped: true,
      balances: NOT_FETCHED,
      statements: NOT_FETCHED,
      accountStatements: NOT_FETCHED,
      autoTransfers: NOT_FETCHED,
      errors: [],
    };
  }
  // 未ログインのページで何度も問い合わせに行かないよう、成否によらず先に印を付ける
  await store.markCollected();

  const [balances, statements, autoTransfers] = await Promise.allSettled([
    collectBalances(store, client, now),
    collectStatements(store, client),
    collectAutoTransfers(store, client),
  ]);
  // 口座別明細は口座一覧が要るため、残高が取れてから
  const accountStatements = await collectAccountStatements(
    store,
    client,
    balances.status === "fulfilled" ? balances.value.accounts : [],
  );

  return {
    skipped: false,
    balances: settled(balances),
    statements: settled(statements),
    accountStatements: onlyCollected(accountStatements),
    autoTransfers: settled(autoTransfers),
    errors: [...reasonsOf([balances, statements, autoTransfers]), ...accountStatements.errors],
  };
}
