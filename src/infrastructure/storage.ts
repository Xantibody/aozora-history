import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import type { CommentEntry, Comments } from "../domain/comments.ts";
import { appendSnapshot, transferKey } from "../domain/ledger.ts";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { CollectReport } from "../domain/diagnostics.ts";
import type { LedgerData } from "../domain/merge.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { SyncConfig } from "./r2sync.ts";
import { mergeStatements } from "../domain/statement.ts";
import { transferCommentKey } from "../domain/comments.ts";

export type { Comments } from "../domain/comments.ts";

export interface StorageArea {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

const SNAPSHOTS_KEY = "balanceSnapshots";
const TRANSFERS_KEY = "transferRecords";
const STATEMENTS_KEY = "statementEntries";
const COMMENTS_KEY = "comments";
const DELETIONS_KEY = "transferDeletions";
const SYNC_CONFIG_KEY = "syncConfig";
/**
 * 定額自動振替の設定。銀行側の設定をそのまま写したもので記録ではないため、
 * LEDGER_KEYSに含めない(端末間で同期しなくても、各端末が銀行から取り直せる)
 */
export const AUTO_TRANSFERS_KEY = "autoTransferSettings";
/** 設定画面にデバッグ欄を出すかどうか。既定は出さない */
export const DEBUG_MODE_KEY = "debugMode";
/** 最後の取り込みの結果。記録ではなく診断用なのでLEDGER_KEYSに含めない */
export const LAST_COLLECT_KEY = "lastCollectReport";
/** 最後にR2と同期できた時刻。台帳ではないためLEDGER_KEYSに含めない(自動同期のループ防止) */
export const LAST_SYNCED_KEY = "lastSyncedAt";
/** 最後に銀行APIから取得した時刻。同上の理由でLEDGER_KEYSに含めない */
export const LAST_COLLECTED_KEY = "lastCollectedAt";

/** 台帳本体を構成するstorageキー。同期のトリガー判定に使う */
export const LEDGER_KEYS = [
  SNAPSHOTS_KEY,
  TRANSFERS_KEY,
  STATEMENTS_KEY,
  COMMENTS_KEY,
  DELETIONS_KEY,
] as const;

/** tombstone化(fix/comment-deletion-sync)以前に保存された旧形式のコメントを移行する */
function migrateComment(value: unknown): CommentEntry {
  if (typeof value === "string") {
    return { text: value, updatedAt: 0 };
  }
  return value as CommentEntry;
}

export function addTransfer(
  transfers: TransferRecord[],
  transfer: TransferRecord,
): TransferRecord[] {
  return [...transfers, transfer];
}

export class HistoryStore {
  private readonly storage: StorageArea;

  private readonly now: () => number;

