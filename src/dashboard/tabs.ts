import { MUTED, el } from "./dom.ts";
import type { RenderContext } from "./context.ts";
import { balancePage } from "./balance-page.ts";
import { hasNoRecord } from "./empty-state.ts";
import { logSection } from "./log-tab.ts";

/** 選択中のページを描く。記録がまだ無ければ、どのページでも空の言葉だけを出す */
export function activeSection(ctx: RenderContext): HTMLElement {
  if (hasNoRecord(ctx)) {
    return el("p", `empty pt-4 ${MUTED}`, "まだ記録がありません");
  }
  return ctx.state.activeTab === "log" ? logSection(ctx) : balancePage(ctx);
}
