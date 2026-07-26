import type { BalanceChange, BalanceSnapshot, TransferRecord } from "./ledger.ts";
import type { StatementEntry } from "./statement.ts";
import { detectBalanceChanges } from "./ledger.ts";
import { primaryStatements } from "./statement.ts";

/**
 * カードログの1行。振替・外部入出金・代表口座の明細・残高記録のいずれか。
 *
 * 代表口座の明細を別のタブに分けていたときは、同じ日のお金の動きを見るのに
 * 画面を行き来する必要があった。口座が違うだけで起きたことは同じなので、
 * ひとつの時系列に並べる
 */
export type LogEntry =
  | { kind: "transfer"; at: number; transfer: TransferRecord }
  | { kind: "external"; at: number; change: BalanceChange }
  | { kind: "statement"; at: number; statement: StatementEntry }
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

export interface LogInput {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  /** 代表口座の明細。つかいわけ口座の明細は外部入出金の摘要に使うので入れない */
  statements: StatementEntry[];
  /** 明細は起算日しか持たないため、その日のどの時刻に置くかは呼び出し側が決める */
  dayStart: (valueDate: string) => number | null;
}

function statementEntries(input: LogInput): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const statement of primaryStatements(input.statements)) {
    const at = input.dayStart(statement.valueDate);
    if (at !== null) {
      entries.push({ kind: "statement", at, statement });
    }
  }
  return entries;
}

export function logEntries(input: LogInput): LogEntry[] {
  const entries: LogEntry[] = [
    ...input.transfers.map(
      (tr): LogEntry => ({ kind: "transfer", at: tr.transferredAt, transfer: tr }),
    ),
    ...detectBalanceChanges(input.snapshots, input.transfers)
      .filter((ch) => ch.externalDelta !== 0)
      .map((ch): LogEntry => ({ kind: "external", at: ch.toTakenAt, change: ch })),
    ...statementEntries(input),
    ...input.snapshots.map((sn) => snapshotEntry(sn)),
  ];
  return entries.toSorted((left, right) => right.at - left.at || logRank(left) - logRank(right));
}
