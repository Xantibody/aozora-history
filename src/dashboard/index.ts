import { mergeLedgers } from "../domain/merge.ts";
import { parseLedgerJson } from "../domain/serialization.ts";
import { type FetchLike, R2Client, syncWithR2 } from "../infrastructure/r2sync.ts";
import { HistoryStore } from "../infrastructure/storage.ts";
import { type DashboardHandlers, renderDashboard } from "./render.ts";

const fetchFn: FetchLike = (url, init) => fetch(url, init);

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;

  const store = new HistoryStore(browser.storage.local);
  const [snapshots, transfers, comments, syncConfig] = await Promise.all([
    store.loadSnapshots(),
    store.loadTransfers(),
    store.loadComments(),
    store.loadSyncConfig(),
  ]);

  const data = { snapshots, transfers, comments, syncConfig };

  const handlers: DashboardHandlers = {
    onCommentChange: (key, text) => {
      // 再描画時に最新のコメントが出るようローカルにも反映する
      data.comments[key] = { text: text.trim(), updatedAt: Date.now() };
      void store.setComment(key, text);
    },

    onSaveSyncConfig: async (config) => {
      if (!config.accountId || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
        return "すべての項目を入力してください";
      }
      await store.saveSyncConfig(config);
      data.syncConfig = config;
      return "設定を保存しました";
    },

    onImportFile: async (text) => {
      try {
        const imported = parseLedgerJson(text);
        const local = {
          snapshots: data.snapshots,
          transfers: data.transfers,
          comments: data.comments,
        };
        const merged = mergeLedgers(local, imported);
        await store.replaceLedger(merged);
        data.snapshots = merged.snapshots;
        data.transfers = merged.transfers;
        data.comments = merged.comments;
        return `読み込みました（スナップショット${merged.snapshots.length}件・振替${merged.transfers.length}件）`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `読み込みに失敗しました: ${message}`;
      }
    },

    onSyncNow: async () => {
      if (data.syncConfig === null) {
        return "先に同期設定を保存してください";
      }
      try {
        const client = new R2Client(data.syncConfig, fetchFn, () => new Date());
        const merged = await syncWithR2(store, client);
        data.snapshots = merged.snapshots;
        data.transfers = merged.transfers;
        data.comments = merged.comments;
        return `同期しました（スナップショット${merged.snapshots.length}件・振替${merged.transfers.length}件）`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `同期に失敗しました: ${message}`;
      }
    },
  };

  renderDashboard(root, data, handlers);

  // 起動時に他端末の記録を取り込む。失敗は致命的でないため無視する
  // (background の自動同期や「今すぐ同期」で回復できる)
  if (data.syncConfig !== null) {
    const before = JSON.stringify({ snapshots, transfers, comments });
    try {
      const client = new R2Client(data.syncConfig, fetchFn, () => new Date());
      const merged = await syncWithR2(store, client);
      if (JSON.stringify(merged) === before) return;
      data.snapshots = merged.snapshots;
      data.transfers = merged.transfers;
      data.comments = merged.comments;
      renderDashboard(root, data, handlers);
    } catch {
      // noop
    }
  }
}

void main();
