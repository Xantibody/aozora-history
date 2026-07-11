import { transferCommentKey, transferKey } from "../domain/ledger.ts";
import { type LedgerData, mergeLedgers } from "../domain/merge.ts";
import { parseLedgerJson } from "../domain/serialization.ts";
import { type FetchLike, R2Client, syncWithR2 } from "../infrastructure/r2sync.ts";
import { HistoryStore, LAST_SYNCED_KEY, LEDGER_KEYS } from "../infrastructure/storage.ts";
import { type DashboardHandlers, renderDashboard } from "./render.ts";

const fetchFn: FetchLike = (url, init) => fetch(url, init);

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;

  const store = new HistoryStore(browser.storage.local);
  const [snapshots, transfers, comments, deletions, syncConfig, lastSyncedAt] = await Promise.all([
    store.loadSnapshots(),
    store.loadTransfers(),
    store.loadComments(),
    store.loadDeletions(),
    store.loadSyncConfig(),
    store.loadLastSyncedAt(),
  ]);

  const data = { snapshots, transfers, comments, deletions, syncConfig, lastSyncedAt };

  const currentLedger = (): LedgerData => ({
    snapshots: data.snapshots,
    transfers: data.transfers,
    comments: data.comments,
    deletions: data.deletions,
  });

  const applyLedger = (ledger: LedgerData): void => {
    data.snapshots = ledger.snapshots;
    data.transfers = ledger.transfers;
    data.comments = ledger.comments;
    data.deletions = ledger.deletions;
  };

  const handlers: DashboardHandlers = {
    onCommentChange: (key, text) => {
      // 再描画時に最新のコメントが出るようローカルにも反映する
      data.comments[key] = { text: text.trim(), updatedAt: Date.now() };
      void store.setComment(key, text);
    },

    onDeleteTransfer: (transfer) => {
      // 再描画で消えた行が戻らないよう、ローカルにも削除を反映する
      const key = transferKey(transfer);
      data.transfers = data.transfers.filter((t) => transferKey(t) !== key);
      data.deletions = { ...data.deletions, [key]: Date.now() };
      const commentKey = transferCommentKey(transfer);
      if (data.comments[commentKey] !== undefined) {
        data.comments[commentKey] = { text: "", updatedAt: Date.now() };
      }
      void store.deleteTransfer(transfer);
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
          deletions: data.deletions,
        };
        const merged = mergeLedgers(local, imported);
        await store.replaceLedger(merged);
        applyLedger(merged);
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
        applyLedger(merged);
        return `同期しました（スナップショット${merged.snapshots.length}件・振替${merged.transfers.length}件）`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `同期に失敗しました: ${message}`;
      }
    },
  };

  const redraw = renderDashboard(root, data, handlers);

  // 開いている間の変更(銀行サイトのタブでの記録・backgroundの自動同期)を反映する
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!LEDGER_KEYS.some((key) => key in changes) && !(LAST_SYNCED_KEY in changes)) return;
    void Promise.all([store.loadLedger(), store.loadLastSyncedAt()]).then(([ledger, syncedAt]) => {
      const unchanged =
        syncedAt === data.lastSyncedAt &&
        JSON.stringify(ledger) === JSON.stringify(currentLedger());
      if (unchanged) return;
      applyLedger(ledger);
      data.lastSyncedAt = syncedAt;
      // コメント入力中に再描画するとフォーカスを奪うため見送る(dataには反映済み)
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && root.contains(active)) return;
      redraw();
    });
  });

  // 起動時に他端末の記録を取り込む。取り込んだ変更は上の購読が拾って再描画する。
  // 失敗は致命的でないため無視する(backgroundの自動同期や「今すぐ同期」で回復できる)
  if (data.syncConfig !== null) {
    try {
      const client = new R2Client(data.syncConfig, fetchFn, () => new Date());
      await syncWithR2(store, client);
    } catch {
      // noop
    }
  }
}

void main();
