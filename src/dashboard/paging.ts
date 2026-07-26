import { BORDER, INK_SOFT, SURFACE, el } from "./dom.ts";

/**
 * 長い一覧を「直近の分だけ組み立てて、続きは足す」形にするための道具。
 *
 * 記録が数年ぶんたまるとログも残高スナップショットも数千行になり、開くのも
 * 絞り込み直すのも重くなる。読むのは大抵いちばん新しいところなので、
 * 全部をDOMに起こさずに済ませる
 */

/** 最初から並べる件数と、「さらに表示」で足す件数 */
export const PAGE_SIZE = 100;

export interface Paging {
  limit: number;
  /** limitを積み上げた絞り込みの条件。変わったら最初の分まで戻す */
  limitFor: string;
}

export function initialPaging(): Paging {
  return { limit: PAGE_SIZE, limitFor: "" };
}

/**
 * この描画で並べる件数。絞り込みを変えたら最初の分まで戻す。
 * 前の絞り込みで積み上げた件数のまま別の並びを出すと、押した覚えのない
 * 「さらに表示」が効いた状態から読み始めることになる
 */
export function pageLimit(paging: Paging, key: string): number {
  if (paging.limitFor !== key) {
    paging.limitFor = key;
    paging.limit = PAGE_SIZE;
  }
  return paging.limit;
}

const MORE_BUTTON =
  "list-more w-full cursor-pointer rounded-[12px] py-3 text-[13px] transition-colors " +
  "hover:bg-[#f6f7f9] focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-sky-500 dark:hover:bg-[#1a222c]";

export function moreButton(rest: number, onMore: () => void): HTMLElement {
  const more = el(
    "button",
    `${MORE_BUTTON} ${SURFACE} ${BORDER} ${INK_SOFT}`,
    `さらに表示（残り${rest.toLocaleString("ja-JP")}件）`,
  );
  more.addEventListener("click", onMore);
  return more;
}
