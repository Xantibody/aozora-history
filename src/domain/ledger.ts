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
  return a.every(
    (x, i) => x.id === b[i].id && x.name === b[i].name && x.balance === b[i].balance,
  );
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
