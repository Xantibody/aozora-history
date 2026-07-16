import { commentSuggestions, transferCommentKey } from "./domain/ledger.ts";
import { parseAccountsPage, parseTransferForm } from "./domain/parser.ts";
import type { HistoryStore } from "./infrastructure/storage.ts";

const CONFIRM_BUTTON_ID = "sp-account-account-to-account-confirm";
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
  },
};

/** 候補チップとして見せる件数。残りはdatalist(対応環境のみ)で補う */
const MAX_SUGGESTION_CHIPS = 5;

/** 銀行サイトのCSSに影響されないよう、スタイルはすべてインラインで当てる */
function showCommentPrompt(
  doc: Document,
  store: HistoryStore,
  key: string,
  suggestions: string[],
): void {
  doc.getElementById(PANEL_ID)?.remove();
  const theme =
    doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches === true
      ? PROMPT_THEMES.dark
      : PROMPT_THEMES.light;

  const panel = doc.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;" +
    `width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:${theme.surface};color:${theme.text};` +
    `border:1px solid ${theme.border};border-radius:14px;padding:12px 14px;` +
    "box-shadow:0 4px 24px rgba(15,23,42,.18);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Noto Sans JP',system-ui,sans-serif;";

  const header = doc.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
  const title = doc.createElement("span");
  title.textContent = "振替を記録しました";
  title.style.cssText = "font-weight:600;";

  const close = doc.createElement("button");
  close.type = "button";
  close.className = "close";
  close.textContent = "×";
  close.setAttribute("aria-label", "閉じる");
  close.style.cssText =
    `font:inherit;font-size:16px;background:none;color:${theme.subtle};border:none;cursor:pointer;` +
    "width:36px;height:36px;margin:-8px -10px -8px 0;border-radius:9999px;";
  close.addEventListener("click", () => panel.remove());
  header.append(title, close);

  const inputRow = doc.createElement("div");
  inputRow.style.cssText = "display:flex;gap:8px;";

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
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") save.click();
  });

  const list = doc.createElement("datalist");
  list.id = `${PANEL_ID}-suggestions`;
  for (const text of suggestions) {
    const option = doc.createElement("option");
    option.value = text;
    list.append(option);
  }
  input.setAttribute("list", list.id);

  const save = doc.createElement("button");
  save.type = "button";
  save.className = "save";
  save.textContent = "保存";
  save.style.cssText =
    `font:inherit;font-weight:600;background:${theme.accent};color:${theme.accentText};` +
    "border:none;border-radius:8px;padding:8px 16px;min-height:40px;cursor:pointer;";
  save.addEventListener("click", () => {
    void store.setComment(key, input.value).then(() => panel.remove());
  });

  inputRow.append(input, save);
  panel.append(header, inputRow, list);

  // datalistが使えないAndroid Firefox向けに、よく使う候補はチップでも見せる
  if (suggestions.length > 0) {
    const chips = doc.createElement("div");
    chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    for (const text of suggestions.slice(0, MAX_SUGGESTION_CHIPS)) {
      const chip = doc.createElement("button");
      chip.type = "button";
      chip.className = "suggestion";
      chip.textContent = text;
      chip.style.cssText =
        `font:inherit;font-size:13px;background:transparent;color:${theme.subtle};` +
        `border:1px solid ${theme.border};border-radius:9999px;padding:6px 14px;min-height:36px;cursor:pointer;`;
      chip.addEventListener("click", () => {
        input.value = text;
        input.focus();
      });
      chips.append(chip);
    }
    panel.append(chips);
  }

  doc.body.append(panel);
  input.focus();
}
// DOM変化からパースまでの待ち時間。変化のたびに延長するとチャットボット等で
// 変化し続けるページで永遠に実行されないため、保留中は再スケジュールしない
const CAPTURE_DELAY_MS = 300;

export function setupContentScript(
  doc: Document,
  store: HistoryStore,
  now: () => number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const captureSnapshot = () => {
    const parsed = parseAccountsPage(doc);
    if (parsed === null) return;
    void store.recordSnapshot({ takenAt: now(), ...parsed });
  };

  const scheduleCapture = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      captureSnapshot();
    }, CAPTURE_DELAY_MS);
  };

  const onClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(`#${CONFIRM_BUTTON_ID}`) === null) return;
    const parsed = parseTransferForm(doc);
    if (parsed === null) return;
    const record = { transferredAt: now(), ...parsed };
    void store
      .recordTransfer(record)
      .then(() => store.loadComments())
      .then((comments) => {
        showCommentPrompt(doc, store, transferCommentKey(record), commentSuggestions(comments));
      });
  };

  const observer = new MutationObserver(scheduleCapture);
  observer.observe(doc, { childList: true, subtree: true });
  doc.addEventListener("click", onClick, true);
  scheduleCapture();

  return () => {
    observer.disconnect();
    doc.removeEventListener("click", onClick, true);
    clearTimeout(timer);
  };
}
