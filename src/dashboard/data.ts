import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { CollectReport } from "../domain/diagnostics.ts";
import type { Comments } from "../domain/comments.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";

/**
 * 画面に出す記録一式と、画面からの操作の受け口。
 *
 * 記録の種類が増えるたびにここへ足すため、UI状態(context.ts)とは分けている
 * (混ぜると、状態の型を読むのに記録の型を全部通ることになる)
 */

export interface DashboardData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  /** 代表口座とつかいわけ口座の入出金明細。銀行APIから取得したもの */
  statements: StatementEntry[];
  /** つかいわけ口座の定額自動振替の設定。銀行APIから取得したもの */
  autoTransfers: AutoTransferSetting[];
  comments: Comments;
  deletions: Record<string, number>;
  syncConfig: SyncConfig | null;
  lastSyncedAt: number | null;
  /** 設定画面にデバッグ欄を出すか */
  debugMode: boolean;
  /** 画面の明暗。端末ごとの見え方の設定なので、他端末とは同期しない */
  theme: ThemePreference;
  /** 最後に銀行APIを取り込んだ結果。まだ一度も走っていなければnull */
  lastCollect: CollectReport | null;
}

export interface DashboardHandlers {
  onCommentChange: (key: string, text: string) => void;
  onDeleteTransfer: (transfer: TransferRecord) => void;
  onSaveSyncConfig: (config: SyncConfig) => Promise<string>;
  onSyncNow: () => Promise<string>;
  onImportFile: (text: string) => Promise<string>;
  onToggleDebug: (enabled: boolean) => void;
  onChangeTheme: (preference: ThemePreference) => void;
  /** 次に銀行サイトを開いたときの取り込みを、間隔を待たずに走らせる */
  onRequestCollect: () => void;
}

export interface DashboardOptions {
  handlers: DashboardHandlers;
  now?: () => number;
}

/**
 * 画面の明暗。OSの設定に従うのを既定にしつつ、明示的に固定もできる。
 * 家計を見る画面は昼にも夜にも開くため、端末の自動切り替えと
 * 見たい明るさが一致しないことがある
 */
export type ThemePreference = "system" | "light" | "dark";
