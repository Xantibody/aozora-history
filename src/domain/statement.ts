/**
 * 代表口座(普通預金)の入出金明細1件。振込・給与など、つかいわけ口座の
 * 内訳では見えない外部との入出金を銀行のAPIからそのまま持ってくる
 */
export interface StatementEntry {
  /** 銀行が採番する明細番号 */
  entryNumber: string;
  /** 起算日 (yyyy-MM-dd) */
  valueDate: string;
  /** 入金は正、出金は負 */
  amount: number;
  /** 取引後の残高 */
  balance: number;
  /** 摘要(振込元名・給与など) */
  remark: string;
}

/** 明細の同一性を表すキー。明細番号は日付ごとの採番のため日付と組にする */
export function statementKey(statement: StatementEntry): string {
  return `${statement.valueDate}:${statement.entryNumber}`;
}

/** コメント紐付け用の安定キー */
export function statementCommentKey(statement: StatementEntry): string {
  return `statement:${statementKey(statement)}`;
}

function compareAsc(left: StatementEntry, right: StatementEntry): number {
  return (
    left.valueDate.localeCompare(right.valueDate) ||
    left.entryNumber.localeCompare(right.entryNumber)
  );
}

/** 新しい順(同日は明細番号の大きい順)に並べる */
export function sortStatementsDesc(statements: StatementEntry[]): StatementEntry[] {
  return statements.toSorted((left, right) => compareAsc(right, left));
}

/** 同じ明細は1件にまとめる。後から渡した方(取得が新しい方)を採用する */
export function mergeStatements(
  existing: StatementEntry[],
  incoming: StatementEntry[],
): StatementEntry[] {
  const byKey = new Map<string, StatementEntry>();
  for (const statement of [...existing, ...incoming]) {
    byKey.set(statementKey(statement), statement);
  }
  return [...byKey.values()].toSorted((left, right) => compareAsc(left, right));
}
