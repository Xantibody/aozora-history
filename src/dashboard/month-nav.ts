import { FINE_PRINT, INPUT, LINK_BUTTON, el } from "./dom.ts";
import { applyBounds, currentMonth, shiftMonth } from "./period.ts";
import type { RenderContext } from "./context.ts";

function selectMonth(ctx: RenderContext, value: string): void {
  ctx.state.monthValue = value;
  ctx.state.periodFromValue = "";
  ctx.state.periodToValue = "";
  applyBounds(ctx.state);
  ctx.draw();
}

const ROUND_BUTTON =
  "shrink-0 cursor-pointer rounded-full bg-white text-[13px] text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 max-sm:h-11 max-sm:w-11 sm:h-9 sm:w-9 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800";

function monthStepButton(ctx: RenderContext, delta: number): HTMLElement {
  const forward = delta > 0;
  const button = el(
    "button",
    `${forward ? "month-next" : "month-prev"} ${ROUND_BUTTON}`,
    forward ? "▶" : "◀",
  );
  button.title = forward ? "次の月" : "前の月";
  button.addEventListener("click", () => {
    const base = ctx.state.monthValue === "" ? currentMonth() : ctx.state.monthValue;
    selectMonth(ctx, shiftMonth(base, delta));
  });
  return button;
}

function monthInputEl(ctx: RenderContext): HTMLInputElement {
  const input = document.createElement("input");
  input.className =
    "month-input flex-1 cursor-pointer border-none bg-transparent text-center text-[15px] font-semibold tabular-nums focus:outline-2 focus:outline-sky-500 sm:max-w-44 sm:flex-none";
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

/** ◀ 月 ▶ のナビ。詳細指定を開くと日付範囲の入力に切り替えられる */
export function monthNav(ctx: RenderContext): HTMLElement {
  const node = el("div", "period flex flex-wrap items-center gap-x-1 gap-y-2 pt-3 pb-2");
  node.append(
    monthStepButton(ctx, -1),
    monthInputEl(ctx),
    monthStepButton(ctx, 1),
    detailToggle(ctx),
  );
  node.append(periodDetail(ctx));
  return node;
}
