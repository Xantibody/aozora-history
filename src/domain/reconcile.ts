import type { BalanceChange, BalanceSnapshot, TransferRecord } from "./ledger.ts";
import { detectBalanceChanges, transferKey } from "./ledger.ts";
import type { AccountRef } from "./parser.ts";

/**
 * つかいわけ口座の残高は、この拡張が検知していない理由でも動く。
 *
 * - 定額自動振替(毎月◯日に口座間で自動的に移す設定)
 * - つかいわけ口座を引落口座に指定した自動引落
 * - 別端末・スマホアプリからの振替
 *
 * 振替ページのDOMを見ているだけではこれらが記録に残らず、残高の増減と
 * 振替記録の合計が食い違う。この食い違い(差額)をそのまま「外部入出金」に
 * 混ぜると、口座間で動いただけの金額が収支として二重に見えてしまう。
 *
 * ここでは、同じ区間で打ち消し合う増減を口座間の移動として拾い直し、
 * 残った分だけを本当の外部入出金として扱う。
 */

/** 期間ごとの差額の集まり。同じスナップショット区間の増減をまとめて突き合わせる */
interface Interval {
  fromTakenAt: number;
  toTakenAt: number;
  changes: BalanceChange[];
}

function groupByInterval(changes: BalanceChange[]): Interval[] {
  const intervals: Interval[] = [];
  for (const change of changes) {
    const current = intervals.at(-1);
    if (current !== undefined && current.toTakenAt === change.toTakenAt) {
      current.changes.push(change);
    } else {
      intervals.push({
        fromTakenAt: change.fromTakenAt,
        toTakenAt: change.toTakenAt,
        changes: [change],
      });
    }
  }
  return intervals;
}

function accountRef(change: BalanceChange): AccountRef {
  return { id: change.accountId, name: change.accountName };
}

function groupByAmount(changes: BalanceChange[]): Map<number, BalanceChange[]> {
  const byAmount = new Map<number, BalanceChange[]>();
  for (const change of changes) {
    const amount = Math.abs(change.externalDelta);
    byAmount.set(amount, [...(byAmount.get(amount) ?? []), change]);
  }
  return byAmount;
}

/**
 * 同じ金額で減った口座と増えた口座の組。出金側・入金側がそれぞれ1つに
 * 絞れるときだけ返す。同じ金額の候補が複数あるとどれとどれが対になるか
 * 決められないため、推測はしない(誤った振替を作るより、説明できないと示す方がよい)
 */
function pairOf(group: BalanceChange[], amount: number): [BalanceChange, BalanceChange] | null {
  const incoming = group.filter((change) => change.externalDelta > 0);
  const outgoing = group.filter((change) => change.externalDelta < 0);
  if (amount === 0 || incoming.length !== 1 || outgoing.length !== 1) {
    return null;
  }
  return [outgoing[0], incoming[0]];
}

/** 同じ区間で打ち消し合う増減を1件の振替に組み直し、組めなかった分を残す */
function pairOffsetting(interval: Interval): {
  transfers: TransferRecord[];
  rest: BalanceChange[];
} {
  const transfers: TransferRecord[] = [];
  const paired = new Set<BalanceChange>();
  for (const [amount, group] of groupByAmount(interval.changes)) {
    const pair = pairOf(group, amount);
    if (pair !== null) {
      transfers.push({
        transferredAt: interval.toTakenAt,
        from: accountRef(pair[0]),
        to: accountRef(pair[1]),
        amount,
      });
      paired.add(pair[0]).add(pair[1]);
    }
  }
  return { transfers, rest: interval.changes.filter((change) => !paired.has(change)) };
}

export interface Reconciled {
  /** 記録済みの振替と、差額から拾い直した振替を合わせたもの。集計はこれを使う */
  transfers: TransferRecord[];
  /** 差額から拾い直した分だけ。記録ではないため削除できず、表示で区別する */
  detected: TransferRecord[];
  /** 拾い直しても説明できない増減。給与などの外部入金・自動引落などの外部出金 */
  changes: BalanceChange[];
}

/** 記録ではなく残高の差額から拾い直した振替か。削除ボタンを出すかの判定に使う */
export function isDetected(reconciled: Reconciled, transfer: TransferRecord): boolean {
  const key = transferKey(transfer);
  return reconciled.detected.some((detected) => transferKey(detected) === key);
}

/**
 * 残高の増減を「記録済みの振替」「差額から拾い直した振替」「外部入出金」に分ける。
 * 拾い直した振替は台帳には保存せず、読み出すたびにスナップショットから導出する
 * (銀行側の記録ではないので、記録が増えれば解釈も変わってよい)
 */
export function reconcile(snapshots: BalanceSnapshot[], transfers: TransferRecord[]): Reconciled {
  const detected: TransferRecord[] = [];
  const changes: BalanceChange[] = [];
  for (const interval of groupByInterval(detectBalanceChanges(snapshots, transfers))) {
    const paired = pairOffsetting(interval);
    detected.push(...paired.transfers);
    changes.push(...paired.rest);
  }
  return {
    transfers: [...transfers, ...detected].toSorted(
      (left, right) => left.transferredAt - right.transferredAt,
    ),
    detected,
    changes,
  };
}
