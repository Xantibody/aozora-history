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
    "comment w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-sm ring-1 ring-transparent transition-shadow " +
    "hover:ring-slate-300 focus:bg-white focus:ring-2 focus:ring-sky-500 focus:outline-none " +
    "dark:hover:ring-slate-600 dark:focus:bg-slate-800";
  input.placeholder = "コメント";
  input.setAttribute("list", SUGGESTIONS_ID);
  input.value = commentText(ctx.data.comments, key);
  input.addEventListener("change", () => {
    ctx.handlers.onCommentChange(key, input.value);
  });
  return input;
}
