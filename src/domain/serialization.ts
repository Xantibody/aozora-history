import type { BalanceSnapshot, CommentEntry, Comments, TransferRecord } from "./ledger.ts";
import type { LedgerData } from "./merge.ts";
import type { AccountRef, SubAccount } from "./parser.ts";

class FormatError extends Error {
  constructor(section: string) {
    super(`${section}の形式が正しくありません`);
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
    accounts: value.accounts.map(parseAccount),
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

function parseCommentEntry(value: unknown): CommentEntry {
  // tombstone化以前のエクスポート・R2オブジェクトはコメントが文字列
  if (typeof value === "string") return { text: value, updatedAt: 0 };
  if (isRecord(value) && typeof value.text === "string" && typeof value.updatedAt === "number") {
    return { text: value.text, updatedAt: value.updatedAt };
  }
  throw new FormatError("コメント");
}

function parseComments(value: unknown): Comments {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new FormatError("コメント");
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, parseCommentEntry(entry)]),
  );
}

/** R2オブジェクト・エクスポートファイルと同じ形式のJSONを検証しつつ読み込む */
export function parseLedgerJson(text: string): LedgerData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み込めませんでした");
  }
  if (!isRecord(parsed)) throw new FormatError("データ全体");

  const snapshots = parsed.snapshots === undefined ? [] : parsed.snapshots;
  const transfers = parsed.transfers === undefined ? [] : parsed.transfers;
  if (!Array.isArray(snapshots)) throw new FormatError("スナップショット");
  if (!Array.isArray(transfers)) throw new FormatError("振替");

  return {
    snapshots: snapshots.map(parseSnapshot),
    transfers: transfers.map(parseTransfer),
    comments: parseComments(parsed.comments),
  };
}
