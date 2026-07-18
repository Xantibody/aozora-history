import type { BalanceSnapshot, Comments, TransferRecord } from "./ledger.ts";
import { appendSnapshot, transferKey } from "./ledger.ts";

export interface LedgerData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Comments;
  /** 削除した振替の記録。transferKey → 削除時刻。同期で削除を伝播させるために残す */
  deletions: Record<string, number>;
}

function mergeSnapshots(local: BalanceSnapshot[], remote: BalanceSnapshot[]): BalanceSnapshot[] {
  const byTakenAt = new Map<number, BalanceSnapshot>();
  for (const snapshot of [...remote, ...local]) {
    byTakenAt.set(snapshot.takenAt, snapshot);
  }
  const sorted = [...byTakenAt.values()].toSorted((left, right) => left.takenAt - right.takenAt);
  let merged: BalanceSnapshot[] = [];
  for (const snapshot of sorted) {
    merged = appendSnapshot(merged, snapshot);
  }
  return merged;
}

function mergeTransfers(
  local: TransferRecord[],
  remote: TransferRecord[],
  deletions: Record<string, number>,
): TransferRecord[] {
  const byKey = new Map<string, TransferRecord>();
  for (const transfer of [...remote, ...local]) {
    const key = transferKey(transfer);
    if (key in deletions) {
      continue;
    }
    byKey.set(key, transfer);
  }
  return [...byKey.values()].toSorted((left, right) => left.transferredAt - right.transferredAt);
}

function mergeComments(local: Comments, remote: Comments): Comments {
  const merged: Comments = { ...remote };
  for (const [key, entry] of Object.entries(local)) {
    const other = merged[key];
    if (other === undefined || other.updatedAt <= entry.updatedAt) {
      merged[key] = entry;
    }
  }
  return merged;
}

/**
 * 端末間同期用のマージ。記録は和集合、コメントは更新時刻の新しい方
 * (同時刻はローカル優先)。削除の記録(tombstone)も同じ規則で伝播する
 */
export function mergeLedgers(local: LedgerData, remote: LedgerData): LedgerData {
  const deletions = { ...remote.deletions, ...local.deletions };
  return {
    snapshots: mergeSnapshots(local.snapshots, remote.snapshots),
    transfers: mergeTransfers(local.transfers, remote.transfers, deletions),
    comments: mergeComments(local.comments, remote.comments),
    deletions,
  };
}
