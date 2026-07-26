import { commentText, transferCommentKey } from "../domain/comments.ts";
import { sortStatementsDesc, statementCommentKey } from "../domain/statement.ts";
import type { Comments } from "../domain/comments.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { TransferRecord } from "../domain/ledger.ts";
import { formatDateTime } from "./format.ts";
import { sortTransfersDesc } from "../domain/ledger.ts";

function csvField(value: string): string {
  return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvRow(transfer: TransferRecord, comments: Comments): string {
  return [
    formatDateTime(transfer.transferredAt),
    transfer.from.name,
    transfer.to.name,
    String(transfer.amount),
    commentText(comments, transferCommentKey(transfer)),
  ]
    .map((field) => csvField(field))
    .join(",");
}

/** 家計簿ソフトなどへの取り込み用CSV。金額は数値のまま出す */
export function transfersCsv(transfers: TransferRecord[], comments: Comments): string {
  const rows = sortTransfersDesc(transfers).map((transfer) => csvRow(transfer, comments));
  // ExcelがUTF-8として認識できるようBOMを付ける
  return `﻿${["日時,出金口座,入金口座,金額,コメント", ...rows].join("\r\n")}\r\n`;
}

function statementCsvRow(statement: StatementEntry, comments: Comments): string {
  return [
    statement.valueDate,
    statement.remark,
    String(statement.amount),
    String(statement.balance),
    commentText(comments, statementCommentKey(statement)),
  ]
    .map((field) => csvField(field))
    .join(",");
}

/** 代表口座の入出金明細のCSV。金額は入金が正、出金が負の数値のまま出す */
export function statementsCsv(statements: StatementEntry[], comments: Comments): string {
  const rows = sortStatementsDesc(statements).map((statement) =>
    statementCsvRow(statement, comments),
  );
  return `﻿${["日付,摘要,金額,残高,コメント", ...rows].join("\r\n")}\r\n`;
}
