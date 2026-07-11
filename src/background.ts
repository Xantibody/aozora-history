import { AutoSync } from "./infrastructure/autosync.ts";
import { type FetchLike, R2Client, syncWithR2 } from "./infrastructure/r2sync.ts";
import { HistoryStore } from "./infrastructure/storage.ts";

browser.action.onClicked.addListener(() => {
  void browser.tabs.create({ url: browser.runtime.getURL("dashboard.html") });
});

// 記録直後の連続した書き込み(スナップショット+振替など)を1回の同期にまとめる待ち時間
const SYNC_DELAY_MS = 3000;

const fetchFn: FetchLike = (url, init) => fetch(url, init);
const store = new HistoryStore(browser.storage.local);
const autoSync = new AutoSync(
  store,
  (config) => syncWithR2(store, new R2Client(config, fetchFn, () => new Date())),
  SYNC_DELAY_MS,
  (error) => console.error("自動同期に失敗しました", error),
);

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") autoSync.handleChange(changes);
});
