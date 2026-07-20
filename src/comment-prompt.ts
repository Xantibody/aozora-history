import type { HistoryStore } from "./infrastructure/storage.ts";
import type { TransferRecord } from "./domain/ledger.ts";

const PANEL_ID = "aozora-history-comment";

// ダッシュボードと同じ視覚言語(slate/skyのデザイントークン)。銀行サイトには
// TailwindがないためHEX値をインラインで当てる
const PROMPT_THEMES = {
  light: {
    surface: "#fff",
    border: "#e2e8f0", // slate-200
    text: "#0f172a", // slate-900
    subtle: "#64748b", // slate-500
    inputBorder: "#cbd5e1", // slate-300
    accent: "#0284c7", // sky-600
    accentText: "#fff",
    focusRing: "#0ea5e9", // sky-500
    danger: "#be123c", // rose-700
  },
  dark: {
    surface: "#020617", // slate-950
    border: "#1e293b", // slate-800
    text: "#f1f5f9", // slate-100
    subtle: "#94a3b8", // slate-400
    inputBorder: "#475569", // slate-600
    accent: "#38bdf8", // sky-400
    accentText: "#020617",
    focusRing: "#38bdf8",
    danger: "#fb7185", // rose-400
  },
};

/** 候補チップとして見せる件数。残りはdatalist(対応環境のみ)で補う */
const MAX_SUGGESTION_CHIPS = 5;

type PromptTheme = typeof PROMPT_THEMES.light;
interface PromptContext {
  doc: Document;
  store: HistoryStore;
  key: string;
  suggestions: string[];
  record: TransferRecord;
  theme: PromptTheme;
  panel: HTMLDivElement;
  input: HTMLInputElement;
}
export type CommentPrompt = Pick<PromptContext, "key" | "suggestions" | "record">;

function resolveTheme(doc: Document): PromptTheme {
  const dark = doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  return dark ? PROMPT_THEMES.dark : PROMPT_THEMES.light;
}

function buildPanel(doc: Document, theme: PromptTheme): HTMLDivElement {
  const panel = doc.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;" +
    `width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:${theme.surface};color:${theme.text};` +
    `border:1px solid ${theme.border};border-radius:14px;padding:12px 14px;` +
    "box-shadow:0 4px 24px rgba(15,23,42,.18);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Noto Sans JP',system-ui,sans-serif;";
  return panel;
}

function buildInput(doc: Document, theme: PromptTheme): HTMLInputElement {
  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "コメント";
  input.style.cssText =
    `flex:1;min-width:0;box-sizing:border-box;font:inherit;color:inherit;background:transparent;` +
    `border:1px solid ${theme.inputBorder};border-radius:8px;padding:8px 12px;min-height:40px;outline:none;`;
  // 銀行サイトに:focusのCSSを足せないため、リングはイベントで当てる
  input.addEventListener("focus", () => {
    input.style.borderColor = theme.focusRing;
    input.style.boxShadow = `0 0 0 1px ${theme.focusRing}`;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = theme.inputBorder;
    input.style.boxShadow = "none";
  });
  return input;
}

async function saveComment(context: PromptContext): Promise<void> {
  await context.store.setComment(context.key, context.input.value);
  context.panel.remove();
}

function buildSaveButton(context: PromptContext): HTMLButtonElement {
  const save = context.doc.createElement("button");
  save.type = "button";
  save.className = "save";
  save.textContent = "保存";
  save.style.cssText =
    `font:inherit;font-weight:600;background:${context.theme.accent};color:${context.theme.accentText};` +
    "border:none;border-radius:8px;padding:8px 16px;min-height:40px;cursor:pointer;";
  save.addEventListener("click", () => {
    void saveComment(context);
  });
  return save;
}

function buildInputRow(context: PromptContext): HTMLDivElement {
  const save = buildSaveButton(context);
  context.input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      save.click();
    }
  });
  const row = context.doc.createElement("div");
  row.style.cssText = "display:flex;gap:8px;";
  row.append(context.input, save);
  return row;
}

