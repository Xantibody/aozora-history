import type { BalanceChange, BalanceSnapshot, TransferRecord } from "./ledger.ts";
import type { StatementEntry } from "./statement.ts";
import type { TranMapping } from "./tran-mapping.ts";
import { detectBalanceChanges } from "./ledger.ts";
import { mappedAccount } from "./tran-mapping.ts";
import { primaryStatements } from "./statement.ts";

/** その明細を、どのつかいわけ口座の動きとして読むか */
interface StatementScope {
  accountId: string;
  accountName: string;
}

/** その取引の前後で、口座の残高がいくらからいくらになったか */
export interface AccountBalance {
  before: number;
  after: number;
}

/**
 * カードログの1行。振替・外部入出金・代表口座の明細・残高記録のいずれか。
 *
 * 代表口座の明細を別のタブに分けていたときは、同じ日のお金の動きを見るのに
 * 画面を行き来する必要があった。口座が違うだけで起きたことは同じなので、
 * ひとつの時系列に並べる
 */
export type LogEntry =
  | {
      kind: "transfer";
      at: number;
      transfer: TransferRecord;
      balances: { from?: AccountBalance; to?: AccountBalance };
    }
  | { kind: "external"; at: number; change: BalanceChange }
  | {
      kind: "statement";
      at: number;
      statement: StatementEntry;
      account?: StatementScope;
      balance?: AccountBalance;
    }
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
  /**
   * 取り込んだ明細すべて。行として並べるのは代表口座の明細だけで、
   * つかいわけ口座の明細は代表口座の明細がどの口座の動きかを読むのに使う
   */
  statements: StatementEntry[];
  /** 明細は起算日しか持たないため、その日のどの時刻に置くかは呼び出し側が決める */
  placeAt: (valueDate: string) => number | null;
  /** つかいわけ口座の入出金の設定。取り込めていなければ無い */
  tranMapping?: TranMapping | null;
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
  /** 残高変動のどれかを説明済みか。口座が先に分かっていても、残高変動との対応は別に持つ */
  bound: boolean;
  /** 入出金の設定のとおりなら受けたはずの口座。決め手にだけ使う */
  mapped: string | null;
}

/** 口座IDから口座名を引く。名前は変えられるので、新しいスナップショットのものを採る */
function accountNames(snapshots: BalanceSnapshot[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const snapshot of snapshots.toSorted((left, right) => left.takenAt - right.takenAt)) {
    for (const account of snapshot.accounts) {
      names.set(account.id, account.name);
    }
  }
  return names;
}

/** 口座別明細が指す口座がちょうど1つなら、その口座ID */
function soleAccount(statements: StatementEntry[]): string | null {
  const accounts = new Set(statements.flatMap((line) => line.accountId ?? []));
  const [accountId] = accounts;
  return accounts.size === 1 && accountId !== undefined ? accountId : null;
}

/**
 * 代表口座の明細と同じ出来事を記録した、つかいわけ口座の明細の口座。
 *
 * 代表口座の残高はつかいわけ口座の合計なので、代表口座の明細1件には必ず
 * どれかの口座の明細が同じ日・同じ金額で対になる。残高変動との突き合わせと違い、
 * スナップショットの間隔に左右されない。
 *
 * 同じ日・同じ金額が複数の口座にあれば摘要の一致で絞る。それでも決まらなければ、
 * 入出金の設定が指す口座がその中にあるときだけそれを採る。設定は今のものしか
 * 取れないため、口座別明細に裏付けの無い口座は採らない(推測で別の口座の動きにしない)
 */
function accountFromStatements(
  statement: StatementEntry,
  statements: StatementEntry[],
  mapped: string | null,
): string | null {
  const pairs = statements.filter(
    (line) => line.valueDate === statement.valueDate && line.amount === statement.amount,
  );
  const sameRemark = pairs.filter((line) => line.remark === statement.remark);
  const confirmed = pairs.some((line) => line.accountId === mapped) ? mapped : null;
  return soleAccount(pairs) ?? soleAccount(sameRemark) ?? confirmed;
}

function placeStatements(input: LogInput): PlacedStatement[] {
  const names = accountNames(input.snapshots);
  const placed: PlacedStatement[] = [];
  for (const statement of primaryStatements(input.statements)) {
    const at = input.placeAt(statement.valueDate);
    if (at !== null) {
      const mapped =
        input.tranMapping === undefined || input.tranMapping === null
          ? null
          : mappedAccount(input.tranMapping, statement);
      const accountId = accountFromStatements(statement, input.statements, mapped);
      const account =
        accountId === null
          ? undefined
          : { accountId, accountName: names.get(accountId) ?? accountId };
      placed.push({ statement, at, account, bound: false, mapped });
    }
  }
  return placed;
}

