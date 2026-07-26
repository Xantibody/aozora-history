import type { BalanceSnapshot, Comments, TransferRecord } from "../domain/ledger.ts";
import { applyBounds, monthOf } from "./period.ts";
import type { AccountColor } from "./dom.ts";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { CollectReport } from "../domain/diagnostics.ts";
import type { Reconciled } from "../domain/reconcile.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";

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
  /** 次に銀行サイトを開いたときの取り込みを、間隔を待たずに走らせる */
  onRequestCollect: () => void;
}

export interface DashboardOptions {
  handlers: DashboardHandlers;
  now?: () => number;
}

/**
 * 「ログ」は毎日開いて取引を読むページ、「残高」は週に数回、口座の配分と
 * 推移を見るページ。1画面に全部載せると情報量が多すぎるため役割で分けている
 */
export type ViewTab = "log" | "balance";
export type LogFilter = "all" | "transfer" | "in" | "out";
export type StatementFilter = "all" | "in" | "out";

/** 再描画をまたいで保持するUI状態(選択中のタブ・期間・フィルタなど) */
export interface UiState {
  view: "dashboard" | "settings";
  activeTab: ViewTab;
  logFilter: LogFilter;
  statementFilter: StatementFilter;
  filterAccountId: string | null;
  detailOpen: boolean;
  /**
   * 推移で選んだ区間。残高ページで選び、ログページで絞り込みとして効く。
   * ページをまたいで保つことで「この山は何だったのか」を辿れる
   */
  selectedSpan: { from: number; to: number } | null;
  periodFrom: number | null;
  periodToExclusive: number | null;
  periodFromValue: string;
  periodToValue: string;
  monthValue: string;
  syncStatus: string;
  importStatus: string;
}

/**
 * 開いたときは当月を表示する。記録が増えるほど全期間は見るものが多くなり、
 * 直近の出入りを確かめたいという普段の使い方から遠ざかるため
 */
export function initialUiState(now: () => number = Date.now): UiState {
  const state: UiState = {
    view: "dashboard",
    activeTab: "log",
    logFilter: "all",
    statementFilter: "all",
    filterAccountId: null,
    detailOpen: false,
    selectedSpan: null,
    periodFrom: null,
    periodToExclusive: null,
    periodFromValue: "",
    periodToValue: "",
    monthValue: monthOf(now()),
    syncStatus: "",
    importStatus: "",
  };
  applyBounds(state);
  return state;
}

/**
 * 狭い幅かどうか。ホバーが使えず縦も横も足りないため、行の組み方と
 * タブの置き場所を変える。判定は描画のたびに読み直す(回転や分割表示で変わる)
 */
export function isNarrow(): boolean {
  return globalThis.matchMedia?.("(max-width: 639px)").matches === true;
}

/** 各セクションの描画関数に渡す描画コンテキスト */
export interface RenderContext {
  root: HTMLElement;
  data: DashboardData;
  /**
   * 差額を拾い直した台帳。集計と表示はこちらを使う。
   * dataは保存された記録そのもので、定額自動振替のように拡張が検知できない
   * 口座間の移動が入っていないため、そのまま集計すると収支が合わない
   */
  ledger: Reconciled;
  /** 口座の色。並び順で決めるため、口座一覧を持っている描画側で解決する */
  colorOf: (accountId: string) => AccountColor;
  handlers: DashboardHandlers;
  state: UiState;
  now: () => number;
  draw: () => void;
}
