import type { HistoryStore } from "./infrastructure/storage.ts";
import { createTransferTracker } from "./transfer-tracker.ts";
import { parseAccountsPage } from "./domain/parser.ts";

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

/**
 * ログイン後のSPAのパスの接頭辞。ログイン画面やお知らせページで
 * 認証の要るAPIを叩かないための目印
 */
const SIGNED_IN_PATH = "/bank";

/** 銀行APIからの取り込み。取得間隔の制御は呼ばれた側(collectFromBank)が持つ */
type Collect = () => Promise<unknown>;

interface ApiCollector {
  collectOnNavigation: () => void;
}

/**
 * つかいわけ口座の一覧を開かなくても記録が残るよう、ログイン中は裏で取りに行く。
 * SPAは画面遷移してもcontent scriptが読み込み直されないため、パスが
 * 変わるたびに取り込みの機会を作る
 */
function createApiCollector(doc: Document, collect: Collect): ApiCollector {
  let collectedPath: string | null = null;
  const run = async (): Promise<void> => {
    try {
      await collect();
    } catch {
      // noop: 未ログインなどの失敗は次の機会に取り直せる
    }
  };
  return {
    collectOnNavigation: (): void => {
      const path = doc.location?.pathname ?? "";
      if (!path.startsWith(SIGNED_IN_PATH) || path === collectedPath) {
        return;
      }
      collectedPath = path;
      // 画面の描画を止めないよう待たない
      void run();
    },
  };
}

export interface ContentScriptOptions {
  now: () => number;
  /** 銀行APIからの取り込み。省略すると取りに行かない(テスト用) */
  collect?: Collect;
}

export function setupContentScript(
  doc: Document,
  store: HistoryStore,
  options: ContentScriptOptions,
): () => void {
  const { now, collect = (): Promise<void> => Promise.resolve() } = options;
  const snapshots = createSnapshotScheduler(doc, store, now);
  const transfers = createTransferTracker(doc, store, now);
  const collector = createApiCollector(doc, collect);
  const onClick = (event: Event): void => {
    if (event.target instanceof Element) {
      transfers.handleClick(event.target);
    }
  };
  const observer = observeDom(doc, () => {
    snapshots.schedule();
    transfers.commitOnCompletion();
    collector.collectOnNavigation();
  });
  doc.addEventListener("click", onClick, true);
  snapshots.schedule();
  collector.collectOnNavigation();
  return (): void => {
    observer.disconnect();
    doc.removeEventListener("click", onClick, true);
    snapshots.cancel();
    transfers.cancel();
  };
}
