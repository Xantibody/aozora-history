import { commentSuggestions, commentText } from "../domain/ledger.ts";
import type { Comments } from "../domain/ledger.ts";
import type { RenderContext } from "./context.ts";
import { el } from "./dom.ts";

const SUGGESTIONS_ID = "comment-suggestions";

export function suggestionList(comments: Comments): HTMLElement {
  const list = el("datalist");
  list.id = SUGGESTIONS_ID;
  for (const text of commentSuggestions(comments)) {
    const option = document.createElement("option");
    option.value = text;
    list.append(option);
  }
  return list;
}

export function commentInput(ctx: RenderContext, key: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className =
    "comment w-full min-w-0 rounded-[9px] bg-transparent px-2 py-1 text-[12.5px] ring-1 " +
    "ring-[#dfe4ea] focus:ring-2 focus:ring-sky-500 focus:outline-none dark:ring-[#243040]";
  input.placeholder = "メモ";
  input.setAttribute("list", SUGGESTIONS_ID);
  input.value = commentText(ctx.data.comments, key);
  input.addEventListener("change", () => {
    ctx.handlers.onCommentChange(key, input.value);
  });
  return input;
}
