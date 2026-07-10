import { parseAccountsPage, parseTransferForm } from "./domain/parser.ts";
import type { HistoryStore } from "./infrastructure/storage.ts";

const CONFIRM_BUTTON_ID = "sp-account-account-to-account-confirm";
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
    void store.recordTransfer({ transferredAt: now(), ...parsed });
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
