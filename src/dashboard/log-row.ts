import { BORDER, INK, INK_DECOR, INK_SOFT, INK_WEAK, SURFACE, el } from "./dom.ts";
import { attachSwipeDelete, confirmDeleteTransfer, transferDetail } from "./swipe-delete.ts";
import { commentKeyOf, memoField } from "./memo-field.ts";
import { formatSigned, formatTime, formatYen } from "./format.ts";
import type { LogEntry } from "../domain/log.ts";
import type { MemoField } from "./memo-field.ts";
import type { RenderContext } from "./context.ts";
import type { SwipeHandle } from "./swipe-delete.ts";
import type { TransferRecord } from "../domain/ledger.ts";
import { icon } from "./icons.ts";
import { isDetected } from "../domain/reconcile.ts";
import { logTitle } from "./log-title.ts";

export type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" | "statement" }>;

/** 行の文字より一回り小さくして、主役である取引の内容に譲る */
const DELETE_ICON_SIZE = 15;

/** 誤記録(確認後のキャンセルなど)を取り除くための削除ボタン(デスクトップはホバーで表示) */
function deleteButton(ctx: RenderContext, transfer: TransferRecord): HTMLElement {
  const button = el(
    "button",
    `delete-transfer flex w-[18px] shrink-0 cursor-pointer items-center justify-center rounded ${INK_DECOR} ` +
      "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 " +
      "hover:text-[#0f172a] focus-visible:opacity-100 focus-visible:outline-2 " +
      "focus-visible:outline-offset-2 focus-visible:outline-sky-500 max-sm:hidden dark:hover:text-[#e6ecf3]",
  );
  button.append(icon("x", DELETE_ICON_SIZE));
  const detail = transferDetail(transfer);
  button.title = "この振替を削除";
  button.setAttribute("aria-label", `振替を削除: ${detail}`);
  button.addEventListener("click", () => {
    confirmDeleteTransfer(ctx, transfer, detail);
  });
  return button;
}

// 可変幅だと桁数で右端がずれるため、固定幅で右揃えにする
const AMOUNT =
  "amount w-[104px] shrink-0 text-right text-base font-bold tabular-nums sm:w-[120px] sm:text-[17px]";

/** 極性は符号とインクの濃淡で示す。色で意味を持つのは口座色だけ */
function signedAmount(amount: number): HTMLElement {
  return el("span", `${AMOUNT} ${amount > 0 ? INK : INK_SOFT}`, formatSigned(amount));
}

function transactionAmount(entry: TransactionEntry): HTMLElement {
  if (entry.kind === "transfer") {
    return el("span", `${AMOUNT} ${INK}`, formatYen(entry.transfer.amount));
  }
  return signedAmount(
    entry.kind === "statement" ? entry.statement.amount : entry.change.externalDelta,
  );
}

/**
 * 行末の削除ボタン列。外部入出金と、差額から拾い直した振替は消しても
 * 残高から作り直されるだけなので、同じ幅のスペーサーで右端を揃える
 */
function trailingColumn(ctx: RenderContext, entry: TransactionEntry): HTMLElement {
  if (entry.kind === "transfer" && !isDetected(ctx.ledger, entry.transfer)) {
    return deleteButton(ctx, entry.transfer);
  }
  return el("span", "delete-spacer w-[18px] shrink-0 max-sm:hidden");
}

/**
 * 時刻。銀行APIから取り込んだ明細は起算日しか持たない。時系列に混ぜるために
 * 日の終わりへ寄せているが、その 23:59 は記録された時刻ではないので出さない。
 * 出すと、その日の入出金が揃って深夜に起きたように読める
 */
function timeCell(cls: string, entry: TransactionEntry): HTMLElement {
  if (entry.kind !== "statement") {
    return el("span", cls, formatTime(entry.at));
  }
  const unknown = el("span", cls);
  unknown.append("–", el("span", "sr-only", "時刻の記録なし"));
  unknown.title = "銀行の明細は起算日だけを持ちます";
  return unknown;
}

/**
 * 2段目。狭い幅では時刻を左の固定列から外してここへ回す。
 * 44pxの列を空けるだけで口座名に使える幅がはっきり増える
 */
function memoRow(memo: MemoField, entry: TransactionEntry): HTMLElement {
  const row = el("div", "flex items-baseline justify-between gap-3");
  row.append(
    memo.field,
    timeCell(`time-inline shrink-0 text-xs tabular-nums sm:hidden ${INK_WEAK}`, entry),
  );
  return row;
}

function transactionMain(
  ctx: RenderContext,
  entry: TransactionEntry,
  memo: MemoField,
): HTMLElement {
  const main = el(
    "div",
    "flex items-center gap-3 px-3.5 py-3 sm:gap-[18px] sm:px-[18px] sm:py-[15px]",
  );
  const body = el("div", "flex min-w-0 flex-1 flex-col gap-[5px]");
  body.append(logTitle(ctx, entry), memoRow(memo, entry));
  main.append(
    timeCell(`time w-11 shrink-0 text-xs tabular-nums max-sm:hidden ${INK_WEAK}`, entry),
    body,
    transactionAmount(entry),
    trailingColumn(ctx, entry),
  );
  return main;
}

/** 行のどこを叩いてもメモを書き始められるようにする。削除やスワイプとは競合させない */
function attachMemoOpen(row: HTMLElement, memo: MemoField, swipe: SwipeHandle | null): void {
  row.addEventListener("click", (event) => {
    // スワイプで開いた行のタップは閉じる操作。編集の開始と混ざらないようにする
    if (swipe?.settle() === true) {
      return;
    }
    const { target } = event;
    if (target instanceof Element && target.closest("input,button,a,select") !== null) {
      return;
    }
    memo.open();
  });
}

/** 振替・外部入出金・明細の1件。1取引=1カードにして、行の切れ目を面で示す */
export function transactionRow(ctx: RenderContext, entry: TransactionEntry): HTMLElement {
  const memo = memoField(ctx, commentKeyOf(entry));
  // スワイプ削除のパネルを覆えるよう、行の中身はカードと同じ面に載せて滑らせる
  const slider = el("div", `swipe-slider relative transition-transform duration-150 ${SURFACE}`);
  slider.append(transactionMain(ctx, entry, memo));
  const row = el(
    "div",
    `log-row group relative overflow-hidden rounded-[12px] ${SURFACE} ${BORDER}`,
  );
  row.append(slider);
  const swipe =
    entry.kind === "transfer" && !isDetected(ctx.ledger, entry.transfer)
      ? attachSwipeDelete(ctx, { row, slider }, entry.transfer)
      : null;
  attachMemoOpen(row, memo, swipe);
  return row;
}

/**
 * 残高記録の従属行。取引ではないのでカードにせず、素の1行として
 * カードの間に置く。面を持たないことで従属関係が伝わる
 */
export function snapshotRow(entry: Extract<LogEntry, { kind: "snapshot" }>): HTMLElement {
  const row = el("div", "snapshot-row flex items-center gap-2.5 px-1 py-1.5");
  row.append(
    el(
      "span",
      `badge rounded-[5px] bg-[#dfe4ea] px-[7px] text-[11px] font-bold dark:bg-[#1e2733] ${INK_SOFT}`,
      "記録",
    ),
  );
  const text = el("span", `text-xs ${INK_SOFT}`);
  text.append(`${formatTime(entry.at)} · 残高スナップショット · 合計 `);
  text.append(el("strong", "font-bold tabular-nums", formatYen(entry.total)));
  row.append(text);
  return row;
}
