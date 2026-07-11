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

/** 振替の同一性を表すキー。端末間マージの重複排除と削除の記録に使う */
export function transferKey(t: TransferRecord): string {
  return `${t.transferredAt}:${t.from.id}:${t.to.id}:${t.amount}`;
}

/**
 * 記録に紐付くコメント。textが空文字の要素は削除の記録(tombstone)で、
 * 端末間同期の際に「削除した」ことを他端末の古いコメントより優先させるために残す
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

/** 指定口座が出金側・入金側どちらかで関わる振替。nullなら全件 */
export function transfersInvolving(
  transfers: TransferRecord[],
  accountId: string | null,
): TransferRecord[] {
  if (accountId === null) return transfers;
  return transfers.filter((t) => t.from.id === accountId || t.to.id === accountId);
}

/** 口座から見た符号付き金額。出金は負、入金は正 */
export function signedAmountFor(transfer: TransferRecord, accountId: string): number {
  return transfer.from.id === accountId ? -transfer.amount : transfer.amount;
}

export interface FlowTotals {
  outgoing: number;
  incoming: number;
}

/** 口座から見た出金・入金それぞれの合計(絶対値) */
export function flowTotals(transfers: TransferRecord[], accountId: string): FlowTotals {
  const totals = { outgoing: 0, incoming: 0 };
  for (const t of transfers) {
    if (t.from.id === accountId) totals.outgoing += t.amount;
    if (t.to.id === accountId) totals.incoming += t.amount;
  }
  return totals;
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

export interface WorkspaceSummary {
  id: string;
  name: string;
  /** 期間内最新の残高 */
  balance: number;
  /** 期間内の最初のスナップショットからの増減 */
  delta: number;
  /** つかいわけ口座間の振替による純増減(入金 − 出金) */
  transferNet: number;
  /** 振替で説明できない純増減(給与などの入金、振込などの出金) */
  externalNet: number;
  points: BalancePoint[];
}

/**
 * 口座(workspace)ごとのKPIサマリー。全期間の記録とinPeriodを渡す。
 * 外部入出金は全期間の変動を求めてから期間で絞る。絞り込み済みの
 * スナップショットから計算すると期間境界をまたぐ区間ごと消えてしまい、
 * 「残高変動」の表と食い違うため
 */
export function workspaceSummaries(
  snapshots: BalanceSnapshot[],
  transfers: TransferRecord[],
  inPeriod: (epochMs: number) => boolean = () => true,
): WorkspaceSummary[] {
  const changes = detectBalanceChanges(snapshots, transfers).filter((c) => inPeriod(c.toTakenAt));
  const visibleTransfers = transfers.filter((t) => inPeriod(t.transferredAt));
  return balanceSeries(snapshots.filter((s) => inPeriod(s.takenAt))).map((series) => {
    const first = series.points[0].balance;
    const last = series.points.at(-1)!.balance;
    const flows = flowTotals(visibleTransfers, series.id);
    const externalNet = changes
      .filter((c) => c.accountId === series.id)
      .reduce((sum, c) => sum + c.externalDelta, 0);
    return {
      id: series.id,
      name: series.name,
      balance: last,
      delta: last - first,
      transferNet: flows.incoming - flows.outgoing,
      externalNet,
      points: series.points,
    };
  });
}

/**
 * コメント欄の入力候補。削除の記録を除き、使用回数の多い順
 * (同数なら記録またはコメント編集が新しい順)に並べる
 */
export function commentSuggestions(comments: Comments): string[] {
  const stats = new Map<string, { count: number; lastAt: number }>();
  for (const [key, { text, updatedAt }] of Object.entries(comments)) {
    if (text === "") continue;
    // 旧形式から移行したコメントはupdatedAtが0のため、キー末尾の記録時刻でも比べる
    const at = Math.max(updatedAt, Number(key.slice(key.lastIndexOf(":") + 1)) || 0);
    const entry = stats.get(text) ?? { count: 0, lastAt: 0 };
    entry.count += 1;
    entry.lastAt = Math.max(entry.lastAt, at);
    stats.set(text, entry);
  }
  return [...stats.entries()]
    .toSorted(([, a], [, b]) => b.count - a.count || b.lastAt - a.lastAt)
    .map(([text]) => text);
}

/** コメント紐付け用の安定キー */
export function transferCommentKey(transfer: TransferRecord): string {
  return `transfer:${transfer.transferredAt}`;
}

export function changeCommentKey(change: BalanceChange): string {
  return `change:${change.accountId}:${change.toTakenAt}`;
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
