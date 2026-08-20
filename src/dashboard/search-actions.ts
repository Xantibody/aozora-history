import type { AppliedSearch, RenderContext, UiState } from "./context.ts";
import { parseAmount } from "./search.ts";

/**
 * 検索パレットの開閉と適用。状態の書き換えだけを集め、
 * 画面(search-palette.ts)と候補(search-results.ts)の両方から使う
 */

/** いま入力中のクエリが指す検索。空なら何も指していない */
export function probeOf(state: UiState): AppliedSearch | null {
  if (state.searchQuery === "") {
    return null;
  }
  const amount = parseAmount(state.searchQuery);
  if (amount === null) {
    return { kind: "text", query: state.searchQuery };
  }
  return { kind: "amount", amount, tier: state.searchTier };
}

/** パレットを開いて入力へフォーカスする。狭い幅ではキーボードが上がる */
export function openSearch(ctx: RenderContext): void {
  ctx.state.searchOpen = true;
  ctx.state.searchQuery = "";
  ctx.draw();
  ctx.root.querySelector<HTMLInputElement>(".search-input")?.focus();
}

export function closeSearch(ctx: RenderContext): void {
  ctx.state.searchOpen = false;
  ctx.draw();
}

/** 検索はログの絞り込みなので、どの画面から適用してもログページへ運ぶ */
export function applySearch(ctx: RenderContext, applied: AppliedSearch): void {
  ctx.state.appliedSearch = applied;
  ctx.state.searchOpen = false;
  ctx.state.searchQuery = "";
  ctx.state.view = "dashboard";
  ctx.state.activeTab = "log";
  ctx.draw();
}

/** 別の入力に書いている最中の`/`は文字入力。パレットは奪わない */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

let activeKeyHandler: ((event: KeyboardEvent) => void) | null = null;

/**
 * グローバルキー。`/`でパレットを開き、Escで閉じる。
 * documentに残すのは常に1本だけ。描画のたびに足すと重複し、
 * テストがダッシュボードを作り直すと古いctxへ配線されたままになる
 */
export function attachSearchKeys(ctx: RenderContext): void {
  if (activeKeyHandler !== null) {
    document.removeEventListener("keydown", activeKeyHandler);
  }
  activeKeyHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && ctx.state.searchOpen) {
      closeSearch(ctx);
      return;
    }
    if (event.key !== "/" || ctx.state.searchOpen || isTyping(event.target)) {
      return;
    }
    // Firefoxのクイック検索(`/`)より、この画面では記録の検索を優先する
    event.preventDefault();
    openSearch(ctx);
  };
  document.addEventListener("keydown", activeKeyHandler);
}
