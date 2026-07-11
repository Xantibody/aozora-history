import {
  appendSnapshot,
  type BalanceSnapshot,
  type CommentEntry,
  type Comments,
  type TransferRecord,
} from "../domain/ledger.ts";
import type { LedgerData } from "../domain/merge.ts";
import type { SyncConfig } from "./r2sync.ts";

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const SNAPSHOTS_KEY = "balanceSnapshots";
const TRANSFERS_KEY = "transferRecords";
const COMMENTS_KEY = "comments";
const SYNC_CONFIG_KEY = "syncConfig";

/** 台帳本体を構成するstorageキー。同期のトリガー判定に使う */
export const LEDGER_KEYS = [SNAPSHOTS_KEY, TRANSFERS_KEY, COMMENTS_KEY] as const;

export type { Comments };

/** tombstone化(fix/comment-deletion-sync)以前に保存された旧形式のコメントを移行する */
function migrateComment(value: unknown): CommentEntry {
  if (typeof value === "string") return { text: value, updatedAt: 0 };
  return value as CommentEntry;
}

export function addTransfer(
  transfers: TransferRecord[],
  transfer: TransferRecord,
): TransferRecord[] {
  return [...transfers, transfer];
}

export class HistoryStore {
  constructor(
    private readonly storage: StorageArea,
    private readonly now: () => number = Date.now,
  ) {}

  async loadSnapshots(): Promise<BalanceSnapshot[]> {
    const items = await this.storage.get(SNAPSHOTS_KEY);
    return (items[SNAPSHOTS_KEY] as BalanceSnapshot[] | undefined) ?? [];
  }

  async loadTransfers(): Promise<TransferRecord[]> {
    const items = await this.storage.get(TRANSFERS_KEY);
    return (items[TRANSFERS_KEY] as TransferRecord[] | undefined) ?? [];
  }

  /** 直前と残高が変わっていた場合のみ保存し、保存したかどうかを返す */
  async recordSnapshot(snapshot: BalanceSnapshot): Promise<boolean> {
    const history = await this.loadSnapshots();
    const appended = appendSnapshot(history, snapshot);
    if (appended.length === history.length) return false;
    await this.storage.set({ [SNAPSHOTS_KEY]: appended });
    return true;
  }

  async recordTransfer(transfer: TransferRecord): Promise<void> {
    const transfers = await this.loadTransfers();
    await this.storage.set({ [TRANSFERS_KEY]: addTransfer(transfers, transfer) });
  }

  async loadComments(): Promise<Comments> {
    const items = await this.storage.get(COMMENTS_KEY);
    const stored = (items[COMMENTS_KEY] as Record<string, unknown> | undefined) ?? {};
    return Object.fromEntries(
      Object.entries(stored).map(([key, value]) => [key, migrateComment(value)]),
    );
  }

  async loadLedger(): Promise<LedgerData> {
    const [snapshots, transfers, comments] = await Promise.all([
      this.loadSnapshots(),
      this.loadTransfers(),
      this.loadComments(),
    ]);
    return { snapshots, transfers, comments };
  }

  async replaceLedger(data: LedgerData): Promise<void> {
    await this.storage.set({
      [SNAPSHOTS_KEY]: data.snapshots,
      [TRANSFERS_KEY]: data.transfers,
      [COMMENTS_KEY]: data.comments,
    });
  }

  async loadSyncConfig(): Promise<SyncConfig | null> {
    const items = await this.storage.get(SYNC_CONFIG_KEY);
    return (items[SYNC_CONFIG_KEY] as SyncConfig | undefined) ?? null;
  }

  async saveSyncConfig(config: SyncConfig): Promise<void> {
    await this.storage.set({ [SYNC_CONFIG_KEY]: config });
  }

  /** 空のコメントは削除。キーごと消さず削除の記録(tombstone)を残し、同期で復活しないようにする */
  async setComment(key: string, text: string): Promise<void> {
    const comments = await this.loadComments();
    comments[key] = { text: text.trim(), updatedAt: this.now() };
    await this.storage.set({ [COMMENTS_KEY]: comments });
  }
}
