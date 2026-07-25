import { formatDateTime, formatYen } from "./format.ts";
import type { RenderContext } from "./context.ts";
import type { TransferRecord } from "../domain/ledger.ts";
import { el } from "./dom.ts";

export function transferDetail(transfer: TransferRecord): string {
  return `${formatDateTime(transfer.transferredAt)} ${transfer.from.name} → ${transfer.to.name} ${formatYen(transfer.amount)}`;
}

export function confirmDeleteTransfer(
  ctx: RenderContext,
  transfer: TransferRecord,
  detail: string,
): void {
  if (!globalThis.confirm(`この振替の記録を削除しますか?\n${detail}`)) {
    return;
  }
  ctx.handlers.onDeleteTransfer(transfer);
  ctx.draw();
}

// モバイルのスワイプ削除で見せるパネルの幅
const SWIPE_PANEL_PX = 72;
const HALF = 2;

interface SwipeGesture {
  open: boolean;
  swiped: boolean;
  dragging: boolean;
  startX: number;
  startY: number;
  lastDx: number;
}

export interface SwipeHandle {
  settle: () => boolean;
}

function swipeDeletePanel(ctx: RenderContext, transfer: TransferRecord): HTMLElement {
  const detail = transferDetail(transfer);
  const panel = el(
    "button",
    "swipe-delete absolute inset-y-0 right-0 w-[72px] cursor-pointer bg-rose-700 text-[13px] font-semibold text-white sm:hidden dark:bg-rose-400 dark:text-slate-950",
    "削除",
  );
  panel.setAttribute("aria-label", `振替を削除: ${detail}`);
  panel.addEventListener("click", () => {
    confirmDeleteTransfer(ctx, transfer, detail);
  });
  return panel;
}

function settleSwipe(gesture: SwipeGesture, setOffset: (px: number) => void): boolean {
  if (gesture.open) {
    gesture.open = false;
    gesture.swiped = false;
    setOffset(0);
    return true;
  }
  if (gesture.swiped) {
    gesture.swiped = false;
    return true;
  }
  return false;
}

function trackSwipe(
  row: HTMLElement,
  gesture: SwipeGesture,
  setOffset: (px: number) => void,
): void {
  row.addEventListener(
    "touchstart",
    (event) => {
      gesture.startX = event.touches[0].clientX;
      gesture.startY = event.touches[0].clientY;
      gesture.dragging = false;
    },
    { passive: true },
  );
  row.addEventListener(
    "touchmove",
    (event) => {
      const moveX = event.touches[0].clientX - gesture.startX;
      const moveY = event.touches[0].clientY - gesture.startY;
      // 縦方向の動きが主ならページのスクロールを優先する
      if (!gesture.dragging && Math.abs(moveY) > Math.abs(moveX)) {
        return;
      }
      gesture.dragging = true;
      gesture.lastDx = moveX + (gesture.open ? -SWIPE_PANEL_PX : 0);
      setOffset(Math.max(-SWIPE_PANEL_PX, Math.min(0, gesture.lastDx)));
    },
    { passive: true },
  );
  row.addEventListener("touchend", () => {
    if (!gesture.dragging) {
      return;
    }
    gesture.swiped = true;
    gesture.open = gesture.lastDx < -SWIPE_PANEL_PX / HALF;
    setOffset(gesture.open ? -SWIPE_PANEL_PX : 0);
  });
}

/**
 * モバイルの左スワイプ削除。行の中身を滑らせて右端の削除パネルを見せる。
 * settle()はタップがスワイプの後始末(閉じる等)で消費されたかを返す
 */
export function attachSwipeDelete(
  ctx: RenderContext,
  parts: { row: HTMLElement; slider: HTMLElement },
  transfer: TransferRecord,
): SwipeHandle {
  parts.row.prepend(swipeDeletePanel(ctx, transfer));
  const gesture: SwipeGesture = {
    open: false,
    swiped: false,
    dragging: false,
    startX: 0,
    startY: 0,
    lastDx: 0,
  };
  const setOffset = (px: number): void => {
    parts.slider.style.transform = `translateX(${px}px)`;
  };
  trackSwipe(parts.row, gesture, setOffset);
  return { settle: () => settleSwipe(gesture, setOffset) };
}
