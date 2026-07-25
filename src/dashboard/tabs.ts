import type { RenderContext } from "./context.ts";
import { accountsSection } from "./accounts-tab.ts";
import { historySection } from "./history-tab.ts";
import { logSection } from "./log-tab.ts";
import { statementsSection } from "./statements-tab.ts";

/** 選択中のタブに対応するセクションを描く */
export function activeSection(ctx: RenderContext): HTMLElement {
  if (ctx.state.activeTab === "log") {
    return logSection(ctx);
  }
  if (ctx.state.activeTab === "accounts") {
    return accountsSection(ctx);
  }
  if (ctx.state.activeTab === "statements") {
    return statementsSection(ctx);
  }
  return historySection(ctx);
}
