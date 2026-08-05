import { commentSuggestions, transferCommentKey } from "./domain/comments.ts";
import type { HistoryStore } from "./infrastructure/storage.ts";
import type { TransferInput } from "./domain/parser.ts";
import type { TransferRecord } from "./domain/ledger.ts";
import { parseTransferForm } from "./domain/parser.ts";
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
  // パネルはダッシュボードと同じ明暗で出す。設定は端末ごとの見え方なのでstorageから読む
  const [comments, theme] = await Promise.all([store.loadComments(), store.loadTheme()]);
  showCommentPrompt(doc, store, {
    key: transferCommentKey(record),
    suggestions: commentSuggestions(comments),
    record,
    theme,
  });
}

// セッション切れへの差し替えで完了表示が一瞬だけ現れることがあるため、
// この時間待ってもまだ表示が残っていることを確かめてから記録する
const COMPLETION_VERIFY_DELAY_MS = 1000;

export interface TransferTracker {
  handleClick: (target: Element) => void;
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

/**
 * 検証に通らなかった完了表示は、実行の失敗とは限らない。
 *
 * 実サイトはモーダルを閉じた300ms後にステップを確認へ戻すため、閉じてすぐ
 * 開き直すと前回の完了ブロックが見えたまま挿入される。これを実行の失敗とみて
 * 保留を捨てると、そのあと本当に実行しても記録する材料が残らない
 * (2回続けて振替をするとコメント欄が出なくなっていた)。
 *
 * 成立していない振替を後から拾ってしまわないための番人は、この検証ではなく
 * 1秒の待ち時間とセッション切れの検知が務める。保留はそのまま残す
 */
function commitIfStillCompleted(state: TrackerState): void {
  state.verifyTimer = undefined;
  const parsed = state.pendingTransfer;
  if (
    parsed === null ||
    !hasVisibleMessage(state.doc, COMPLETION_MESSAGE) ||
    hasVisibleMessage(state.doc, SESSION_EXPIRED_MESSAGE)
  ) {
    return;
  }
  // 同じ完了表示で二重に記録しないよう、使った保留は捨てる
  state.pendingTransfer = null;
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

function handleClick(state: TrackerState, target: Element): void {
  if (target.closest(`#${CONFIRM_BUTTON_ID}`) !== null) {
    state.pendingTransfer = parseTransferForm(state.doc);
  }
}

export function createTransferTracker(
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
    handleClick: (target: Element): void => {
      handleClick(state, target);
    },
    commitOnCompletion: (): void => {
      commitOnCompletion(state);
    },
    cancel: (): void => {
      cancelVerify(state);
    },
  };
}
