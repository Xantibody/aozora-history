import { BTN_SECONDARY, FINE_PRINT, MUTED, el, section } from "./dom.ts";
import type { CollectReport, CollectStat } from "../domain/diagnostics.ts";
import type { RenderContext } from "./context.ts";
import { describeStat } from "../domain/diagnostics.ts";
import { formatDateTime } from "./format.ts";

/**
 * 銀行APIの取り込みはログイン中のタブで裏側で走るため、失敗しても画面には
 * 何も出ない。何が取れて何が取れなかったのかを、コンソールを見に行かなくても
 * 確かめられるようにする。
 *
 * 常に出すと普段の利用の邪魔になるので、トグルを入れている間だけ出す
 */

/** 「つかいわけ口座の残高 3件 · 変化なし」のような1行 */
function statRow(label: string, stat: CollectStat): HTMLElement {
  const row = el("div", "collect-stat flex justify-between gap-3 py-0.5 text-sm");
  row.append(el("span", undefined, label));
  const value = el("span", "tabular-nums", describeStat(stat));
  if (stat.count === null) {
    value.classList.add("text-rose-700", "dark:text-rose-400");
  }
  row.append(value);
  return row;
}

function statRows(report: CollectReport): HTMLElement[] {
  return [
    el("p", `collect-at ${FINE_PRINT}`, formatDateTime(report.at)),
    statRow("つかいわけ口座の残高", report.balances),
    statRow("代表口座の明細", report.statements),
    statRow("つかいわけ口座の明細", report.accountStatements),
    statRow("定額自動振替の設定", report.autoTransfers),
    ...report.errors.map((message) =>
      el("p", "collect-error mt-1 text-sm text-rose-700 dark:text-rose-400", message),
    ),
  ];
}

function lastCollectBody(report: CollectReport | null): HTMLElement[] {
  if (report === null) {
    return [el("p", MUTED, "まだ取り込みが走っていません。銀行サイトにログインして開いてください")];
  }
  if (report.skipped) {
    const when = formatDateTime(report.at);
    return [el("p", MUTED, `${when} · 前回から間隔が空いていないため見送り`)];
  }
  return statRows(report);
}

function lastCollectView(report: CollectReport | null): HTMLElement {
  const node = el("div", "last-collect mt-1");
  node.append(...lastCollectBody(report));
  return node;
}

function debugToggle(ctx: RenderContext): HTMLElement {
  const row = el("label", "debug-toggle flex items-center gap-2 text-sm");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "debug-mode";
  input.checked = ctx.data.debugMode;
  input.addEventListener("change", () => {
    ctx.handlers.onToggleDebug(input.checked);
    ctx.draw();
  });
  row.append(input, el("span", undefined, "デバッグ表示と取り込みログを有効にする"));
  return row;
}

function collectNowButton(ctx: RenderContext): HTMLElement {
  const button = el("button", `collect-now ${BTN_SECONDARY} mt-3`, "今すぐ取り込む");
  button.addEventListener("click", () => {
    ctx.handlers.onRequestCollect();
    ctx.draw();
  });
  return button;
}

export function debugSection(ctx: RenderContext): HTMLElement {
  const node = section("debug", "デバッグ");
  node.append(debugToggle(ctx));
  if (!ctx.data.debugMode) {
    return node;
  }
  node.append(
    lastCollectView(ctx.data.lastCollect),
    collectNowButton(ctx),
    el(
      "p",
      `note ${FINE_PRINT}`,
      "取り込みは銀行サイトのタブでしか行えません。ログイン中のタブを開いたまま押すと" +
        "その場で走り、開いていなければ次に銀行サイトを開いたときに間隔を待たずに走ります。",
    ),
  );
  return node;
}
