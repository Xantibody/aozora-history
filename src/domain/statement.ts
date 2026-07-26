/**
 * 入出金明細1件。振込・給与・自動引落など、残高スナップショットの差分では
 * 「いつ何がいくら動いたか」まで分からない入出金を銀行のAPIからそのまま持ってくる
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
  /**
   * つかいわけ口座の明細ならその口座ID。代表口座(普通預金)の明細には付かない。
   * 省略可なのは、口座別明細を取り込む前に保存した記録をそのまま読めるようにするため
   */
  accountId?: string;
}

/** 口座別明細のキーに付ける接頭辞。代表口座の明細のキーは変えない(既存のコメントの紐付けを保つ) */
function scopeOf(statement: StatementEntry): string {
  return statement.accountId === undefined ? "" : `sp:${statement.accountId}:`;
}

/** 明細の同一性を表すキー。明細番号は口座ごと・日付ごとの採番のため両方と組にする */
export function statementKey(statement: StatementEntry): string {
  return `${scopeOf(statement)}${statement.valueDate}:${statement.entryNumber}`;
}

/** 代表口座(普通預金)の明細だけを取り出す */
export function primaryStatements(statements: StatementEntry[]): StatementEntry[] {
  return statements.filter((statement) => statement.accountId === undefined);
}

/** 指定したつかいわけ口座の明細だけを取り出す */
export function accountStatements(
  statements: StatementEntry[],
  accountId: string,
): StatementEntry[] {
  return statements.filter((statement) => statement.accountId === accountId);
}

/** コメント紐付け用の安定キー */
export function statementCommentKey(statement: StatementEntry): string {
  return `statement:${statementKey(statement)}`;
}

/**
 * 明細番号の大小。代表口座は "0001" のようにゼロ埋めされるが、つかいわけ口座は
 * 埋められていない。文字列のまま比べると "9" が "10" より後になり、
 * 最新の明細を取り違えるため、数値として読めるときは数値で比べる
 */
function compareEntryNumber(left: string, right: string): number {
  const [leftValue, rightValue] = [Number(left), Number(right)];
  const numeric =
    left !== "" && right !== "" && Number.isFinite(leftValue) && Number.isFinite(rightValue);
  return numeric ? leftValue - rightValue : left.localeCompare(right);
}

function compareAsc(left: StatementEntry, right: StatementEntry): number {
  return (
    left.valueDate.localeCompare(right.valueDate) ||
    compareEntryNumber(left.entryNumber, right.entryNumber) ||
    scopeOf(left).localeCompare(scopeOf(right))
  );
}

/** 新しい順(同日は明細番号の大きい順)に並べる */
export function sortStatementsDesc(statements: StatementEntry[]): StatementEntry[] {
  return statements.toSorted((left, right) => compareAsc(right, left));
}

/**
 * 明細の最新の残高が、その口座の残高と一致するか。
 *
 * つかいわけ口座の明細を取る画面は銀行サイトのメニューからの動線が公開されて
 * おらず、いつ仕様が変わっても不思議はない。口座の指定が効かなくなって別口座や
 * 全口座の明細が返るようになっても気づけるよう、取り込む前にこの検算を通し、
 * 合わない明細は捨てて台帳を汚さないようにする
 */
export function statementsExplainBalance(statements: StatementEntry[], balance: number): boolean {
  const [latest] = sortStatementsDesc(statements);
  return latest !== undefined && latest.balance === balance;
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
