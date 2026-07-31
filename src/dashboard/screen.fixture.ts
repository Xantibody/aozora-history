// 画面の広さを変えるための道具。ブラウザで走るテストからだけ読む
// (node側のテストが読むと @vitest/browser/context の解決で落ちるため分けている)
import { page } from "@vitest/browser/context";

/** 下部バーに切り替わる境界(Tailwindのsm=640px)より狭い側 */
export function usePhone(): Promise<void> {
  return page.viewport(375, 812);
}

/** 既定の広さへ戻す。vitest.config.ts の viewport と同じ値 */
export function useWideScreen(): Promise<void> {
  return page.viewport(1280, 800);
}
