import { commentSuggestions, transferCommentKey } from "./domain/ledger.ts";
import { parseAccountsPage, parseTransferForm } from "./domain/parser.ts";
import type { HistoryStore } from "./infrastructure/storage.ts";
import type { TransferInput } from "./domain/parser.ts";
import type { TransferRecord } from "./domain/ledger.ts";
import { showCommentPrompt } from "./comment-prompt.ts";

const CONFIRM_BUTTON_ID = "sp-account-account-to-account-confirm";
// 実行ボタンには安定したidがないため、完了ダイアログの文言で振替の成立を検知する
const COMPLETION_MESSAGE = "つかいわけ口座の振替が完了しました";

// 実サイト(Vue)は確認/完了ブロックをv-showで切り替えるため、完了文言は確認
// 段階でも display:none のままDOMに存在する。文言の有無ではなく表示状態で判定する
function isDisplayed(el: Element): boolean {
  for (let node: Element | null = el; node instanceof HTMLElement; node = node.parentElement) {
    if (node.style.display === "none") {
      return false;
    }
  }
  return true;
}

function hasVisibleCompletionMessage(doc: Document): boolean {
  return [...doc.querySelectorAll("p")].some(
    (paragraph) =>
      paragraph.textContent?.includes(COMPLETION_MESSAGE) === true && isDisplayed(paragraph),
  );
}

async function recordTransferAndPrompt(
  doc: Document,
  store: HistoryStore,
  record: TransferRecord,
): Promise<void> {
  await store.recordTransfer(record);
  const comments = await store.loadComments();
  showCommentPrompt(doc, store, {
    key: transferCommentKey(record),
    suggestions: commentSuggestions(comments),
  });
}

function observeDom(doc: Document, onMutation: () => void): MutationObserver {
  const observer = new MutationObserver(onMutation);
  // v-showの表示切替はstyle属性の変更として現れるため、属性変更も監視する
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  return observer;
}

// DOM変化からパースまでの待ち時間。変化のたびに延長するとチャットボット等で
// 変化し続けるページで永遠に実行されないため、保留中は再スケジュールしない
const CAPTURE_DELAY_MS = 300;

interface SnapshotScheduler {
  schedule: () => void;
  cancel: () => void;
}

function createSnapshotScheduler(
  doc: Document,
  store: HistoryStore,
  now: () => number,
): SnapshotScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const schedule = (): void => {
    if (timer !== undefined) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      const parsed = parseAccountsPage(doc);
      if (parsed !== null) {
        void store.recordSnapshot({ takenAt: now(), ...parsed });
      }
    }, CAPTURE_DELAY_MS);
  };
  return {
    schedule,
    cancel: (): void => clearTimeout(timer),
  };
}

interface TransferTracker {
  noteConfirmClick: () => void;
  commitOnCompletion: () => void;
}

function createTransferTracker(
  doc: Document,
  store: HistoryStore,
  now: () => number,
): TransferTracker {
  // 確認画面の「戻る」やエラーで振替が成立しないことがあるため、確認クリックでは
  // フォーム内容を保留するだけにし、完了ダイアログの出現を待って記録する
  let pendingTransfer: TransferInput | null = null;
  let completionVisible = hasVisibleCompletionMessage(doc);
  const commitOnCompletion = (): void => {
    const visible = hasVisibleCompletionMessage(doc);
    const appeared = visible && !completionVisible;
    completionVisible = visible;
    if (!appeared) {
      return;
    }
    const parsed = pendingTransfer;
    pendingTransfer = null;
    if (parsed === null) {
      return;
    }
    void recordTransferAndPrompt(doc, store, { transferredAt: now(), ...parsed });
  };
  return {
    noteConfirmClick: (): void => {
      pendingTransfer = parseTransferForm(doc);
    },
    commitOnCompletion,
  };
}

export function setupContentScript(
  doc: Document,
  store: HistoryStore,
  now: () => number,
): () => void {
  const snapshots = createSnapshotScheduler(doc, store, now);
  const transfers = createTransferTracker(doc, store, now);
  const onClick = (event: Event): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest(`#${CONFIRM_BUTTON_ID}`) === null) {
      return;
    }
    transfers.noteConfirmClick();
  };
  const observer = observeDom(doc, () => {
    snapshots.schedule();
    transfers.commitOnCompletion();
  });
  doc.addEventListener("click", onClick, true);
  snapshots.schedule();
  return (): void => {
    observer.disconnect();
    doc.removeEventListener("click", onClick, true);
    snapshots.cancel();
  };
}
