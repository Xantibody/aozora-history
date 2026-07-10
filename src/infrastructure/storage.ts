import { appendSnapshot, type BalanceSnapshot, type TransferRecord } from "../domain/ledger.ts";

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const SNAPSHOTS_KEY = "balanceSnapshots";
const TRANSFERS_KEY = "transferRecords";
const COMMENTS_KEY = "comments";

export type Comments = Record<string, string>;

export function addTransfer(
  transfers: TransferRecord[],
  transfer: TransferRecord,
): TransferRecord[] {
  return [...transfers, transfer];
}

export class HistoryStore {
  constructor(private readonly storage: StorageArea) {}

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
    return (items[COMMENTS_KEY] as Comments | undefined) ?? {};
  }

  /** 空のコメントは削除として扱う */
  async setComment(key: string, text: string): Promise<void> {
    const comments = await this.loadComments();
    const trimmed = text.trim();
    if (trimmed === "") {
      delete comments[key];
    } else {
      comments[key] = trimmed;
    }
    await this.storage.set({ [COMMENTS_KEY]: comments });
  }
}
