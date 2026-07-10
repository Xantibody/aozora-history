import { transferCommentKey } from "./domain/ledger.ts";
import { parseAccountsPage, parseTransferForm } from "./domain/parser.ts";
import type { HistoryStore } from "./infrastructure/storage.ts";

const CONFIRM_BUTTON_ID = "sp-account-account-to-account-confirm";
const PANEL_ID = "aozora-history-comment";

/** 銀行サイトのCSSに影響されないよう、スタイルはすべてインラインで当てる */
function showCommentPrompt(doc: Document, store: HistoryStore, key: string): void {
  doc.getElementById(PANEL_ID)?.remove();

  const panel = doc.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;gap:8px;" +
    "align-items:center;background:#fff;color:#333;border:1px solid #0a6cb3;border-radius:8px;" +
    "padding:10px 12px;box-shadow:0 4px 12px rgba(0,0,0,.25);font:14px system-ui,sans-serif;";

  const label = doc.createElement("span");
  label.textContent = "振替を記録しました。コメント:";

  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "例: 家賃";
  input.style.cssText =
    "font:inherit;color:inherit;background:#fff;border:1px solid #ccc;border-radius:4px;padding:4px 8px;width:12em;";
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") save.click();
  });

  const save = doc.createElement("button");
  save.type = "button";
  save.className = "save";
  save.textContent = "保存";
  save.style.cssText =
    "font:inherit;background:#0a6cb3;color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;";
  save.addEventListener("click", () => {
    void store.setComment(key, input.value).then(() => panel.remove());
  });

  const close = doc.createElement("button");
  close.type = "button";
  close.className = "close";
  close.textContent = "×";
  close.setAttribute("aria-label", "閉じる");
  close.style.cssText =
    "font:inherit;background:none;color:#888;border:none;cursor:pointer;padding:0 4px;";
  close.addEventListener("click", () => panel.remove());

  panel.append(label, input, save, close);
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
    void store.recordTransfer(record).then(() => {
      showCommentPrompt(doc, store, transferCommentKey(record));
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
