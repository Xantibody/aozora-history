import { INK_SOFT, INK_WEAK, el } from "./dom.ts";
import { changeCommentKey, commentText, transferCommentKey } from "../domain/comments.ts";
import type { LogEntry } from "../domain/log.ts";
import type { RenderContext } from "./context.ts";
import { commentInput } from "./comment-input.ts";
import { icon } from "./icons.ts";
import { statementCommentKey } from "../domain/statement.ts";

type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" | "statement" }>;

/** 記録の種類ごとに、コメントを紐付ける安定キーを決める */
export function commentKeyOf(entry: TransactionEntry): string {
  if (entry.kind === "transfer") {
    return transferCommentKey(entry.transfer);
  }
  return entry.kind === "statement"
    ? statementCommentKey(entry.statement)
    : changeCommentKey(entry.change);
}

/** 行の文字より一回り小さくして、主役である取引の内容に譲る */
const ICON_SIZE = 12;

export interface MemoField {
  field: HTMLElement;
  input: HTMLInputElement;
  open: () => void;
}

/** メモの読み取り表示。空のときは、書き込める場所だと分かる誘い文にする */
function memoText(ctx: RenderContext, key: string): HTMLElement {
  const comment = commentText(ctx.data.comments, key);
  if (comment !== "") {
    return el("span", `truncate ${INK_SOFT}`, comment);
  }
  // 操作の入口なので、装飾ではなく本文と同じ濃さで置く
  const hint = el("span", `memo-add inline-flex items-center gap-1.5 ${INK_WEAK}`);
  hint.append(icon("pencil", ICON_SIZE), "メモを追加");
  return hint;
}

/**
 * 取引の2段目に置くメモ。常時入力欄を出すと1行に主役が2つ並んで読みにくいため、
 * 普段は本文として見せ、クリックで入力欄に差し替える。
 * デスクトップとモバイルで同じ挙動にしている
 */
export function memoField(ctx: RenderContext, key: string): MemoField {
  const field = el("div", "memo min-w-0 text-[12.5px] leading-snug");
  const view = memoText(ctx, key);
  const input = commentInput(ctx, key);
  // hiddenクラスではなくhidden属性で隠す。誘い文はinline-flexを持っており、
  // 生成されるCSSでは .hidden が .inline-flex より前に来るため同じ詳細度で負け、
  // クラスでは消えない(属性側は preflight が !important で当てている)
  input.hidden = true;
  field.append(view, input);
  return {
    field,
    input,
    open: (): void => {
      view.hidden = true;
      input.hidden = false;
      input.focus();
    },
  };
}
