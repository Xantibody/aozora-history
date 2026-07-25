import { R2Client, syncWithR2 } from "./infrastructure/r2sync.ts";
import { AutoSync } from "./infrastructure/autosync.ts";
import type { FetchLike } from "./infrastructure/r2sync.ts";
import { HistoryStore } from "./infrastructure/storage.ts";
import type { LedgerData } from "./domain/merge.ts";

// 記録直後の連続した書き込み(スナップショット+振替など)を1回の同期にまとめる待ち時間
const SYNC_DELAY_MS = 3000;

const fetchFn: FetchLike = (url, init) => fetch(url, init);
const store = new HistoryStore(browser.storage.local);
const autoSync = new AutoSync(store, {
  runSync: (config): Promise<LedgerData> =>
    syncWithR2(store, new R2Client(config, fetchFn, () => new Date())),
  delayMs: SYNC_DELAY_MS,
  onError: (_error): void => {
    /* empty */
  },
});

function setupBackground(): void {
  browser.action.onClicked.addListener(() => {
    void browser.tabs.create({ url: browser.runtime.getURL("dashboard.html") });
  });
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      autoSync.handleChange(changes);
    }
  });
}

void setupBackground();
