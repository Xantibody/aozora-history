import { INK, INK_SOFT, SURFACE, el } from "./dom.ts";
import type { IconName } from "./icons.ts";
import type { RenderContext } from "./context.ts";
import { icon } from "./icons.ts";
import { openSearch } from "./search-actions.ts";

/**
 * 狭い幅のページ切り替え。ヘッダーに置くと、片手で持ったときに親指から
 * いちばん遠い場所に主要な操作が来てしまう。設定もここに入れることで、
 * ヘッダーの右上から歯車を外して1段目に余白を作れる
 */

const ICON_SIZE = 20;
/** タップ標的は44px以上。バー自体は56pxで、下は端末のインジケータぶんを空ける */
const BAR =
  "bottom-tabs fixed inset-x-0 bottom-0 z-10 flex h-14 items-stretch border-t border-[#e8ebf0] " +
  "pb-[env(safe-area-inset-bottom)] sm:hidden dark:border-[#1e2733]";

interface TabDef {
  key: "log" | "balance" | "search" | "settings";
  label: string;
  name: IconName;
}

const TABS: TabDef[] = [
  { key: "log", label: "ログ", name: "list" },
  { key: "balance", label: "残高", name: "chart-line" },
  { key: "search", label: "検索", name: "search" },
  { key: "settings", label: "設定", name: "settings-2" },
];

function isActive(ctx: RenderContext, def: TabDef): boolean {
  if (def.key === "search") {
    return ctx.state.searchOpen;
  }
  return def.key === "settings"
    ? ctx.state.view === "settings"
    : ctx.state.view === "dashboard" && ctx.state.activeTab === def.key;
}

function select(ctx: RenderContext, def: TabDef): void {
  // 検索はページではなくシート。いまのページの上に重ねて開く
  if (def.key === "search") {
    openSearch(ctx);
    return;
  }
  if (def.key === "settings") {
    ctx.state.view = "settings";
  } else {
    ctx.state.view = "dashboard";
    ctx.state.activeTab = def.key;
  }
  ctx.draw();
}

function bottomTab(ctx: RenderContext, def: TabDef): HTMLElement {
  const active = isActive(ctx, def);
  const tab = el(
    "button",
    `bottom-tab flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 ` +
      `bg-transparent text-[11px] ${active ? `active font-bold ${INK}` : INK_SOFT}`,
  );
  tab.append(icon(def.name, ICON_SIZE), el("span", undefined, def.label));
  tab.setAttribute("aria-current", String(active));
  tab.addEventListener("click", () => {
    select(ctx, def);
  });
  return tab;
}

export function bottomTabs(ctx: RenderContext): HTMLElement {
  const bar = el("nav", `${BAR} ${SURFACE}`);
  bar.setAttribute("aria-label", "ページ切り替え");
  for (const def of TABS) {
    bar.append(bottomTab(ctx, def));
  }
  return bar;
}
