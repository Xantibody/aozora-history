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
export function transferKey(transfer: TransferRecord): string {
  return `${transfer.transferredAt}:${transfer.from.id}:${transfer.to.id}:${transfer.amount}`;
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

function sameAccount(left: SubAccount, right: SubAccount): boolean {
  return left.id === right.id && left.name === right.name && left.balance === right.balance;
}

function sameAccounts(left: SubAccount[], right: SubAccount[]): boolean {
  return left.length === right.length && left.every((ac, ix) => sameAccount(ac, right[ix]));
}

export function appendSnapshot(list: BalanceSnapshot[], snap: BalanceSnapshot): BalanceSnapshot[] {
  const last = list.at(-1);
  const unchanged = last !== undefined && sameAccounts(last.accounts, snap.accounts);
  return unchanged ? [...list] : [...list, snap];
}

export function latestSnapshot(history: BalanceSnapshot[]): BalanceSnapshot | null {
  return history.at(-1) ?? null;
}

/** 最後に記録が増えた時刻。銀行サイトの構造変化などで記録が止まっていないかの確認に使う */
export function latestRecordAt(snaps: BalanceSnapshot[], records: TransferRecord[]): number | null {
  const times = [...snaps.map((sn) => sn.takenAt), ...records.map((tr) => tr.transferredAt)];
  return times.length === 0 ? null : Math.max(...times);
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

/** スナップショットごとの全口座合計。総資産の推移グラフに使う */
export function totalBalancePoints(history: BalanceSnapshot[]): BalancePoint[] {
  return history.map((snapshot) => ({
    takenAt: snapshot.takenAt,
    balance: snapshot.accounts.reduce((sum, account) => sum + account.balance, 0),
  }));
}

export function sortTransfersDesc(transfers: TransferRecord[]): TransferRecord[] {
  return transfers.toSorted((left, right) => right.transferredAt - left.transferredAt);
}

/**
 * 表示に出す口座の並び。最新スナップショットの順を基本に、振替にしか
 * 現れない口座(解約済みなど)を後ろに補う。フィルタの選択肢と色の割り当てが
 * 同じ順になるよう、1か所で決める
 */
export function accountRefs(
  snapshots: BalanceSnapshot[],
  transfers: TransferRecord[],
): AccountRef[] {
  const byId = new Map<string, AccountRef>();
  for (const account of latestSnapshot(snapshots)?.accounts ?? []) {
    byId.set(account.id, { id: account.id, name: account.name });
  }
  for (const transfer of transfers) {
    for (const ref of [transfer.from, transfer.to]) {
      if (!byId.has(ref.id)) {
        byId.set(ref.id, { id: ref.id, name: ref.name });
      }
    }
  }
  return [...byId.values()];
}

/** 指定口座が出金側・入金側どちらかで関わる振替。nullなら全件 */
export function transfersInvolving(
  transfers: TransferRecord[],
  accountId: string | null,
): TransferRecord[] {
  return accountId === null
    ? transfers
    : transfers.filter((tr) => tr.from.id === accountId || tr.to.id === accountId);
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
  for (const tr of transfers) {
    totals.outgoing += tr.from.id === accountId ? tr.amount : 0;
    totals.incoming += tr.to.id === accountId ? tr.amount : 0;
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
  for (const tr of transfers) {
    const entry = byId.get(tr.to.id) ?? { id: tr.to.id, name: tr.to.name, total: 0 };
    entry.name = tr.to.name;
    entry.total += tr.amount;
    byId.set(tr.to.id, entry);
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

function changesBetween(
  prev: BalanceSnapshot,
  curr: BalanceSnapshot,
  transfers: TransferRecord[],
): BalanceChange[] {
  const window = transfers.filter(
    (tr) => prev.takenAt < tr.transferredAt && tr.transferredAt <= curr.takenAt,
  );
  const prevById = new Map(prev.accounts.map((account) => [account.id, account.balance]));
  const changes: BalanceChange[] = [];
  for (const account of curr.accounts) {
    const delta = account.balance - (prevById.get(account.id) ?? 0);
    const flows = flowTotals(window, account.id);
    const transferDelta = flows.incoming - flows.outgoing;
    if (delta !== 0 || delta !== transferDelta) {
      changes.push({
        accountId: account.id,
        accountName: account.name,
        fromTakenAt: prev.takenAt,
        toTakenAt: curr.takenAt,
        delta,
        transferDelta,
        externalDelta: delta - transferDelta,
      });
    }
  }
  return changes;
}

export function detectBalanceChanges(
  snapshots: BalanceSnapshot[],
  transfers: TransferRecord[],
): BalanceChange[] {
  const changes: BalanceChange[] = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    changes.push(...changesBetween(snapshots[index - 1], snapshots[index], transfers));
  }
  return changes;
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
  const changes = detectBalanceChanges(snapshots, transfers).filter((ch) => inPeriod(ch.toTakenAt));
  const visibleTransfers = transfers.filter((tr) => inPeriod(tr.transferredAt));
  return balanceSeries(snapshots.filter((sn) => inPeriod(sn.takenAt))).map((series) => {
    const lastPoint = series.points.at(-1) ?? series.points[0];
    const flows = flowTotals(visibleTransfers, series.id);
    const externalNet = changes
      .filter((ch) => ch.accountId === series.id)
      .reduce((sum, ch) => sum + ch.externalDelta, 0);
    return {
      id: series.id,
      name: series.name,
      balance: lastPoint.balance,
      delta: lastPoint.balance - series.points[0].balance,
      transferNet: flows.incoming - flows.outgoing,
      externalNet,
      points: series.points,
    };
  });
}
