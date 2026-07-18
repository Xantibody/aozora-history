import type { BalanceSnapshot, Comments, TransferRecord } from "../domain/ledger.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";

export interface DashboardData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Comments;
  deletions: Record<string, number>;
  syncConfig: SyncConfig | null;
  lastSyncedAt: number | null;
}

export interface DashboardHandlers {
  onCommentChange: (key: string, text: string) => void;
  onDeleteTransfer: (transfer: TransferRecord) => void;
  onSaveSyncConfig: (config: SyncConfig) => Promise<string>;
  onSyncNow: () => Promise<string>;
  onImportFile: (text: string) => Promise<string>;
}

export interface DashboardOptions {
  handlers: DashboardHandlers;
  now?: () => number;
}

export type ViewTab = "log" | "accounts" | "history";
export type LogFilter = "all" | "transfer" | "in" | "out";

/** 再描画をまたいで保持するUI状態(選択中のタブ・期間・フィルタなど) */
export interface UiState {
  view: "dashboard" | "settings";
  activeTab: ViewTab;
  logFilter: LogFilter;
  filterAccountId: string | null;
  detailOpen: boolean;
  periodFrom: number | null;
  periodToExclusive: number | null;
  periodFromValue: string;
  periodToValue: string;
  monthValue: string;
  syncStatus: string;
  importStatus: string;
}

export function initialUiState(): UiState {
  return {
    view: "dashboard",
    activeTab: "log",
    logFilter: "all",
    filterAccountId: null,
    detailOpen: false,
    periodFrom: null,
    periodToExclusive: null,
    periodFromValue: "",
    periodToValue: "",
    monthValue: "",
    syncStatus: "",
    importStatus: "",
  };
}

/** 各セクションの描画関数に渡す描画コンテキスト */
export interface RenderContext {
  root: HTMLElement;
  data: DashboardData;
  handlers: DashboardHandlers;
  state: UiState;
  now: () => number;
  draw: () => void;
}
