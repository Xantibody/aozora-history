import {
  appendSnapshot,
  type BalanceSnapshot,
  type Comments,
  transferKey,
  type TransferRecord,
} from "./ledger.ts";

export interface LedgerData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Comments;
  /** 削除した振替の記録。transferKey → 削除時刻。同期で削除を伝播させるために残す */
  deletions: Record<string, number>;
}

/**
 * 端末間同期用のマージ。記録は和集合、コメントは更新時刻の新しい方
 * (同時刻はローカル優先)。削除の記録(tombstone)も同じ規則で伝播する
 */
export function mergeLedgers(local: LedgerData, remote: LedgerData): LedgerData {
  const snapshotsByTakenAt = new Map<number, BalanceSnapshot>();
  for (const s of [...remote.snapshots, ...local.snapshots]) {
    snapshotsByTakenAt.set(s.takenAt, s);
  }
  const snapshots = [...snapshotsByTakenAt.values()]
    .toSorted((a, b) => a.takenAt - b.takenAt)
    .reduce<BalanceSnapshot[]>((acc, s) => appendSnapshot(acc, s), []);

  const deletions = { ...remote.deletions, ...local.deletions };

  const transfersByKey = new Map<string, TransferRecord>();
  for (const t of [...remote.transfers, ...local.transfers]) {
    const key = transferKey(t);
    if (key in deletions) continue;
    transfersByKey.set(key, t);
  }
  const transfers = [...transfersByKey.values()].toSorted(
    (a, b) => a.transferredAt - b.transferredAt,
  );

  const comments: Comments = { ...remote.comments };
  for (const [key, entry] of Object.entries(local.comments)) {
    const other = comments[key];
    if (other === undefined || other.updatedAt <= entry.updatedAt) comments[key] = entry;
  }

  return { snapshots, transfers, comments, deletions };
}
