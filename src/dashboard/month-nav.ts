import { FINE_PRINT, INK, INK_SOFT, INPUT, LINK_BUTTON, el } from "./dom.ts";
import { applyBounds, currentMonth, shiftMonth } from "./period.ts";
import type { RenderContext } from "./context.ts";
import { icon } from "./icons.ts";

function selectMonth(ctx: RenderContext, value: string): void {
  ctx.state.monthValue = value;
  ctx.state.periodFromValue = "";
  ctx.state.periodToValue = "";
  applyBounds(ctx.state);
  ctx.draw();
}

/** タップ標的は44px以上を確保しつつ、見た目の面は28pxに収めて主役を譲る */
const STEP_BUTTON =
  `flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent ${INK_SOFT} ` +
  "transition-colors hover:bg-[#eef1f5] focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-sky-500 max-sm:h-11 max-sm:w-11 sm:h-7 sm:w-7 dark:hover:bg-[#1e2733]";

const STEP_ICON_SIZE = 16;

function monthStepButton(ctx: RenderContext, delta: number): HTMLElement {
  const forward = delta > 0;
  const button = el("button", `${forward ? "month-next" : "month-prev"} ${STEP_BUTTON}`);
  button.append(icon(forward ? "chevron-right" : "chevron-left", STEP_ICON_SIZE));
  button.title = forward ? "次の月" : "前の月";
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => {
    const base = ctx.state.monthValue === "" ? currentMonth() : ctx.state.monthValue;
    selectMonth(ctx, shiftMonth(base, delta));
  });
  return button;
}

function monthInputEl(ctx: RenderContext): HTMLInputElement {
  const input = document.createElement("input");
  input.className =
    `month-input w-[9.5rem] cursor-pointer border-none bg-transparent text-center text-[13px] font-bold tabular-nums ${INK} ` +
    "focus:outline-2 focus:outline-sky-500";
  input.type = "month";
  input.name = "period-month";
  input.value = ctx.state.monthValue;
  input.title = "表示月(空欄は全期間)";
  input.addEventListener("change", () => {
    selectMonth(ctx, input.value);
  });
  return input;
}

function detailToggle(ctx: RenderContext): HTMLElement {
  const toggle = el("button", `period-detail-toggle ${LINK_BUTTON} ml-1 text-[13px]`, "詳細指定");
  toggle.setAttribute("aria-expanded", String(ctx.state.detailOpen));
  toggle.addEventListener("click", () => {
    ctx.state.detailOpen = !ctx.state.detailOpen;
    ctx.draw();
  });
  return toggle;
}

function applyDateInput(ctx: RenderContext, which: "from" | "to", value: string): void {
  ctx.state.monthValue = "";
  if (which === "from") {
    ctx.state.periodFromValue = value;
  } else {
    ctx.state.periodToValue = value;
  }
  applyBounds(ctx.state);
  ctx.draw();
}

function dateInputEl(ctx: RenderContext, which: "from" | "to"): HTMLInputElement {
  const input = document.createElement("input");
  input.className = `${INPUT} py-1`;
  input.type = "date";
  input.name = which === "from" ? "period-from" : "period-to";
  input.value = which === "from" ? ctx.state.periodFromValue : ctx.state.periodToValue;
  input.addEventListener("change", () => {
    applyDateInput(ctx, which, input.value);
  });
  return input;
}

function periodDetail(ctx: RenderContext): HTMLElement {
  const detail = el(
    "div",
    `period-detail w-full flex-wrap items-center gap-2 ${ctx.state.detailOpen ? "flex" : "hidden"}`,
  );
  const clear = el("button", `period-clear ${LINK_BUTTON} text-sm`, "クリア");
  clear.addEventListener("click", () => {
    selectMonth(ctx, "");
  });
  detail.append(
    el("span", `period-label ${FINE_PRINT}`, "期間:"),
    dateInputEl(ctx, "from"),
    el("span", "period-separator", "〜"),
    dateInputEl(ctx, "to"),
    clear,
  );
  return detail;
}

/**
 * ◀ 月 ▶ のナビ。ヘッダーの1段目に置く。独立した段にすると
 * 合計・鮮度・タブと合わせて4段積みになり、本文が押し下げられるため
 */
export function monthNav(ctx: RenderContext): HTMLElement {
  const node = el("div", "period flex flex-wrap items-center gap-x-1 gap-y-2");
  node.append(
    monthStepButton(ctx, -1),
    monthInputEl(ctx),
    monthStepButton(ctx, 1),
    detailToggle(ctx),
  );
  node.append(periodDetail(ctx));
  return node;
}
