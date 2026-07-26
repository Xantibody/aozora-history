import type { BalanceChange, BalanceSnapshot, TransferRecord } from "./ledger.ts";
import { detectBalanceChanges } from "./ledger.ts";

/** カードログの1行。振替・振替で説明できない外部入出金・残高記録のいずれか */
export type LogEntry =
  | { kind: "transfer"; at: number; transfer: TransferRecord }
  | { kind: "external"; at: number; change: BalanceChange }
  | { kind: "snapshot"; at: number; snapshot: BalanceSnapshot; total: number };

function snapshotEntry(snapshot: BalanceSnapshot): LogEntry {
  const total = snapshot.accounts.reduce((sum, account) => sum + account.balance, 0);
  return { kind: "snapshot", at: snapshot.takenAt, snapshot, total };
}

/**
 * 振替・外部入出金・残高記録を新しい順の1本の時系列ログに統合する。
 * 残高記録は日カードの従属行なので、同時刻では取引の後ろに置く
 */
const logRank = (entry: LogEntry): number => (entry.kind === "snapshot" ? 1 : 0);

export function logEntries(snapshots: BalanceSnapshot[], transfers: TransferRecord[]): LogEntry[] {
  const entries: LogEntry[] = [
    ...transfers.map((tr): LogEntry => ({ kind: "transfer", at: tr.transferredAt, transfer: tr })),
    ...detectBalanceChanges(snapshots, transfers)
      .filter((ch) => ch.externalDelta !== 0)
      .map((ch): LogEntry => ({ kind: "external", at: ch.toTakenAt, change: ch })),
    ...snapshots.map((sn) => snapshotEntry(sn)),
  ];
  return entries.toSorted((left, right) => right.at - left.at || logRank(left) - logRank(right));
}
