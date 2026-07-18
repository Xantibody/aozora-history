import type { Comments, TransferRecord } from "../domain/ledger.ts";
import { commentText, sortTransfersDesc, transferCommentKey } from "../domain/ledger.ts";
import { formatDateTime } from "./format.ts";

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