function buildCloseButton(context: PromptContext): HTMLButtonElement {
  const close = context.doc.createElement("button");
  close.type = "button";
  close.className = "close";
  close.textContent = "×";
  close.setAttribute("aria-label", "閉じる");
  close.style.cssText =
    `font:inherit;font-size:16px;background:none;color:${context.theme.subtle};border:none;cursor:pointer;` +
    "width:36px;height:36px;margin:-8px -10px -8px 0;border-radius:9999px;";
  close.addEventListener("click", () => context.panel.remove());
  return close;
}

function buildHeader(context: PromptContext): HTMLDivElement {
  const header = context.doc.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
  const title = context.doc.createElement("span");
  title.textContent = "振替を記録しました";
  title.style.cssText = "font-weight:600;";
  header.append(title, buildCloseButton(context));
  return header;
}

function buildSuggestionList(context: PromptContext): HTMLDataListElement {
  const list = context.doc.createElement("datalist");
  list.id = `${PANEL_ID}-suggestions`;
  for (const text of context.suggestions) {
    const option = context.doc.createElement("option");
    option.value = text;
    list.append(option);
  }
  context.input.setAttribute("list", list.id);
  return list;
}

function buildSuggestionChip(
  context: PromptContext,
  text: string,
  onPick: () => void,
): HTMLButtonElement {
  const chip = context.doc.createElement("button");
  chip.type = "button";
  chip.className = "suggestion";
  chip.textContent = text;
  chip.style.cssText =
    `font:inherit;font-size:13px;background:transparent;color:${context.theme.subtle};` +
    `border:1px solid ${context.theme.border};border-radius:9999px;padding:6px 14px;min-height:36px;cursor:pointer;`;
  chip.addEventListener("click", () => {
    context.input.value = text;
    context.input.focus();
    onPick();
  });
  return chip;
}

// datalistが使えないAndroid Firefox向けに、よく使う候補はチップでも見せる。
// 入力中はその文字を含む候補に絞り込み、タイプ中でも候補が使えるようにする
function appendSuggestionChips(context: PromptContext): void {
  if (context.suggestions.length === 0) {
    return;
  }
  const chips = context.doc.createElement("div");
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
  const renderChips = (): void => {
    chips.textContent = "";
    const query = context.input.value.trim();
    const matches = context.suggestions.filter((text) => text.includes(query));
    for (const text of matches.slice(0, MAX_SUGGESTION_CHIPS)) {
      chips.append(buildSuggestionChip(context, text, renderChips));
    }
    chips.style.display = matches.length > 0 ? "flex" : "none";
  };
  context.input.addEventListener("input", renderChips);
  renderChips();
  context.panel.append(chips);
}

async function undoRecord(context: PromptContext): Promise<void> {
  // セッション切れなどで成立していない振替が記録されてしまった場合の取り消し。
  // 誤タップで正しい記録を失わないよう、確認してから削除する
  if (!globalThis.confirm("この振替の記録を取り消しますか?")) {
    return;
  }
  await context.store.deleteTransfer(context.record);
  context.panel.remove();
}

function buildUndoButton(context: PromptContext): HTMLButtonElement {
  const undo = context.doc.createElement("button");
  undo.type = "button";
  undo.className = "undo";
  undo.textContent = "誤記録なら取り消す";
  undo.style.cssText =
    `font:inherit;font-size:13px;background:transparent;color:${context.theme.danger};` +
    "border:none;border-radius:8px;padding:6px 0;min-height:36px;cursor:pointer;align-self:flex-start;";
  undo.addEventListener("click", () => {
    void undoRecord(context);
  });
  return undo;
}

/** 銀行サイトのCSSに影響されないよう、スタイルはすべてインラインで当てる */
export function showCommentPrompt(doc: Document, store: HistoryStore, prompt: CommentPrompt): void {
  doc.querySelector(`#${PANEL_ID}`)?.remove();
  const theme = resolveTheme(doc);
  const panel = buildPanel(doc, theme);
  const input = buildInput(doc, theme);
  const context: PromptContext = { doc, store, theme, panel, input, ...prompt };
  panel.append(buildHeader(context), buildInputRow(context), buildSuggestionList(context));
  appendSuggestionChips(context);
  panel.append(buildUndoButton(context));
  doc.body.append(panel);
  input.focus();
}
