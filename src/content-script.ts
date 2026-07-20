import { commentSuggestions, transferCommentKey } from "./domain/ledger.ts";
import { parseAccountsPage, parseTransferForm } from "./domain/parser.ts";
import type { HistoryStore } from "./infrastructure/storage.ts";
import type { TransferInput } from "./domain/parser.ts";
import type { TransferRecord } from "./domain/ledger.ts";
import { showCommentPrompt } from "./comment-prompt.ts";

const CONFIRM_BUTTON_ID = "sp-account-account-to-account-confirm";
// 実行ボタンには安定したidがないため、完了ダイアログの文言で振替の成立を検知する
const COMPLETION_MESSAGE = "つかいわけ口座の振替が完了しました";
// 実サイトはセッションを画面遷移時とAPI呼び出し時にしか確認せず、切れていても
// 確認・実行ボタンが押せてしまう。さらに振替APIがセッション切れ(490)を返しても
// エラー画面を出した後に完了ステップへ進んでしまうため、完了文言だけでは振替の
// 成立を判定できない。この案内が見えている間は記録しない
const SESSION_EXPIRED_MESSAGE = "セッションの有効期限が切れました";

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

// セッション切れ画面のマークアップは特定できていないため、タグに依存せず
// テキストノード単位で探す。文言がなければbody全文の1回の走査で済む
function hasVisibleMessage(doc: Document, message: string): boolean {
  if (doc.body === null || doc.body.textContent?.includes(message) !== true) {
    return false;
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (
      node.textContent?.includes(message) === true &&
      node.parentElement !== null &&
      isDisplayed(node.parentElement)
    ) {
      return true;
    }
  }
  return false;
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
    record,
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

// セッション切れへの差し替えで完了表示が一瞬だけ現れることがあるため、
// この時間待ってもまだ表示が残っていることを確かめてから記録する
const COMPLETION_VERIFY_DELAY_MS = 1000;

interface TransferTracker {
  noteConfirmClick: () => void;
  commitOnCompletion: () => void;
  cancel: () => void;
}

interface TrackerState {
  doc: Document;
  store: HistoryStore;
  now: () => number;
  pendingTransfer: TransferInput | null;
  completionVisible: boolean;
  verifyTimer: ReturnType<typeof setTimeout> | undefined;
}

function cancelVerify(state: TrackerState): void {
  clearTimeout(state.verifyTimer);
  state.verifyTimer = undefined;
}

function commitIfStillCompleted(state: TrackerState): void {
  state.verifyTimer = undefined;
  const parsed = state.pendingTransfer;
  // 検証に通らなければその実行は失敗しているので、保留も捨てる
  state.pendingTransfer = null;
  if (
    parsed === null ||
    !hasVisibleMessage(state.doc, COMPLETION_MESSAGE) ||
    hasVisibleMessage(state.doc, SESSION_EXPIRED_MESSAGE)
  ) {
    return;
  }
  void recordTransferAndPrompt(state.doc, state.store, {
    transferredAt: state.now(),
    ...parsed,
  });
}

function scheduleVerifyOnAppearance(state: TrackerState): void {
  const visible = hasVisibleMessage(state.doc, COMPLETION_MESSAGE);
  const appeared = visible && !state.completionVisible;
  state.completionVisible = visible;
  if (!appeared || state.verifyTimer !== undefined) {
    return;
  }
  state.verifyTimer = setTimeout(() => commitIfStillCompleted(state), COMPLETION_VERIFY_DELAY_MS);
}

function commitOnCompletion(state: TrackerState): void {
  if (hasVisibleMessage(state.doc, SESSION_EXPIRED_MESSAGE)) {
    state.pendingTransfer = null;
    cancelVerify(state);
    state.completionVisible = hasVisibleMessage(state.doc, COMPLETION_MESSAGE);
    return;
  }
  scheduleVerifyOnAppearance(state);
}

function createTransferTracker(
  doc: Document,
  store: HistoryStore,
  now: () => number,
): TransferTracker {
  // 確認画面の「戻る」やエラーで振替が成立しないことがあるため、確認クリックでは
  // フォーム内容を保留するだけにし、完了ダイアログの出現を待って記録する
  const state: TrackerState = {
    doc,
    store,
    now,
    pendingTransfer: null,
    completionVisible: hasVisibleMessage(doc, COMPLETION_MESSAGE),
    verifyTimer: undefined,
  };
  return {
    noteConfirmClick: (): void => {
      state.pendingTransfer = parseTransferForm(doc);
    },
    commitOnCompletion: (): void => {
      commitOnCompletion(state);
    },
    cancel: (): void => {
      cancelVerify(state);
    },
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
    transfers.cancel();
  };
}
