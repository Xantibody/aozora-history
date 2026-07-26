import type { RenderContext } from "./context.ts";
import { el } from "./dom.ts";
import { snapshotSection } from "./history-tab.ts";
import { trendPanel } from "./trend-panel.ts";
import { workspaceGrid } from "./accounts-tab.ts";

/**
 * 残高ページ。口座カード・推移・スナップショット一覧という「大きい面」を
 * ここに集め、ログページは取引を読むことに専念させる。
 * 週に数回しか見ないものを毎日開くページに置くと、読む対象が埋もれるため
 */
export function balancePage(ctx: RenderContext): HTMLElement {
  const node = el("div", "balance flex flex-col gap-5 pt-1");
  node.append(workspaceGrid(ctx), trendPanel(ctx), snapshotSection(ctx));
  return node;
}
