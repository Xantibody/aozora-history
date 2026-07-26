import {
  AUTO_TRANSFERS_KEY,
  HistoryStore,
  LAST_COLLECT_KEY,
  LAST_SYNCED_KEY,
  LEDGER_KEYS,
} from "../infrastructure/storage.ts";
import type { DashboardData, DashboardHandlers } from "./render.ts";
import { R2Client, syncWithR2 } from "../infrastructure/r2sync.ts";
import { transferCommentKey, transferKey } from "../domain/ledger.ts";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { CollectReport } from "../domain/diagnostics.ts";
import type { FetchLike } from "../infrastructure/r2sync.ts";
import type { LedgerData } from "../domain/merge.ts";
import type { TransferRecord } from "../domain/ledger.ts";
import { mergeLedgers } from "../domain/merge.ts";
import { parseLedgerJson } from "../domain/serialization.ts";
import { renderDashboard } from "./render.ts";

const fetchFn: FetchLike = (url, init) => fetch(url, init);

async function loadDashboardData(store: HistoryStore): Promise<DashboardData> {
  const [
    snapshots,
    transfers,
    statements,
    autoTransfers,
    comments,
    deletions,
    syncConfig,
    lastSyncedAt,
    debugMode,
    lastCollect,
  ] = await Promise.all([
    store.loadSnapshots(),
    store.loadTransfers(),
    store.loadStatements(),
    store.loadAutoTransfers(),
    store.loadComments(),
    store.loadDeletions(),
    store.loadSyncConfig(),
    store.loadLastSyncedAt(),
    store.loadDebugMode(),
    store.loadLastCollect(),
  ]);
  return {
    snapshots,
    transfers,
    statements,
    autoTransfers,
    comments,
    deletions,
    syncConfig,
    lastSyncedAt,
    debugMode,
    lastCollect,
  };
}

function currentLedger(data: DashboardData): LedgerData {
  return {
    snapshots: data.snapshots,
    transfers: data.transfers,
    statements: data.statements,
    comments: data.comments,
    deletions: data.deletions,
  };
}

function applyLedger(data: DashboardData, ledger: LedgerData): void {
  data.snapshots = ledger.snapshots;
  data.transfers = ledger.transfers;
  data.statements = ledger.statements;
  data.comments = ledger.comments;
  data.deletions = ledger.deletions;
}

function deleteTransfer(store: HistoryStore, data: DashboardData, transfer: TransferRecord): void {
  // 再描画で消えた行が戻らないよう、ローカルにも削除を反映する
  const key = transferKey(transfer);
  data.transfers = data.transfers.filter((record) => transferKey(record) !== key);
  data.deletions = { ...data.deletions, [key]: Date.now() };
  const commentKey = transferCommentKey(transfer);
  if (data.comments[commentKey] !== undefined) {
    data.comments[commentKey] = { text: "", updatedAt: Date.now() };
  }
  void store.deleteTransfer(transfer);
}

async function importFile(store: HistoryStore, data: DashboardData, text: string): Promise<string> {
  try {
    const imported = parseLedgerJson(text);
    const merged = mergeLedgers(currentLedger(data), imported);
    await store.replaceLedger(merged);
    applyLedger(data, merged);
    return `読み込みました（スナップショット${merged.snapshots.length}件・振替${merged.transfers.length}件）`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `読み込みに失敗しました: ${message}`;
  }
}

async function syncNow(store: HistoryStore, data: DashboardData): Promise<string> {
  if (data.syncConfig === null) {
    return "先に同期設定を保存してください";
  }
  try {
    const client = new R2Client(data.syncConfig, fetchFn, () => new Date());
    const merged = await syncWithR2(store, client);
    applyLedger(data, merged);
    return `同期しました（スナップショット${merged.snapshots.length}件・振替${merged.transfers.length}件）`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `同期に失敗しました: ${message}`;
  }
}

