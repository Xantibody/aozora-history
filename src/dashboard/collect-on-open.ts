import type { CollectState } from "./data.ts";
import type { HistoryStore } from "../infrastructure/storage.ts";

/**
 * ダッシュボードを開いた時点の取り込み。
 *
 * 銀行APIはログイン中のタブのセッションでしか叩けないため、ダッシュボードは
 * 自分で取りに行けない。開いている銀行サイトのタブに頼み、結果はそのタブが
 * storage に書くのを購読して受け取る。タブが無ければ取り込めないので、
 * 黙って古い記録を出さずに開く手立てを画面に出す
 */

/** content scriptが入っているタブの条件。manifestのmatchesと揃える */
const BANK_TAB_PATTERN = "https://bank.gmo-aozora.com/*";

/**
 * 取り込みを頼んでから諦めるまでの時間。タブは開いていてもcontent scriptが
 * 動いていない(拡張を入れ直す前から開いたままのタブなど)と何も返ってこない
 */
const COLLECT_TIMEOUT_MS = 20_000;

/** 取り込みの状況を映すもの。ダッシュボード本体を渡す */
export interface CollectView {
  data: { collectState: CollectState };
  redraw: () => void;
}

export interface CollectOnOpenDeps {
  hasBankTab: () => Promise<boolean>;
  requestCollect: () => Promise<void>;
}

/**
 * 開いた時点で取り込むかどうかの判断。銀行サイトのタブが開いていれば、
 * 間隔を待たずにその場で取り込ませる。
 *
 * content script が持つ10分の間隔はここでは見ない。あれはSPAの画面遷移ごとに
 * 叩き続けないための下限で、ダッシュボードを開くのは「いまの残高が見たい」
 * という明示的な合図だから(設定の「今すぐ取り込む」と同じ扱い)
 */
export async function collectOnOpen(deps: CollectOnOpenDeps): Promise<CollectState> {
  if (!(await deps.hasBankTab())) {
    return "needs-bank-tab";
  }
  await deps.requestCollect();
  return "collecting";
}

function setCollectState(view: CollectView, state: CollectState): void {
  if (view.data.collectState === state) {
    return;
  }
  view.data.collectState = state;
  view.redraw();
}

/**
 * 取り込みの開始。結果はcontent scriptがstorageに書くのを購読して受け取るため、
 * 返ってこないまま「取り込み中…」が残らないよう、時間で案内に戻す
 */
function beginCollect(view: CollectView): void {
  setCollectState(view, "collecting");
  setTimeout(() => {
    if (view.data.collectState === "collecting") {
      setCollectState(view, "needs-bank-tab");
    }
  }, COLLECT_TIMEOUT_MS);
}

/** 銀行サイトのタブが開いているか。取り込みはそのタブでしか走らない */
async function hasBankTab(): Promise<boolean> {
  try {
    const tabs = await browser.tabs.query({ url: BANK_TAB_PATTERN });
    return tabs.length > 0;
  } catch {
    // タブを見られない場合は、開いていないものとして案内を出す
    return false;
  }
}

/** 開いた時点の取り込みを走らせ、その状況を画面に出す */
export async function startCollectOnOpen(view: CollectView, store: HistoryStore): Promise<void> {
  const state = await collectOnOpen({
    hasBankTab,
    requestCollect: () => store.requestCollect(),
  });
  if (state === "collecting") {
    beginCollect(view);
    return;
  }
  setCollectState(view, state);
}