const sameSign = (left: number, right: number): boolean => left > 0 === right > 0;

/**
 * その残高変動の区間にあって、まだどの残高変動にも結び付いていない明細。
 * 口座別明細で口座が分かっている明細は、その口座の残高変動にだけ結び付ける。
 *
 * 見るのは置いた時刻ではなく起算日。並びを整えるために日の終わりへ寄せても、
 * どの残高変動を説明する明細かという読みは変わらないため
 */
function freeLines(placed: PlacedStatement[], change: BalanceChange): PlacedStatement[] {
  return placed.filter(
    (line) =>
      !line.bound &&
      (line.account === undefined || line.account.accountId === change.accountId) &&
      startOfDay(line.at) >= startOfDay(change.fromTakenAt) &&
      startOfDay(line.at) <= change.toTakenAt,
  );
}

/**
 * 1件だけで金額がぴたりと合う明細。同額が2件あれば、入出金の設定がこの口座を
 * 指す明細が1件に絞れるときだけそれを選び、絞れなければどちらとも言えないので選ばない
 */
function singleMatch(placed: PlacedStatement[], change: BalanceChange): PlacedStatement[] {
  const exact = freeLines(placed, change).filter(
    (line) => line.statement.amount === change.externalDelta,
  );
  if (exact.length === 1) {
    return exact;
  }
  const mapped = exact.filter((line) => line.mapped === change.accountId);
  return mapped.length === 1 ? mapped : [];
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
        line.account ??= { accountId: change.accountId, accountName: change.accountName };
        line.bound = true;
      }
      if (lines.length > 0) {
        folded.add(change);
      }
    }
  }
  return folded;
}

/**
 * 口座別明細から読む、その取引の前後の口座残高。
 *
 * 残高記録(スナップショット)は取った時点の値しか持たず、あいだに取引が
 * 重なると途中の残高が分からない。口座別明細は1件ごとに取引後の残高を持つ。
 * 同じ日・同じ金額が同じ口座に2件あると、どちらの残高か決められないので出さない
 */
function balanceFrom(
  statements: StatementEntry[],
  accountId: string,
  movement: { valueDate: string; amount: number },
): AccountBalance | undefined {
  const lines = statements.filter(
    (line) =>
      line.accountId === accountId &&
      line.valueDate === movement.valueDate &&
      line.amount === movement.amount,
  );
  const [line] = lines;
  return lines.length === 1 && line !== undefined
    ? { before: line.balance - line.amount, after: line.balance }
    : undefined;
}

function statementEntry(statements: StatementEntry[], placed: PlacedStatement): LogEntry {
  const { statement, at, account } = placed;
  const balance =
    account === undefined ? undefined : balanceFrom(statements, account.accountId, statement);
  return { kind: "statement", at, statement, account, balance };
}

/** 起算日の月・日の桁数 */
const DATE_PART_WIDTH = 2;

const pad = (value: number): string => String(value).padStart(DATE_PART_WIDTH, "0");

/** 端末の時刻での起算日 (yyyy-MM-dd)。振替の記録時刻を明細の日付に揃える */
function valueDateOf(ms: number): string {
  const date = new Date(ms);
  return [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

function transferEntry(statements: StatementEntry[], transfer: TransferRecord): LogEntry {
  const valueDate = valueDateOf(transfer.transferredAt);
  const balances = {
    from: balanceFrom(statements, transfer.from.id, { valueDate, amount: -transfer.amount }),
    to: balanceFrom(statements, transfer.to.id, { valueDate, amount: transfer.amount }),
  };
  return { kind: "transfer", at: transfer.transferredAt, transfer, balances };
}

export function logEntries(input: LogInput): LogEntry[] {
  const changes = detectBalanceChanges(input.snapshots, input.transfers).filter(
    (change) => change.externalDelta !== 0,
  );
  const placed = placeStatements(input);
  const folded = foldExplained(changes, placed);

  const entries: LogEntry[] = [
    ...input.transfers.map((transfer) => transferEntry(input.statements, transfer)),
    ...changes
      .filter((change) => !folded.has(change))
      .map((change): LogEntry => ({ kind: "external", at: change.toTakenAt, change })),
    ...placed.map((line) => statementEntry(input.statements, line)),
    ...input.snapshots.map((sn) => snapshotEntry(sn)),
  ];
  return entries.toSorted((left, right) => right.at - left.at || logRank(left) - logRank(right));
}
