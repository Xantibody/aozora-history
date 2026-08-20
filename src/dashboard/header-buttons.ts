import { INK_SOFT, el } from "./dom.ts";
import { nextTheme, themeIcon, themeLabel } from "./theme.ts";
import type { RenderContext } from "./context.ts";
import { icon } from "./icons.ts";
import { openSearch } from "./search-actions.ts";

/** ヘッダー右上の丸ボタン群。見た目を揃えるためにひとつの場所で持つ */

const ICON_SIZE = 17;

const ROUND_BUTTON =
  `flex shrink-0 cursor-pointer items-center justify-center rounded-full ${INK_SOFT} ` +
  "bg-[#f4f6f9] ring-1 ring-[#e4e8ee] transition-colors hover:bg-[#eef1f5] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 " +
  "dark:bg-[#1a222c] dark:ring-[#243040] dark:hover:bg-[#1e2733]";

/**
 * 画面の明暗。押すたびに システム → ライト → ダーク と巡る。
 * 設定画面には置かず、見た目を変えるものは見ながら試せる場所に出す。
 * 歯車と違って狭い幅でも隠さない(下部バーに他の入口がないため)
 */
export function themeButton(ctx: RenderContext): HTMLElement {
  const preference = ctx.data.theme;
  const button = el("button", `theme-button ${ROUND_BUTTON} h-[34px] w-[34px]`);
  button.append(icon(themeIcon(preference), ICON_SIZE));
  const label = `テーマ: ${themeLabel(preference)}`;
  button.title = `${label}(クリックで切り替え)`;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    ctx.handlers.onChangeTheme(nextTheme(preference));
    ctx.draw();
  });
  return button;
}

/** 検索の入口。狭い幅の入口は下部バーの「検索」タブなので、ここでは隠す */
export function searchButton(ctx: RenderContext): HTMLElement {
  const button = el(
    "button",
    `search-button ${ROUND_BUTTON} max-sm:hidden sm:h-[34px] sm:w-[34px]`,
  );
  button.append(icon("search", ICON_SIZE));
  button.title = "検索（/ キー）";
  button.setAttribute("aria-label", "検索");
  button.addEventListener("click", () => {
    openSearch(ctx);
  });
  return button;
}

export function settingsButton(ctx: RenderContext): HTMLElement {
  const button = el(
    "button",
    `settings-button ${ROUND_BUTTON} max-sm:hidden sm:h-[34px] sm:w-[34px]`,
  );
  button.append(icon("settings-2", ICON_SIZE));
  button.title = "設定";
  button.setAttribute("aria-label", "設定");
  button.addEventListener("click", () => {
    ctx.state.view = "settings";
    ctx.draw();
  });
  return button;
}
