import { FINE_PRINT, NEGATIVE, POSITIVE, el } from "./dom.ts";
import type { LogEntry, TransferRecord } from "../domain/ledger.ts";
import { attachSwipeDelete, confirmDeleteTransfer, transferDetail } from "./swipe-delete.ts";
import { changeCommentKey, commentText, transferCommentKey } from "../domain/ledger.ts";
import { formatSigned, formatTime, formatYen } from "./format.ts";
import type { RenderContext } from "./context.ts";
import type { SwipeHandle } from "./swipe-delete.ts";
import { commentInput } from "./comment-input.ts";

export type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" }>;

// 左端のアクセントバー。種類が色以外でも読めるよう、本文の矢印表記が向きを担う
const ACCENT = {
  transfer: "bg-sky-600 dark:bg-sky-400",
  in: "bg-emerald-600 dark:bg-emerald-400",
  out: "bg-rose-700 dark:bg-rose-400",
};

function strongName(name: string): HTMLElement {
  return el("strong", "font-semibold", name);
}

function logTitle(entry: TransactionEntry): HTMLElement {
  const title = el("div", "log-title text-[15px] leading-snug");
  if (entry.kind === "transfer") {
    title.append(strongName(entry.transfer.from.name), " → ", strongName(entry.transfer.to.name));
  } else if (entry.change.externalDelta > 0) {
    title.append("外部 → ", strongName(entry.change.accountName));
  } else {
    title.append(strongName(entry.change.accountName), " → 外部");
  }
  return title;
}

/** 誤記録(確認後のキャンセルなど)を取り除くための削除ボタン(デスクトップはホバーで表示) */
function deleteButton(ctx: RenderContext, transfer: TransferRecord): HTMLElement {
  const button = el(
    "button",
    "delete-transfer w-6 shrink-0 cursor-pointer rounded text-slate-400 opacity-0 transition-opacity " +
      "group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-700 " +
      "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 " +
      "max-sm:hidden dark:hover:bg-rose-950 dark:hover:text-rose-400",
    "×",
  );
  const detail = transferDetail(transfer);
  button.title = "この振替を削除";
  button.setAttribute("aria-label", `振替を削除: ${detail}`);
  button.addEventListener("click", () => {
    confirmDeleteTransfer(ctx, transfer, detail);
  });
  return button;
}

function transactionAccent(entry: TransactionEntry): string {
  if (entry.kind === "transfer") {
    return ACCENT.transfer;
  }
  return entry.change.externalDelta > 0 ? ACCENT.in : ACCENT.out;
}

// 可変幅だと後続のコメント欄の位置が桁数分ずれるため、固定幅で右揃えにする
const AMOUNT = "amount w-[120px] shrink-0 text-right text-base font-bold tabular-nums";

function transactionAmount(entry: TransactionEntry): HTMLElement {
  if (entry.kind === "transfer") {
    return el("span", AMOUNT, formatYen(entry.transfer.amount));
  }
  const polarity = entry.change.externalDelta > 0 ? POSITIVE : NEGATIVE;
  return el("span", `${AMOUNT} ${polarity}`, formatSigned(entry.change.externalDelta));
}

/** 行末の削除ボタン列。削除できない外部入出金行は同じ幅のスペーサーで右端を揃える */
function trailingColumn(ctx: RenderContext, entry: TransactionEntry): HTMLElement {
  if (entry.kind === "transfer") {
    return deleteButton(ctx, entry.transfer);
  }
  return el("span", "delete-spacer w-6 shrink-0 max-sm:hidden");
}

function sublineEl(ctx: RenderContext, key: string, at: number): HTMLElement {
  const comment = commentText(ctx.data.comments, key);
  return el(
    "div",
    "subline truncate text-xs text-slate-500 sm:hidden dark:text-slate-400",
    comment === "" ? formatTime(at) : `${formatTime(at)} · ${comment}`,
  );
}

