import type { RenderContext } from "./context.ts";
import { balancePage } from "./balance-page.ts";
import { logSection } from "./log-tab.ts";

/** 選択中のページを描く */
export function activeSection(ctx: RenderContext): HTMLElement {
  return ctx.state.activeTab === "log" ? logSection(ctx) : balancePage(ctx);
}
