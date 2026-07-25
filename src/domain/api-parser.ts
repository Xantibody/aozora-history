import type { StatementEntry } from "./ledger.ts";
import type { AccountsSnapshot, SubAccount } from "./parser.ts";

/**
 * 銀行サイトが内部で使っているJSON API のレスポンスを、この拡張の記録に変換する。
 * ページのDOMを読むのと違い、口座一覧を開かなくても残高を取れる
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** APIは金額を文字列で返すことがある。桁区切りが混ざっていても読めるようにする */
function toAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  return Number(normalized);
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** 起算日は yyyyMMdd で返るが、区切り付きで返っても読めるようにする */
function toIsoDate(value: unknown): string | null {
  const text = toText(value)?.trim();
  if (text === undefined) return null;
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(text);
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** GET /v1/balances/sp-accounts のレスポンス。取れなければnull */
export function parseSpAccountBalances(json: unknown): AccountsSnapshot | null {
  if (!isRecord(json) || !Array.isArray(json.spAccountBalanceDetailsList)) return null;

  const accounts: SubAccount[] = [];
  for (const item of json.spAccountBalanceDetailsList) {
    if (!isRecord(item)) return null;
    const id = toText(item.spAccountId);
    const name = toText(item.spAccountName);
    const balance = toAmount(item.totalBalance);
    if (id === null || name === null || balance === null) return null;
    accounts.push({ id, name, balance });
  }
  // 空配列は「つかいわけ口座を使っていない」か取得に失敗した状態。
  // 残高0件のスナップショットを残すと変動の計算が壊れるため記録しない
  if (accounts.length === 0) return null;

  return { accounts, updatedAt: toText(json.queryDatetime) };
}

/** 入金 / 出金 を表す creditDebitType のコード */
const CREDIT = "1";

/** GET /v1/ordinary-deposits/statement のレスポンス。取れなければnull */
export function parseOrdinaryStatement(json: unknown): StatementEntry[] | null {
  if (!isRecord(json) || !Array.isArray(json.statementList)) return null;

  const entries: StatementEntry[] = [];
  for (const item of json.statementList) {
    if (!isRecord(item)) return null;
    const entryNumber = toText(item.accountEntryNumber);
    const valueDate = toIsoDate(item.valueDate);
    const magnitude = toAmount(item.amount);
    const balance = toAmount(item.balance);
    if (entryNumber === null || valueDate === null || magnitude === null || balance === null) {
      return null;
    }
    // 金額は絶対値、入出金の別はcreditDebitTypeで返る。負号は符号に畳み込む
    const sign = toText(item.creditDebitType) === CREDIT ? 1 : -1;
    entries.push({
      entryNumber,
      valueDate,
      amount: sign * Math.abs(magnitude),
      balance,
      remark: (toText(item.remark) ?? "").trim(),
    });
  }
  return entries;
}