  public constructor(storage: StorageArea, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  public async loadSnapshots(): Promise<BalanceSnapshot[]> {
    const items = await this.storage.get(SNAPSHOTS_KEY);
    return (items[SNAPSHOTS_KEY] as BalanceSnapshot[] | undefined) ?? [];
  }

  public async loadTransfers(): Promise<TransferRecord[]> {
    const items = await this.storage.get(TRANSFERS_KEY);
    return (items[TRANSFERS_KEY] as TransferRecord[] | undefined) ?? [];
  }

  /** 直前と残高が変わっていた場合のみ保存し、保存したかどうかを返す */
  public async recordSnapshot(snapshot: BalanceSnapshot): Promise<boolean> {
    const history = await this.loadSnapshots();
    const appended = appendSnapshot(history, snapshot);
    if (appended.length === history.length) {
      return false;
    }
    await this.storage.set({ [SNAPSHOTS_KEY]: appended });
    return true;
  }

  public async recordTransfer(transfer: TransferRecord): Promise<void> {
    const transfers = await this.loadTransfers();
    await this.storage.set({ [TRANSFERS_KEY]: addTransfer(transfers, transfer) });
  }

  public async loadStatements(): Promise<StatementEntry[]> {
    const items = await this.storage.get(STATEMENTS_KEY);
    return (items[STATEMENTS_KEY] as StatementEntry[] | undefined) ?? [];
  }

  /**
   * 取得した明細を取り込む。銀行APIは毎回同じ明細を返すため、内容が
   * 変わらなければ書き込まない(自動同期の空振りを防ぐ)。保存したかどうかを返す
   */
  public async recordStatements(incoming: StatementEntry[]): Promise<boolean> {
    const existing = await this.loadStatements();
    const merged = mergeStatements(existing, incoming);
    if (JSON.stringify(merged) === JSON.stringify(existing)) {
      return false;
    }
    await this.storage.set({ [STATEMENTS_KEY]: merged });
    return true;
  }

  public async loadAutoTransfers(): Promise<AutoTransferSetting[]> {
    const items = await this.storage.get(AUTO_TRANSFERS_KEY);
    return (items[AUTO_TRANSFERS_KEY] as AutoTransferSetting[] | undefined) ?? [];
  }

  /** 設定は滅多に変わらないため、変わっていなければ書き込まない。保存したかどうかを返す */
  public async recordAutoTransfers(settings: AutoTransferSetting[]): Promise<boolean> {
    const existing = await this.loadAutoTransfers();
    if (JSON.stringify(settings) === JSON.stringify(existing)) {
      return false;
    }
    await this.storage.set({ [AUTO_TRANSFERS_KEY]: settings });
    return true;
  }

  public async loadDebugMode(): Promise<boolean> {
    const items = await this.storage.get(DEBUG_MODE_KEY);
    return items[DEBUG_MODE_KEY] === true;
  }

  public async saveDebugMode(enabled: boolean): Promise<void> {
    await this.storage.set({ [DEBUG_MODE_KEY]: enabled });
  }

  public async loadLastCollect(): Promise<CollectReport | null> {
    const items = await this.storage.get(LAST_COLLECT_KEY);
    return (items[LAST_COLLECT_KEY] as CollectReport | undefined) ?? null;
  }

  public async recordLastCollect(report: CollectReport): Promise<void> {
    await this.storage.set({ [LAST_COLLECT_KEY]: report });
  }

  /**
   * 次に銀行サイトを開いたときの取り込みを、間隔を待たずに走らせる。
   * 銀行サイトのタブが開いていれば、この変更を拾ってその場で取りに行く
   */
  public async requestCollect(): Promise<void> {
    await this.storage.set({ [LAST_COLLECTED_KEY]: null });
  }

  public async loadComments(): Promise<Comments> {
    const items = await this.storage.get(COMMENTS_KEY);
    const stored = (items[COMMENTS_KEY] as Record<string, unknown> | undefined) ?? {};
    return Object.fromEntries(
      Object.entries(stored).map(([key, value]) => [key, migrateComment(value)]),
    );
  }

  public async loadDeletions(): Promise<Record<string, number>> {
    const items = await this.storage.get(DELETIONS_KEY);
    return (items[DELETIONS_KEY] as Record<string, number> | undefined) ?? {};
  }

  /** 振替を削除する。同期で復活しないよう削除の記録を残し、コメントも削除する */
  public async deleteTransfer(transfer: TransferRecord): Promise<void> {
    const [transfers, deletions, comments] = await Promise.all([
      this.loadTransfers(),
      this.loadDeletions(),
      this.loadComments(),
    ]);
    const key = transferKey(transfer);
    const items: Record<string, unknown> = {
      [TRANSFERS_KEY]: transfers.filter((record) => transferKey(record) !== key),
      [DELETIONS_KEY]: { ...deletions, [key]: this.now() },
    };
    const commentKey = transferCommentKey(transfer);
    if (comments[commentKey] !== undefined && comments[commentKey].text !== "") {
      comments[commentKey] = { text: "", updatedAt: this.now() };
      items[COMMENTS_KEY] = comments;
    }
    await this.storage.set(items);
  }

  public async loadLedger(): Promise<LedgerData> {
    const [snapshots, transfers, statements, comments, deletions] = await Promise.all([
      this.loadSnapshots(),
      this.loadTransfers(),
      this.loadStatements(),
      this.loadComments(),
      this.loadDeletions(),
    ]);
    return { snapshots, transfers, statements, comments, deletions };
  }

  public async replaceLedger(data: LedgerData): Promise<void> {
    await this.storage.set({
      [SNAPSHOTS_KEY]: data.snapshots,
      [TRANSFERS_KEY]: data.transfers,
      [STATEMENTS_KEY]: data.statements,
      [COMMENTS_KEY]: data.comments,
      [DELETIONS_KEY]: data.deletions,
    });
  }

  public async loadLastSyncedAt(): Promise<number | null> {
    const items = await this.storage.get(LAST_SYNCED_KEY);
    return (items[LAST_SYNCED_KEY] as number | undefined) ?? null;
  }

  public async markSynced(): Promise<void> {
    await this.storage.set({ [LAST_SYNCED_KEY]: this.now() });
  }

  public async loadLastCollectedAt(): Promise<number | null> {
    const items = await this.storage.get(LAST_COLLECTED_KEY);
    return (items[LAST_COLLECTED_KEY] as number | undefined) ?? null;
  }

  public async markCollected(): Promise<void> {
    await this.storage.set({ [LAST_COLLECTED_KEY]: this.now() });
  }

  public async loadSyncConfig(): Promise<SyncConfig | null> {
    const items = await this.storage.get(SYNC_CONFIG_KEY);
    return (items[SYNC_CONFIG_KEY] as SyncConfig | undefined) ?? null;
  }

  public async saveSyncConfig(config: SyncConfig): Promise<void> {
    await this.storage.set({ [SYNC_CONFIG_KEY]: config });
  }

  /** 空のコメントは削除。キーごと消さず削除の記録(tombstone)を残し、同期で復活しないようにする */
  public async setComment(key: string, text: string): Promise<void> {
    const comments = await this.loadComments();
    comments[key] = { text: text.trim(), updatedAt: this.now() };
    await this.storage.set({ [COMMENTS_KEY]: comments });
  }
}
