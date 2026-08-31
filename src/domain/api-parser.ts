import type { AccountsSnapshot, SubAccount } from "./parser.ts";
import type { AutoTransferSetting } from "./auto-transfer.ts";
import type { RegularTransferSetting } from "./regular-transfer.ts";
import type { StatementEntry } from "./statement.ts";

/**
 * 銀行サイトが内部で使っているJSON API のレスポンスを、この拡張の記録に変換する。
 * ページのDOMを読むのと違い、口座一覧を開かなくても残高を取れる
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * APIは金額を文字列で返すことがある。桁区切りが混ざっていても読めるようにする。
 * 円でも "304000.0" のように小数部が付いて返ることがあるため受け付ける
 */
function toAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replaceAll(",", "").trim();
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

/**
 * 起算日は yyyyMMdd で返るが、区切り付きで返っても読めるようにする。
 * 時刻が続く形で返ることもあるため、日付から先は見ない
 */
const DATE_PATTERN = /^(?<year>\d{4})[-/]?(?<month>\d{2})[-/]?(?<day>\d{2})(?:[T\s].*)?$/u;

function toIsoDate(value: unknown): string | null {
  const text = toText(value)?.trim();
  if (text === undefined) {
    return null;
  }
  const groups = DATE_PATTERN.exec(text)?.groups;
  if (groups === undefined) {
    return null;
  }
  return `${groups.year}-${groups.month}-${groups.day}`;
}

function toAccount(value: unknown): SubAccount | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toText(value.spAccountId);
  const name = toText(value.spAccountName);
  // 残高の項目名はエンドポイントによって違う
  const balance = toAmount(value.totalBalance ?? value.balance);
  if (id === null || name === null || balance === null) {
    return null;
  }
  return { id, name, balance };
}

function toAccounts(list: unknown[]): SubAccount[] | null {
  const accounts: SubAccount[] = [];
  for (const item of list) {
    const account = toAccount(item);
    if (account === null) {
      return null;
    }
    accounts.push(account);
  }
  return accounts;
}

/**
 * GET /v1/balances/sp-accounts のレスポンス。取れなければnull。
 * 口座一覧のキーは `account`。つかいわけ口座トップ(sp-accounts/top)は
 * 同じ内容を `spAccountBalanceDetailsList` で返すため、どちらも読めるようにする
 */
export function parseSpAccountBalances(json: unknown): AccountsSnapshot | null {
  if (!isRecord(json)) {
    return null;
  }
  const list = json.account ?? json.spAccountBalanceDetailsList;
  if (!Array.isArray(list)) {
    return null;
  }
  const accounts = toAccounts(list);
  // 空配列は「つかいわけ口座を使っていない」か取得に失敗した状態。
  // 残高0件のスナップショットを残すと変動の計算が壊れるため記録しない
  if (accounts === null || accounts.length === 0) {
    return null;
  }
  return { accounts, updatedAt: toText(json.queryDatetime) };
}

/** 入金を表す creditDebitType のコード。これ以外は出金として扱う */
const CREDIT = "1";

/**
 * 明細1件。代表口座とつかいわけ口座で項目名が違うため、どちらも読む。
 *
 *   代表口座        accountEntryNumber   / valueDate
 *   つかいわけ口座   spAccountStatementId / transactionDate
 */
function toStatement(value: unknown): StatementEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const entryNumber = toText(value.accountEntryNumber ?? value.spAccountStatementId);
  const valueDate = toIsoDate(value.valueDate ?? value.transactionDate);
  const magnitude = toAmount(value.amount);
  const balance = toAmount(value.balance);
  if (entryNumber === null || valueDate === null || magnitude === null || balance === null) {
    return null;
  }
  // 金額は絶対値、入出金の別はcreditDebitTypeで返る。負号は符号に畳み込む
  const sign = toText(value.creditDebitType) === CREDIT ? 1 : -1;
  return {
    entryNumber,
    valueDate,
    amount: sign * Math.abs(magnitude),
    balance,
    remark: (toText(value.remark) ?? "").trim(),
  };
}

/** 明細の一覧。項目名と同じく、キーも口座の種類で違う */
function statementList(json: unknown): unknown[] | null {
  if (!isRecord(json)) {
    return null;
  }
  const list = json.statementList ?? json.spAccountStatementList;
  return Array.isArray(list) ? list : null;
}

/** GET /v1/ordinary-deposits/statement のレスポンス。取れなければnull */
export function parseOrdinaryStatement(json: unknown): StatementEntry[] | null {
  const list = statementList(json);
  if (list === null) {
    return null;
  }
  const entries: StatementEntry[] = [];
  for (const item of list) {
    const entry = toStatement(item);
    if (entry === null) {
      return null;
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * GET /v1/sp-accounts/ordinary-deposits-statement のレスポンス。
 * 形は代表口座版と同じで、どの口座の明細かはリクエスト側でしか分からないため付け直す
 */
export function parseSpAccountStatement(json: unknown, accountId: string): StatementEntry[] | null {
  const entries = parseOrdinaryStatement(json);
  if (entries === null) {
    return null;
  }
  const scoped: StatementEntry[] = [];
  for (const entry of entries) {
    scoped.push({ ...entry, accountId });
  }
  return scoped;
}

function toAutoTransfer(value: unknown): AutoTransferSetting | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toText(value.spAutoTransferId);
  const fromId = toText(value.debitSpAccountId);
  const toId = toText(value.creditSpAccountId);
  const amount = toAmount(value.amount);
  if (id === null || fromId === null || toId === null || amount === null) {
    return null;
  }
  return {
    id,
    from: { id: fromId, name: toText(value.debitSpAccountName) ?? "" },
    to: { id: toId, name: toText(value.creditSpAccountName) ?? "" },
    amount,
  };
}

/** 契約中を表す contractStatus のコード。2=一時休止 3=強制休止 4=解約 */
const CONTRACT_ACTIVE = "1";

function toRegularTransfer(value: unknown): RegularTransferSetting | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toText(value.regularlyTransferContractId);
  const payeeName = toText(value.creditPayeeNameKana);
  const amount = toAmount(value.transferAmount);
  if (id === null || payeeName === null || amount === null) {
    return null;
  }
  return {
    id,
    payeeName,
    bankName: toText(value.creditBankName) ?? "",
    amount,
    active: toText(value.contractStatus) === CONTRACT_ACTIVE,
    // グループは任意。付けていない契約でも取り込めるようにする
    groupName: toText(value.groupName) ?? "",
  };
}

/** GET /v1/transfers/regularly-contracts のレスポンス。取れなければnull */
export function parseRegularTransfers(json: unknown): RegularTransferSetting[] | null {
  if (!isRecord(json) || !Array.isArray(json.regularlyTransferContractList)) {
    return null;
  }
  const settings: RegularTransferSetting[] = [];
  for (const item of json.regularlyTransferContractList) {
    const setting = toRegularTransfer(item);
    if (setting === null) {
      return null;
    }
    settings.push(setting);
  }
  return settings;
}

/** GET /v1/sp-accounts/auto-transfer のレスポンス。取れなければnull */
export function parseAutoTransfers(json: unknown): AutoTransferSetting[] | null {
  if (!isRecord(json) || !Array.isArray(json.spAccountAutoTransferList)) {
    return null;
  }
  const settings: AutoTransferSetting[] = [];
  for (const item of json.spAccountAutoTransferList) {
    const setting = toAutoTransfer(item);
    if (setting === null) {
      return null;
    }
    settings.push(setting);
  }
  return settings;
}