function createHandlers(store: HistoryStore, data: DashboardData): DashboardHandlers {
  return {
    onCommentChange: (key, text) => {
      // 再描画時に最新のコメントが出るようローカルにも反映する
      data.comments[key] = { text: text.trim(), updatedAt: Date.now() };
      void store.setComment(key, text);
    },

    onDeleteTransfer: (transfer) => {
      deleteTransfer(store, data, transfer);
    },

    onSaveSyncConfig: async (config) => {
      if (!config.accountId || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
        return "すべての項目を入力してください";
      }
      await store.saveSyncConfig(config);
      data.syncConfig = config;
      return "設定を保存しました";
    },

    onImportFile: (text) => importFile(store, data, text),

    onSyncNow: () => syncNow(store, data),

    onToggleDebug: (enabled) => {
      data.debugMode = enabled;
      void store.saveDebugMode(enabled);
    },

    onRequestCollect: () => {
      void store.requestCollect();
    },
  };
}

interface AppContext {
  root: Element;
  store: HistoryStore;
  data: DashboardData;
  redraw: () => void;
}

interface StoredState {
  ledger: LedgerData;
  autoTransfers: AutoTransferSetting[];
  syncedAt: number | null;
  lastCollect: CollectReport | null;
}

function sameAsShown(app: AppContext, stored: StoredState): boolean {
  return (
    stored.syncedAt === app.data.lastSyncedAt &&
    JSON.stringify(stored.ledger) === JSON.stringify(currentLedger(app.data)) &&
    JSON.stringify(stored.autoTransfers) === JSON.stringify(app.data.autoTransfers) &&
    JSON.stringify(stored.lastCollect) === JSON.stringify(app.data.lastCollect)
  );
}

async function loadStoredState(store: HistoryStore): Promise<StoredState> {
  const [ledger, autoTransfers, syncedAt, lastCollect] = await Promise.all([
    store.loadLedger(),
    store.loadAutoTransfers(),
    store.loadLastSyncedAt(),
    store.loadLastCollect(),
  ]);
  return { ledger, autoTransfers, syncedAt, lastCollect };
}

function applyStored(app: AppContext, stored: StoredState): void {
  applyLedger(app.data, stored.ledger);
  app.data.autoTransfers = stored.autoTransfers;
  app.data.lastSyncedAt = stored.syncedAt;
  app.data.lastCollect = stored.lastCollect;
}

/** コメント入力中か。再描画するとフォーカスを奪ってしまう */
function isEditing(app: AppContext): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement && app.root.contains(active);
}

async function refreshFromStorage(app: AppContext): Promise<void> {
  const stored = await loadStoredState(app.store);
  if (sameAsShown(app, stored)) {
    return;
  }
  applyStored(app, stored);
  // 入力中は見送る。dataには反映済みなので、次の描画で追いつく
  if (!isEditing(app)) {
    app.redraw();
  }
}

// 開いている間の変更(銀行サイトのタブでの記録・backgroundの自動同期)を反映する
function watchStorage(app: AppContext): void {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const watched = [...LEDGER_KEYS, LAST_SYNCED_KEY, AUTO_TRANSFERS_KEY, LAST_COLLECT_KEY];
    if (!watched.some((key) => key in changes)) {
      return;
    }
    void refreshFromStorage(app);
  });
}

// 起動時に他端末の記録を取り込む。取り込んだ変更は上の購読が拾って再描画する。
// 失敗は致命的でないため無視する(backgroundの自動同期や「今すぐ同期」で回復できる)
async function initialSync(store: HistoryStore, data: DashboardData): Promise<void> {
  if (data.syncConfig === null) {
    return;
  }
  try {
    const client = new R2Client(data.syncConfig, fetchFn, () => new Date());
    await syncWithR2(store, client);
  } catch {
    // noop
  }
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) {
    return;
  }
  const store = new HistoryStore(browser.storage.local);
  const data = await loadDashboardData(store);
  const redraw = renderDashboard(root, data, {
    handlers: createHandlers(store, data),
  });
  watchStorage({ root, store, data, redraw });
  await initialSync(store, data);
}

void main();
