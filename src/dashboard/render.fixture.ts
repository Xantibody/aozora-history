// ダッシュボードの描画テストが共有する台帳と、見た目を読むための道具。
// Firefoxで走る *.dom.test.ts と、DOMを使わない node 側の両方から読む。
// getComputedStyle を呼ぶ関数はあるが、呼ぶのはブラウザ側のテストだけ。
import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import type { DashboardData, DashboardHandlers, ThemePreference } from "./render.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";
import { renderDashboard } from "./render.ts";
import { vi } from "vitest";

export const snapshots: BalanceSnapshot[] = [
  {
    takenAt: Date.UTC(2026, 6, 9, 13, 0),
    updatedAt: "2026/07/09 21:59",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 134_392 },
      { id: "133332", name: "02: 積立", balance: 82_520 },
    ],
  },
  {
    takenAt: Date.UTC(2026, 6, 10, 13, 34),
    updatedAt: "2026/07/10 22:34",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 129_392 },
      { id: "133332", name: "02: 積立", balance: 82_520 },
      { id: "133805", name: "03: 支払い箱", balance: 272_469 },
    ],
  },
];

export const transfers: TransferRecord[] = [
  {
    // 2つ目のスナップショット区間 (7/9 13:00, 7/10 13:34] の中
    transferredAt: Date.UTC(2026, 6, 10, 13, 30),
    from: { id: "133331", name: "01: お財布" },
    to: { id: "133332", name: "02: 積立" },
    amount: 5000,
  },
  {
    transferredAt: Date.UTC(2026, 6, 8, 0, 0),
    from: { id: "133332", name: "02: 積立" },
    to: { id: "133805", name: "03: 支払い箱" },
    amount: 30_000,
  },
];

// ログの内訳(全期間):
//   振替 2件 (5,000円 / 30,000円)
//   外部入出金 2件 (02: 積立 -5,000円、03: 支払い箱 +272,469円; どちらも2つ目のスナップショット時点)
//   残高記録 2件 (合計 216,912円 → 484,381円、期間の増減 +267,469円)

export const statements: StatementEntry[] = [
  {
    entryNumber: "0001",
    valueDate: "2026-07-23",
    amount: -4100,
    balance: 445_281,
    remark: "振込 ミツビシユーエフジエイ",
  },
  {
    entryNumber: "0001",
    valueDate: "2026-07-24",
    amount: 635_144,
    balance: 1_080_425,
    remark: "給与  カ）アツトマーク",
  },
  {
    entryNumber: "0002",
    valueDate: "2026-07-24",
    amount: -173_000,
    balance: 907_425,
    remark: "振込 ラクテン",
  },
];

const pad = (value: number): string => String(value).padStart(2, "0");

/** ヘッダーやログ行と同じ「M/D HH:MM」表記(ローカル時刻) */
export function shortDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dispatchTouch(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  point: { clientX: number; clientY: number },
): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "touches", { value: [point] });
  target.dispatchEvent(event);
}

export function swipe(target: Element, dx: number, dy = 0): void {
  dispatchTouch(target, "touchstart", { clientX: 200, clientY: 300 });
  dispatchTouch(target, "touchmove", { clientX: 200 + dx, clientY: 300 + dy });
  dispatchTouch(target, "touchend", { clientX: 200 + dx, clientY: 300 + dy });
}

/** 大きさの指定を除いた、色を表すクラスだけ */
export function dotColor(dot: Element): string {
  return [...dot.classList].filter((name) => name.includes("#")).join(" ");
}

/** 実際に描かれた文字色。クラス名ではなく計算結果を見る */
export function ink(node: Element): string {
  return getComputedStyle(node).color;
}

function channels(color: string): [number, number, number] {
  const [red = 0, green = 0, blue = 0] = [...color.matchAll(/\d+/gu)].map((match) =>
    Number(match[0]),
  );
  return [red, green, blue];
}

/** 明るいほど大きい。濃淡で語っているかを比べるために使う */
export function lightness(node: Element): number {
  const [red, green, blue] = channels(ink(node));
  return red + green + blue;
}

/** 彩度の代わり。0に近いほど無彩色。emerald/roseなら大きく出る */
export function chroma(node: Element): number {
  const rgb = channels(ink(node));
  return Math.max(...rgb) - Math.min(...rgb);
}

/**
 * 無彩色と見なす上限。使っているインク(#5b6675 で27、#0f172a で27)は下回り、
 * 極性を色で語る emerald(#10b981 で169)や rose は上回る
 */
export const ACHROMATIC_LIMIT = 60;

/** 右端の位置。列が揃っているかは座標で確かめる */
export function rightEdge(node: Element): number {
  return Math.round(node.getBoundingClientRect().right);
}

/** 場所を取っていて、実際に見えているか(display:none や幅0を弾く) */
export function visible(node: Element): boolean {
  return node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true });
}

/** 並べ替えたうえでの最小間隔。マーカーが重なっていないことの確認に使う */
export function minGap(values: number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  let min = Infinity;
  for (const [index, value] of sorted.slice(1).entries()) {
    min = Math.min(min, value - sorted[index]);
  }
  return min;
}

export function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    snapshots,
    transfers,
    statements: [],
    autoTransfers: [],
    comments: {},
    deletions: {},
    syncConfig: null,
    lastSyncedAt: null,
    debugMode: false,
    theme: "system",
    lastCollect: null,
    ...overrides,
  };
}

export type RenderResult = DashboardHandlers & { redraw: () => void };

/**
 * 記録は2026年7月に置いてあるので、既定の「いま」も同じ月に固定する。
 * 実時刻を使うと当月フィルタが月替わりで空振りし、月が変わった日にまとめて赤くなる。
 */
export const defaultNow = (): number => Date.UTC(2026, 6, 27, 0, 0);

export function render(root: HTMLElement, dashboardData = data(), now = defaultNow): RenderResult {
  const handlers = {
    onCommentChange: vi.fn<(key: string, text: string) => void>(),
    onDeleteTransfer: vi.fn<(transfer: TransferRecord) => void>(),
    onSaveSyncConfig: vi.fn<(config: SyncConfig) => Promise<string>>(() =>
      Promise.resolve("保存しました"),
    ),
    onSyncNow: vi.fn<() => Promise<string>>(() => Promise.resolve("同期しました")),
    onImportFile: vi.fn<(text: string) => Promise<string>>(() => Promise.resolve("読み込みました")),
    onToggleDebug: vi.fn<(enabled: boolean) => void>(),
    onChangeTheme: vi.fn<(preference: ThemePreference) => void>(),
    onRequestCollect: vi.fn<() => void>(),
  };
  const redraw = renderDashboard(root, dashboardData, { handlers, now });
  return { ...handlers, redraw };
}
