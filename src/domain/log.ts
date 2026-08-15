import type { BalanceChange, BalanceSnapshot, TransferRecord } from "./ledger.ts";
import type { StatementEntry } from "./statement.ts";
import { detectBalanceChanges } from "./ledger.ts";
import { primaryStatements } from "./statement.ts";

/** その明細を、どのつかいわけ口座の動きとして読むか */
interface StatementScope {
  accountId: string;
  accountName: string;
}

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
  | { kind: "statement"; at: number; statement: StatementEntry; account?: StatementScope }
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
  placeAt: (valueDate: string) => number | null;
}

/** 起算日は日単位なので、区間の始まりもその日の0時まで広げて見る */
function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

interface PlacedStatement {
  statement: StatementEntry;
  at: number;
  account?: StatementScope;
}

function placeStatements(input: LogInput): PlacedStatement[] {
  const placed: PlacedStatement[] = [];
  for (const statement of primaryStatements(input.statements)) {
    const at = input.placeAt(statement.valueDate);
    if (at !== null) {
      placed.push({ statement, at });
    }
  }
  return placed;
}

const sameSign = (left: number, right: number): boolean => left > 0 === right > 0;

/**
 * その残高変動の区間にあって、まだどの残高変動にも結び付いていない明細。
 *
 * 見るのは置いた時刻ではなく起算日。並びを整えるために日の終わりへ寄せても、
 * どの残高変動を説明する明細かという読みは変わらないため
 */
function freeLines(placed: PlacedStatement[], change: BalanceChange): PlacedStatement[] {
  return placed.filter(
    (line) =>
      line.account === undefined &&
      startOfDay(line.at) >= startOfDay(change.fromTakenAt) &&
      startOfDay(line.at) <= change.toTakenAt,
  );
}

/** 1件だけで金額がぴたりと合う明細。同額が2件あればどちらとも言えないので選ばない */
function singleMatch(placed: PlacedStatement[], change: BalanceChange): PlacedStatement[] {
  const exact = freeLines(placed, change).filter(
    (line) => line.statement.amount === change.externalDelta,
  );
  return exact.length === 1 ? exact : [];
}

/** 区間内の同じ向きの明細を合わせてちょうど説明できるなら、その全部 */
function summedMatch(placed: PlacedStatement[], change: BalanceChange): PlacedStatement[] {
  const lines = freeLines(placed, change).filter((line) =>
    sameSign(line.statement.amount, change.externalDelta),
  );
  const total = lines.reduce((sum, line) => sum + line.statement.amount, 0);
  return lines.length > 0 && total === change.externalDelta ? lines : [];
}

/**
 * 代表口座の明細と、つかいわけ口座の残高変動を突き合わせて、説明が付いた
 * 残高変動を返す。突き合わせた明細には口座を書き込む(引数を書き換える)。
 *
 * 代表口座(円普通預金)の残高はつかいわけ口座の合計なので、代表口座に残高が
 * 動く取引は必ずどれかのつかいわけ口座の残高も同じだけ動かす。突き合わせずに
 * 並べると、ひとつの出来事が明細としても残高変動としても出て二重に見える。
 *
 * 残すのは明細の側。日付・金額・摘要を1件ずつ持っており、スナップショット間隔が
 * 空いて合算された残高変動より情報が多い。代わりに明細が持たない口座を、
 * 突き合わせた相手から補う。
 *
 * 1件で説明が付くものを先に取り、残りを合算で見る。対応が読み切れないものは
 * 畳まない。取り込めていない入出金や、複数口座の動きが同じ区間に重なった場合を、
 * 隠して無かったことにはしない
 */
function foldExplained(changes: BalanceChange[], placed: PlacedStatement[]): Set<BalanceChange> {
  const folded = new Set<BalanceChange>();
  for (const match of [singleMatch, summedMatch]) {
    for (const change of changes.filter((candidate) => !folded.has(candidate))) {
      const lines = match(placed, change);
      for (const line of lines) {
        line.account = { accountId: change.accountId, accountName: change.accountName };
      }
      if (lines.length > 0) {
        folded.add(change);
      }
    }
  }
  return folded;
}

export function logEntries(input: LogInput): LogEntry[] {
  const changes = detectBalanceChanges(input.snapshots, input.transfers).filter(
    (change) => change.externalDelta !== 0,
  );
  const placed = placeStatements(input);
  const folded = foldExplained(changes, placed);

  const entries: LogEntry[] = [
    ...input.transfers.map(
      (tr): LogEntry => ({ kind: "transfer", at: tr.transferredAt, transfer: tr }),
    ),
    ...changes
      .filter((change) => !folded.has(change))
      .map((change): LogEntry => ({ kind: "external", at: change.toTakenAt, change })),
    ...placed.map(
      ({ statement, at, account }): LogEntry => ({ kind: "statement", at, statement, account }),
    ),
    ...input.snapshots.map((sn) => snapshotEntry(sn)),
  ];
  return entries.toSorted((left, right) => right.at - left.at || logRank(left) - logRank(right));
}