function transactionMain(ctx: RenderContext, key: string, entry: TransactionEntry): HTMLElement {
  const main = el(
    "div",
    "flex min-h-14 items-center gap-3 py-2 pr-3 pl-3.5 sm:min-h-[52px] sm:pl-3",
  );
  // デスクトップは時刻を左の列に出す(モバイルはサブ行)
  main.append(
    el(
      "span",
      "time w-[38px] shrink-0 text-xs tabular-nums text-slate-400 max-sm:hidden",
      formatTime(entry.at),
    ),
  );
  const body = el("div", "min-w-0 flex-1");
  body.append(logTitle(entry), sublineEl(ctx, key, entry.at));
  // デスクトップは常時インラインで編集できる
  const inline = commentInput(ctx, key);
  inline.classList.add("max-sm:hidden", "sm:w-[220px]", "shrink-0");
  main.append(body, inline, transactionAmount(entry), trailingColumn(ctx, entry));
  return main;
}

interface MobileEditor {
  editor: HTMLElement;
  input: HTMLInputElement;
}

// モバイル: 行タップでコメント入力を展開。空で確定すると削除になる(onCommentChange側の仕様)
function mobileCommentEditor(ctx: RenderContext, key: string): MobileEditor {
  const editor = el("div", "comment-editor hidden pr-3 pb-2.5 pl-3.5 sm:hidden");
  const input = commentInput(ctx, key);
  input.classList.add(
    "min-h-10",
    "bg-white",
    "ring-slate-300",
    "dark:bg-slate-800",
    "dark:ring-slate-600",
  );
  editor.append(input);
  return { editor, input };
}

function attachRowToggle(row: HTMLElement, parts: MobileEditor, swipe: SwipeHandle | null): void {
  row.addEventListener("click", (event) => {
    // スワイプで開いた行のタップは閉じる操作。編集の展開と混ざらないようにする
    if (swipe?.settle() === true) {
      return;
    }
    const { target } = event;
    if (target instanceof Element && target.closest("input,button,a,select") !== null) {
      return;
    }
    parts.editor.classList.toggle("hidden");
    if (!parts.editor.classList.contains("hidden")) {
      parts.input.focus();
    }
  });
}

function transactionColumn(
  ctx: RenderContext,
  entry: TransactionEntry,
): { col: HTMLElement } & MobileEditor {
  const key =
    entry.kind === "transfer" ? transferCommentKey(entry.transfer) : changeCommentKey(entry.change);
  const { editor, input } = mobileCommentEditor(ctx, key);
  const col = el("div", "min-w-0 flex-1");
  col.append(transactionMain(ctx, key, entry), editor);
  return { col, editor, input };
}

/** 振替・外部入出金の1行。モバイルは行タップでコメント入力を展開する */
export function transactionRow(ctx: RenderContext, entry: TransactionEntry): HTMLElement {
  const { col, editor, input } = transactionColumn(ctx, entry);
  // スワイプ削除のパネルを覆えるよう、行の中身はカードと同じ面に載せて滑らせる
  const slider = el(
    "div",
    "swipe-slider relative flex items-stretch bg-white transition-transform duration-150 dark:bg-slate-950",
  );
  slider.append(el("span", `accent w-1 shrink-0 ${transactionAccent(entry)}`), col);
  const row = el("div", "log-row group relative overflow-hidden");
  row.append(slider);
  const swipe =
    entry.kind === "transfer" ? attachSwipeDelete(ctx, { row, slider }, entry.transfer) : null;
  attachRowToggle(row, { editor, input }, swipe);
  return row;
}

/** 残高記録の従属行。取引ではないので背景をわずかに沈めて区別する */
export function snapshotRow(entry: Extract<LogEntry, { kind: "snapshot" }>): HTMLElement {
  const row = el(
    "div",
    "snapshot-row flex items-center gap-2.5 bg-[#fcfdfe] py-2 pr-3.5 pl-[18px] dark:bg-transparent",
  );
  row.append(
    el(
      "span",
      "badge rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400",
      "記録",
    ),
  );
  const text = el("span", FINE_PRINT);
  text.append(`${formatTime(entry.at)} · 残高スナップショット · 合計 `);
  text.append(
    el(
      "strong",
      "font-semibold text-slate-700 tabular-nums dark:text-slate-300",
      formatYen(entry.total),
    ),
  );
  row.append(text);
  return row;
}
