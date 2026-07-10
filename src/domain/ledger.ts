import type { AccountRef, SubAccount } from "./parser.ts";

export interface BalanceSnapshot {
  takenAt: number;
  updatedAt: string | null;
  accounts: SubAccount[];
}

export interface TransferRecord {
  transferredAt: number;
  from: AccountRef;
  to: AccountRef;
  amount: number;
}

export interface BalancePoint {
  takenAt: number;
  balance: number;
}

export interface BalanceSeries {
  id: string;
  name: string;
  points: BalancePoint[];
}

function sameAccounts(a: SubAccount[], b: SubAccount[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && x.name === b[i].name && x.balance === b[i].balance);
}

export function appendSnapshot(
  history: BalanceSnapshot[],
  snapshot: BalanceSnapshot,
): BalanceSnapshot[] {
  const last = history.at(-1);
  if (last !== undefined && sameAccounts(last.accounts, snapshot.accounts)) return [...history];
  return [...history, snapshot];
}

export function latestSnapshot(history: BalanceSnapshot[]): BalanceSnapshot | null {
  return history.at(-1) ?? null;
}

export function balanceSeries(history: BalanceSnapshot[]): BalanceSeries[] {
  const byId = new Map<string, BalanceSeries>();
  for (const snapshot of history) {
    for (const account of snapshot.accounts) {
      const series = byId.get(account.id) ?? { id: account.id, name: account.name, points: [] };
      series.name = account.name;
      series.points.push({ takenAt: snapshot.takenAt, balance: account.balance });
      byId.set(account.id, series);
    }
  }
  return [...byId.values()];
}

export function sortTransfersDesc(transfers: TransferRecord[]): TransferRecord[] {
  return transfers.toSorted((a, b) => b.transferredAt - a.transferredAt);
}

export function transfersFrom(
  transfers: TransferRecord[],
  fromAccountId: string | null,
): TransferRecord[] {
  if (fromAccountId === null) return transfers;
  return transfers.filter((t) => t.from.id === fromAccountId);
}

export interface DestinationTotal {
  id: string;
  name: string;
  total: number;
}

export function destinationTotals(transfers: TransferRecord[]): DestinationTotal[] {
  const byId = new Map<string, DestinationTotal>();
  for (const t of transfers) {
    const entry = byId.get(t.to.id) ?? { id: t.to.id, name: t.to.name, total: 0 };
    entry.name = t.to.name;
    entry.total += t.amount;
    byId.set(t.to.id, entry);
  }
  return [...byId.values()];
}

export interface BalanceChange {
  accountId: string;
  accountName: string;
  fromTakenAt: number;
  toTakenAt: number;
  /** 期間中の残高の増減 */
  delta: number;
  /** つかいわけ口座間の振替で説明できる増減 */
  transferDelta: number;
  /** 振替で説明できない増減。正なら給与などの外部入金、負なら振込などの外部出金 */
  externalDelta: number;
}

export function detectBalanceChanges(
  snapshots: BalanceSnapshot[],
  transfers: TransferRecord[],
): BalanceChange[] {
  const changes: BalanceChange[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const window = transfers.filter(
      (t) => prev.takenAt < t.transferredAt && t.transferredAt <= curr.takenAt,
    );
    const prevById = new Map(prev.accounts.map((a) => [a.id, a.balance]));

    for (const account of curr.accounts) {
      const delta = account.balance - (prevById.get(account.id) ?? 0);
      const transferDelta = window.reduce((sum, t) => {
        if (t.to.id === account.id) return sum + t.amount;
        if (t.from.id === account.id) return sum - t.amount;
        return sum;
      }, 0);
      const externalDelta = delta - transferDelta;
      if (delta === 0 && externalDelta === 0) continue;
      changes.push({
        accountId: account.id,
        accountName: account.name,
        fromTakenAt: prev.takenAt,
        toTakenAt: curr.takenAt,
        delta,
        transferDelta,
        externalDelta,
      });
    }
  }
  return changes;
}
