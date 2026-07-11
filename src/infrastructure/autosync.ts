import type { LedgerData } from "../domain/merge.ts";
import type { SyncConfig } from "./r2sync.ts";
import { type HistoryStore, LEDGER_KEYS } from "./storage.ts";

/** syncWithR2互換: ローカルとリモートをマージして両方へ書き戻し、結果を返す */
export type SyncRunner = (config: SyncConfig) => Promise<LedgerData>;

/**
 * 台帳の変更をデバウンスしてR2と同期する。
 * 同期自身がローカルへ書き戻す変更では再同期しない(無限ループ防止)。
 */
export class AutoSync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private pending = false;
  private lastSynced: string | null = null;

  constructor(
    private readonly store: HistoryStore,
    private readonly runSync: SyncRunner,
    private readonly delayMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** storage.onChanged のハンドラ。台帳以外のキーの変更は無視する */
  handleChange(changes: Record<string, unknown>): void {
    if (!LEDGER_KEYS.some((key) => key in changes)) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, this.delayMs);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      const config = await this.store.loadSyncConfig();
      if (config === null) return;
      const local = await this.store.loadLedger();
      if (JSON.stringify(local) === this.lastSynced) return;
      const merged = await this.runSync(config);
      this.lastSynced = JSON.stringify(merged);
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        this.schedule();
      }
    }
  }
}
