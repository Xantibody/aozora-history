import { BADGE, INK, INK_DECOR, INK_SOFT, accountDot, el } from "./dom.ts";
import type { LogEntry } from "../domain/log.ts";
import type { RenderContext } from "./context.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { TransferRecord } from "../domain/ledger.ts";
import { counterparty } from "./counterparty.ts";
import { icon } from "./icons.ts";
import { isDetected } from "../domain/reconcile.ts";
import { matchesAutoTransfer } from "../domain/auto-transfer.ts";

/** 振替の出金側・入金側と同じ形。口座の参照だけのためにモジュールを増やさない */
type AccountRef = TransferRecord["from"];

type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" | "statement" }>;

/** 行の文字より一回り小さくして、主役である口座名に譲る */
const ARROW_SIZE = 15;

function strongName(name: string): HTMLElement {
  return el("strong", "font-bold", name);
}

/**
 * 口座名。色は口座を見分ける手掛かりを増やすためのもので、それだけに
 * 意味を持たせない(名前は必ず文字で出す)。控えめな点にとどめる
 */
function accountName(ctx: RenderContext, ref: AccountRef): HTMLElement {
  const label = el("span", "account-name inline-flex items-center gap-[9px]");
  label.append(accountDot(ctx.colorOf(ref.id), "h-[9px] w-[9px]"), strongName(ref.name));
  return label;
}

/**
 * この拡張が操作を検知できない口座間の移動。残高の差額から組み直したもので
 * 銀行の記録ではないため、記録済みの振替と区別する。
 * 定額自動振替の設定と一致していれば、何が起きたのかまで言い切れる
 */
function detectedBadge(ctx: RenderContext, transfer: TransferRecord): HTMLElement {
  return el(
    "span",
    `detected-badge py-[2px] text-[11px] font-bold whitespace-nowrap ${BADGE}`,
    matchesAutoTransfer(ctx.data.autoTransfers, transfer) ? "定額自動振替" : "自動",
  );
}

/**
 * 振替の向き。図形だけだと読み上げに乗らないため、同じ意味の文字を添える。
 * 向きは装飾ではなく情報なので、見える形と読める形の両方を持たせる
 */
function arrow(): HTMLElement {
  const wrap = el("span", "arrow inline-flex items-center");
  wrap.append(icon("arrow-right", ARROW_SIZE, INK_DECOR), el("span", "sr-only", " → "));
  return wrap;
}

/** 口座でない相手先(給与の振込元、引落先など)。口座色を持たないプレーンな文字 */
function otherParty(name: string): HTMLElement {
  return el("span", INK_SOFT, name);
}

type TitlePart = Element | string;

function transferTitle(ctx: RenderContext, transfer: TransferRecord): TitlePart[] {
  const parts = [accountName(ctx, transfer.from), arrow(), accountName(ctx, transfer.to)];
  return isDetected(ctx.ledger, transfer) ? [...parts, detectedBadge(ctx, transfer)] : parts;
}

function externalTitle(
  ctx: RenderContext,
  change: Extract<LogEntry, { kind: "external" }>["change"],
): TitlePart[] {
  const account = accountName(ctx, { id: change.accountId, name: change.accountName });
  const other = otherParty(counterparty(ctx, change));
  return change.externalDelta > 0 ? [other, arrow(), account] : [account, arrow(), other];
}

/**
 * 代表口座(普通預金)。つかいわけ口座と同じ形で並べつつ、口座色は割り当てず
 * 灰色にする。色は「つかいわけ口座のどれか」を見分けるための手掛かりなので、
 * 別の口座に同じ意味を持たせない
 */
function primaryAccountName(): HTMLElement {
  const label = el("span", "account-name inline-flex items-center gap-[9px]");
  const mark = el(
    "span",
    "dot h-[9px] w-[9px] shrink-0 rounded-[3px] bg-[#94a3b8] dark:bg-[#8695a6]",
  );
  label.append(mark, strongName("普通預金"));
  return label;
}

/** 代表口座の明細。入金なら相手先→口座、出金なら口座→相手先と、振替と同じ向きで読める */
function statementTitle(statement: StatementEntry): TitlePart[] {
  const account = primaryAccountName();
  const other = otherParty(statement.remark === "" ? "(摘要なし)" : statement.remark);
  return statement.amount > 0 ? [other, arrow(), account] : [account, arrow(), other];
}

function titleParts(ctx: RenderContext, entry: TransactionEntry): TitlePart[] {
  if (entry.kind === "transfer") {
    return transferTitle(ctx, entry.transfer);
  }
  return entry.kind === "statement"
    ? statementTitle(entry.statement)
    : externalTitle(ctx, entry.change);
}

export function logTitle(ctx: RenderContext, entry: TransactionEntry): HTMLElement {
  const title = el(
    "div",
    `log-title flex min-w-0 flex-wrap items-center gap-2 text-[14.5px] leading-snug sm:gap-[9px] sm:text-[15.5px] ${INK}`,
  );
  title.append(...titleParts(ctx, entry));
  return title;
}
