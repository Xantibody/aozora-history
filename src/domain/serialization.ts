import type { AccountRef, SubAccount } from "./parser.ts";
import type { BalanceSnapshot, CommentEntry, Comments, TransferRecord } from "./ledger.ts";
import type { LedgerData } from "./merge.ts";
import type { StatementEntry } from "./statement.ts";

class FormatError extends Error {
  public constructor(section: string) {
    super(`${section}の形式が正しくありません`);
    this.name = "FormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAccount(value: unknown): SubAccount {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.balance !== "number"
  ) {
    throw new FormatError("口座");
  }
  return { id: value.id, name: value.name, balance: value.balance };
}

function parseSnapshot(value: unknown): BalanceSnapshot {
  if (!isRecord(value) || typeof value.takenAt !== "number" || !Array.isArray(value.accounts)) {
    throw new FormatError("スナップショット");
  }
  return {
    takenAt: value.takenAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    accounts: value.accounts.map((account) => parseAccount(account)),
  };
}

function parseAccountRef(value: unknown): AccountRef {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    throw new FormatError("振替");
  }
  return { id: value.id, name: value.name };
}

function parseTransfer(value: unknown): TransferRecord {
  if (
    !isRecord(value) ||
    typeof value.transferredAt !== "number" ||
    typeof value.amount !== "number"
  ) {
    throw new FormatError("振替");
  }
  return {
    transferredAt: value.transferredAt,
    from: parseAccountRef(value.from),
    to: parseAccountRef(value.to),
    amount: value.amount,
  };
}

function parseStatement(value: unknown): StatementEntry {
  if (
    !isRecord(value) ||
    typeof value.entryNumber !== "string" ||
    typeof value.valueDate !== "string" ||
    typeof value.amount !== "number" ||
    typeof value.balance !== "number"
  ) {
    throw new FormatError("入出金明細");
  }
  return {
    entryNumber: value.entryNumber,
    valueDate: value.valueDate,
    amount: value.amount,
    balance: value.balance,
    remark: typeof value.remark === "string" ? value.remark : "",
  };
}

function parseCommentEntry(value: unknown): CommentEntry {
  // tombstone化以前のエクスポート・R2オブジェクトはコメントが文字列
  if (typeof value === "string") {
    return { text: value, updatedAt: 0 };
  }
  if (isRecord(value) && typeof value.text === "string" && typeof value.updatedAt === "number") {
    return { text: value.text, updatedAt: value.updatedAt };
  }
  throw new FormatError("コメント");
}

function parseComments(value: unknown): Comments {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new FormatError("コメント");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, parseCommentEntry(entry)]),
  );
}

function parseDeletions(value: unknown): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new FormatError("削除の記録");
  }
  for (const deletedAt of Object.values(value)) {
    if (typeof deletedAt !== "number") {
      throw new FormatError("削除の記録");
    }
  }
  return value as Record<string, number>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み込めませんでした");
  }
}

/** 未定義のセクションは空配列として扱う。古い形式のファイルも読めるようにするため */
function parseSection(value: unknown, section: string): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new FormatError(section);
  }
  return value;
}

/** R2オブジェクト・エクスポートファイルと同じ形式のJSONを検証しつつ読み込む */
export function parseLedgerJson(text: string): LedgerData {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) {
    throw new FormatError("データ全体");
  }
  const snapshots = parseSection(parsed.snapshots, "スナップショット");
  const transfers = parseSection(parsed.transfers, "振替");
  const statements = parseSection(parsed.statements, "入出金明細");
  return {
    snapshots: snapshots.map((snapshot) => parseSnapshot(snapshot)),
    transfers: transfers.map((transfer) => parseTransfer(transfer)),
    statements: statements.map((statement) => parseStatement(statement)),
    comments: parseComments(parsed.comments),
    deletions: parseDeletions(parsed.deletions),
  };
}
