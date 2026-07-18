import type { DashboardData, DashboardOptions, RenderContext } from "./context.ts";
import { MUTED, el } from "./dom.ts";
import { accountsSection } from "./accounts-tab.ts";
import { header } from "./header.ts";
import { historySection } from "./history-tab.ts";
import { initialUiState } from "./context.ts";
import { latestRecordAt } from "../domain/ledger.ts";
import { logSection } from "./log-tab.ts";
import { monthNav } from "./month-nav.ts";
import { settingsView } from "./settings.ts";
import { suggestionList } from "./comment-input.ts";

export { transfersCsv } from "./csv.ts";
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

function activeSection(ctx: RenderContext): HTMLElement {
  if (ctx.state.activeTab === "log") {
    return logSection(ctx);
  }
  if (ctx.state.activeTab === "accounts") {
    return accountsSection(ctx);
  }
  return historySection(ctx);
}

function drawView(ctx: RenderContext): void {
  ctx.root.replaceChildren();
  if (ctx.state.view === "settings") {
    ctx.root.append(settingsView(ctx));
    return;
  }
  const main = el("main", "mx-auto max-w-[760px] px-4 pb-8 sm:px-6");
  ctx.root.append(suggestionList(ctx.data.comments), header(ctx), main);
  if (latestRecordAt(ctx.data.snapshots, ctx.data.transfers) === null) {
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
      handlers: options.handlers,
      state: initialUiState(),
      now: options.now ?? Date.now,
      draw: (): void => {
        this.draw();
      },
    };
  }

  public draw(): void {
    const restoreFocus = captureFocus(this.ctx.root);
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
