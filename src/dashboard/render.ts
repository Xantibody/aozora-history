import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import type { DashboardData, DashboardOptions, RenderContext } from "./context.ts";
import { MUTED, accountColorAt, el } from "./dom.ts";
import { accountRefs, latestRecordAt } from "../domain/ledger.ts";
import type { AccountColor } from "./dom.ts";
import { activeSection } from "./tabs.ts";
import { header } from "./header.ts";
import { initialUiState } from "./context.ts";
import { monthNav } from "./month-nav.ts";
import { reconcile } from "../domain/reconcile.ts";
import { settingsView } from "./settings.ts";
import { suggestionList } from "./comment-input.ts";

export { statementsCsv, transfersCsv } from "./csv.ts";
export { formatDateTime, formatSigned, formatYen } from "./format.ts";
export type { DashboardData, DashboardHandlers, DashboardOptions } from "./context.ts";

/**
 * 再描画でフォーカスが失われないよう、描画前の位置を覚えて復元する関数を返す。
 * 要素は作り直されるため、意味マーカー(クラス名の先頭)とname/aria-label/
 * テキストで同じ役割の要素を探し直す
 */
function captureFocus(root: HTMLElement): (() => void) | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    return null;
  }
  const [marker] = active.classList;
  if (marker === undefined || !/^[a-z][\w-]*$/iu.test(marker)) {
    return null;
  }
  const name = active.getAttribute("name");
  const label = active.getAttribute("aria-label");
  const text = active.textContent;
  return () => {
    const candidates = [...root.querySelectorAll<HTMLElement>(`.${marker}`)];
    const target =
      candidates.find((candidate) => name !== null && candidate.getAttribute("name") === name) ??
      candidates.find(
        (candidate) => label !== null && candidate.getAttribute("aria-label") === label,
      ) ??
      candidates.find((candidate) => candidate.textContent === text) ??
      candidates[0];
    target?.focus();
  };
}

/** 口座の並び順で色を割り当てる。同じ口座には常に同じ色が付く */
function colorResolver(
  snapshots: BalanceSnapshot[],
  transfers: TransferRecord[],
): (accountId: string) => AccountColor {
  const indexById = new Map(accountRefs(snapshots, transfers).map((ref, index) => [ref.id, index]));
  return (accountId): AccountColor => accountColorAt(indexById.get(accountId) ?? 0);
}

function drawView(ctx: RenderContext): void {
  ctx.root.replaceChildren();
  if (ctx.state.view === "settings") {
    ctx.root.append(settingsView(ctx));
    return;
  }
  const main = el("main", "mx-auto max-w-[760px] px-4 pb-8 sm:px-6");
  ctx.root.append(suggestionList(ctx.data.comments), header(ctx), main);
  if (
    latestRecordAt(ctx.data.snapshots, ctx.data.transfers) === null &&
    ctx.data.statements.length === 0
  ) {
    main.append(el("p", `empty pt-4 ${MUTED}`, "まだ記録がありません"));
    return;
  }
  main.append(monthNav(ctx), activeSection(ctx));
}

class DashboardView {
  private readonly ctx: RenderContext;

  public constructor(root: HTMLElement, data: DashboardData, options: DashboardOptions) {
    this.ctx = {
      root,
      data,
      ledger: reconcile(data.snapshots, data.transfers, data.autoTransfers),
      // 実際の割り当ては描画のたびに作り直す
      colorOf: (): AccountColor => accountColorAt(0),
      handlers: options.handlers,
      state: initialUiState(options.now ?? Date.now),
      now: options.now ?? Date.now,
      draw: (): void => {
        this.draw();
      },
    };
  }

  public draw(): void {
    const restoreFocus = captureFocus(this.ctx.root);
    // dataは同期や銀行APIの取得で描画の合間に差し替わるため、毎回照合し直す
    this.ctx.ledger = reconcile(
      this.ctx.data.snapshots,
      this.ctx.data.transfers,
      this.ctx.data.autoTransfers,
    );
    this.ctx.colorOf = colorResolver(this.ctx.data.snapshots, this.ctx.ledger.transfers);
    drawView(this.ctx);
    restoreFocus?.();
  }
}

/**
 * ダッシュボードを描画する。戻り値の再描画関数は選択中のタブや期間などの
 * UI状態を保ったまま、dataの現在の内容を描き直す(自動更新用)
 */
export function renderDashboard(
  root: HTMLElement,
  data: DashboardData,
  options: DashboardOptions,
): () => void {
  const view = new DashboardView(root, data, options);
  view.draw();
  return (): void => {
    view.draw();
  };
}
