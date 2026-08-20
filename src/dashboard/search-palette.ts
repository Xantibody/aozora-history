import { BADGE, BTN_PRIMARY, INK, INK_SOFT, INK_WEAK, SURFACE, el } from "./dom.ts";
import { applySearch, closeSearch, probeOf } from "./search-actions.ts";
import type { PaletteRefs } from "./search-results.ts";
import type { RenderContext } from "./context.ts";
import { icon } from "./icons.ts";
import { renderResults } from "./search-results.ts";

export { attachSearchKeys } from "./search-actions.ts";

/**
 * 検索パレットの枠。コメント検索と金額の揺れ検索を1つの入口で扱い、
 * 適用するとログページの絞り込みになる。
 * 広い幅ではオーバーレイのパレット、狭い幅では全画面シートとして同じ中身を出す
 */

const SEARCH_ICON_SIZE = 18;

function searchInput(ctx: RenderContext): HTMLInputElement {
  const input = el(
    "input",
    `search-input min-w-0 flex-1 bg-transparent text-base ${INK} outline-none ` +
      "max-sm:h-11 max-sm:rounded-full max-sm:px-4 max-sm:ring-1 max-sm:ring-[#dfe4ea] " +
      "max-sm:focus:ring-2 max-sm:focus:ring-sky-500 dark:max-sm:ring-[#243040]",
  ) as HTMLInputElement;
  input.placeholder = "メモ・相手先・金額（例: 家賃、85000）";
  input.value = ctx.state.searchQuery;
  input.setAttribute("aria-label", "記録を検索");
  return input;
}

function closeButton(ctx: RenderContext): HTMLElement {
  const close = el(
    "button",
    `search-close shrink-0 cursor-pointer bg-transparent text-sm ${INK_SOFT} sm:hidden`,
    "閉じる",
  );
  close.addEventListener("click", () => {
    closeSearch(ctx);
  });
  return close;
}

function searchBar(ctx: RenderContext, refs: PaletteRefs): HTMLElement {
  const bar = el(
    "div",
    "search-bar flex shrink-0 items-center gap-2.5 border-b border-[#e8ebf0] px-3.5 py-3 " +
      "sm:px-[18px] sm:py-3.5 dark:border-[#1e2733]",
  );
  refs.input.addEventListener("input", () => {
    ctx.state.searchQuery = refs.input.value;
    renderResults(ctx, refs);
  });
  refs.input.addEventListener("keydown", (event) => {
    const probe = probeOf(ctx.state);
    if (event.key === "Enter" && probe !== null) {
      applySearch(ctx, probe);
    }
  });
  const escBadge = el(
    "span",
    `search-esc ${BADGE} py-[2px] text-[11px] font-bold whitespace-nowrap max-sm:hidden`,
    "Esc で閉じる",
  );
  bar.append(
    icon("search", SEARCH_ICON_SIZE, `${INK_WEAK} max-sm:hidden`),
    refs.input,
    escBadge,
    closeButton(ctx),
  );
  return bar;
}

function hintSpan(key: string, text: string): HTMLElement {
  const hint = el("span", "inline-flex items-center gap-1.5");
  hint.append(el("span", `${BADGE} py-[1px] font-bold`, key), text);
  return hint;
}

/** 広い幅のキー操作の手引き。狭い幅はタップが操作なので出さない */
function footerHints(): HTMLElement {
  const hints = el(
    "div",
    `flex items-center gap-3.5 px-[18px] py-2.5 text-[11.5px] ${INK_WEAK} max-sm:hidden`,
  );
  hints.append(
    hintSpan("Enter", "ログをこの条件で絞り込む"),
    hintSpan("Esc", "閉じる"),
    el("span", "ml-auto", "コメント候補は使用回数 → 新しさの順"),
  );
  return hints;
}

/** 狭い幅の主ボタン。Enterの代わりに、いつでも届く最下部へ常設する */
function mobileApply(ctx: RenderContext): HTMLButtonElement {
  const apply = el(
    "button",
    `search-apply ${BTN_PRIMARY} min-h-11 w-full disabled:cursor-default disabled:opacity-40`,
  ) as HTMLButtonElement;
  apply.addEventListener("click", () => {
    const probe = probeOf(ctx.state);
    if (probe !== null) {
      applySearch(ctx, probe);
    }
  });
  return apply;
}

function paletteFooter(apply: HTMLButtonElement): HTMLElement {
  const footer = el(
    "div",
    "search-footer shrink-0 border-t border-[#e8ebf0] dark:border-[#1e2733]",
  );
  const applyRow = el("div", "p-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:hidden");
  applyRow.append(apply);
  footer.append(footerHints(), applyRow);
  return footer;
}

export function searchPalette(ctx: RenderContext): HTMLElement {
  const overlay = el(
    "div",
    "search-overlay fixed inset-0 z-20 sm:flex sm:items-start sm:justify-center " +
      "sm:bg-[rgba(15,23,42,.42)] sm:pt-[88px]",
  );
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeSearch(ctx);
    }
  });
  const panel = el(
    "div",
    `search-palette flex h-full w-full flex-col ${SURFACE} sm:h-auto sm:max-h-[min(560px,80vh)] ` +
      "sm:w-[640px] sm:max-w-[92vw] sm:overflow-hidden sm:rounded-[14px] " +
      "sm:shadow-[0_24px_64px_rgba(15,23,42,.3)]",
  );
  const refs: PaletteRefs = {
    results: el("div", "search-results min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5"),
    apply: mobileApply(ctx),
    input: searchInput(ctx),
  };
  panel.append(searchBar(ctx, refs), refs.results, paletteFooter(refs.apply));
  renderResults(ctx, refs);
  overlay.append(panel);
  return overlay;
}
