import { appendSnapshot, type BalanceSnapshot, type TransferRecord } from "./ledger.ts";

export interface LedgerData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Record<string, string>;
}

function transferKey(t: TransferRecord): string {
  return `${t.transferredAt}:${t.from.id}:${t.to.id}:${t.amount}`;
}

/** 端末間同期用のマージ。記録は和集合、コメントの衝突はローカル優先 */
export function mergeLedgers(local: LedgerData, remote: LedgerData): LedgerData {
  const snapshotsByTakenAt = new Map<number, BalanceSnapshot>();
  for (const s of [...remote.snapshots, ...local.snapshots]) {
    snapshotsByTakenAt.set(s.takenAt, s);
  }
  const snapshots = [...snapshotsByTakenAt.values()]
    .toSorted((a, b) => a.takenAt - b.takenAt)
    .reduce<BalanceSnapshot[]>((acc, s) => appendSnapshot(acc, s), []);

  const transfersByKey = new Map<string, TransferRecord>();
  for (const t of [...remote.transfers, ...local.transfers]) {
    transfersByKey.set(transferKey(t), t);
  }
  const transfers = [...transfersByKey.values()].toSorted(
    (a, b) => a.transferredAt - b.transferredAt,
  );

  return { snapshots, transfers, comments: { ...remote.comments, ...local.comments } };
}
