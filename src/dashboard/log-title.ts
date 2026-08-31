import { BADGE, INK, INK_DECOR, INK_SOFT, accountDot, el } from "./dom.ts";
import { appliedQuery, highlighted, searchAmountOf, tierBadgeLabel } from "./search.ts";
import type { LogEntry } from "../domain/log.ts";
import type { RegularTransferSetting } from "../domain/regular-transfer.ts";
import type { RenderContext } from "./context.ts";
import type { TransferRecord } from "../domain/ledger.ts";
import { counterparty } from "./counterparty.ts";
import { icon } from "./icons.ts";
import { isDetected } from "../domain/reconcile.ts";
import { matchesAutoTransfer } from "../domain/auto-transfer.ts";
import { matchingRegularTransfer } from "../domain/regular-transfer.ts";

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
function otherParty(ctx: RenderContext, name: string): HTMLElement {
  const label = el("span", INK_SOFT);
  label.append(...highlighted(name, appliedQuery(ctx.state.appliedSearch)));
  return label;
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
  const other = otherParty(ctx, counterparty(ctx, change));
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

/**
 * 定額自動振込の契約と結び付いた明細。摘要には相手先しか出ないため、
 * 毎月の決まった振込なのか、その月だけの振込なのかが読めない。
 *
 * 何のための振込かは銀行側のグループ名に書いてあるので、あればそれを添える
 */
function regularBadge(setting: RegularTransferSetting): HTMLElement {
  const badge = el(
    "span",
    `regular-badge py-[2px] text-[11px] font-bold whitespace-nowrap ${BADGE}`,
    "定額自動振込",
  );
  badge.title =
    setting.groupName === ""
      ? `${setting.bankName}への定額自動振込`
      : `${setting.bankName}への定額自動振込(${setting.groupName})`;
  return badge;
}

/** ログに並べる明細1件。取り込んだ明細そのもの(statement.ts の型) */
type Statement = Extract<LogEntry, { kind: "statement" }>["statement"];

function statementBadge(ctx: RenderContext, statement: Statement): TitlePart[] {
  const setting = matchingRegularTransfer(ctx.data.regularTransfers, statement);
  return setting === null ? [] : [regularBadge(setting)];
}

/**
 * 代表口座の明細。入金なら相手先→口座、出金なら口座→相手先と、振替と同じ向きで読める。
 *
 * どのつかいわけ口座の動きか突き合わせが付いていれば、そちらの名前で出す。
 * 代表口座の残高はつかいわけ口座の合計なので、「普通預金」と出すより
 * 「01: お財布」と出した方が、同じ出来事を指していることが読める
 */
function statementTitle(
  ctx: RenderContext,
  entry: Extract<LogEntry, { kind: "statement" }>,
): TitlePart[] {
  const { statement, account } = entry;
  const from =
    account === undefined
      ? primaryAccountName()
      : accountName(ctx, { id: account.accountId, name: account.accountName });
  const other = otherParty(ctx, statement.remark === "" ? "(摘要なし)" : statement.remark);
  const parts = statement.amount > 0 ? [other, arrow(), from] : [from, arrow(), other];
  return [...parts, ...statementBadge(ctx, statement)];
}

function titleParts(ctx: RenderContext, entry: TransactionEntry): TitlePart[] {
  if (entry.kind === "transfer") {
    return transferTitle(ctx, entry.transfer);
  }
  return entry.kind === "statement" ? statementTitle(ctx, entry) : externalTitle(ctx, entry.change);
}

/**
 * 金額検索の適用中に、なぜこの行が残っているのかを金額の近さで示すバッジ。
 * ほぼ同額の中でも +9% と -7% を見分けられるよう、実差で言う
 */
function nearnessBadge(ctx: RenderContext, entry: TransactionEntry): HTMLElement[] {
  const applied = ctx.state.appliedSearch;
  if (applied?.kind !== "amount") {
    return [];
  }
  return [
    el(
      "span",
      `nearness-badge py-[2px] text-[11px] font-bold whitespace-nowrap ${BADGE}`,
      tierBadgeLabel(applied.amount, searchAmountOf(entry)),
    ),
  ];
}

export function logTitle(ctx: RenderContext, entry: TransactionEntry): HTMLElement {
  const title = el(
    "div",
    `log-title flex min-w-0 flex-wrap items-center gap-2 text-[14.5px] leading-snug sm:gap-[9px] sm:text-[15.5px] ${INK}`,
  );
  title.append(...titleParts(ctx, entry), ...nearnessBadge(ctx, entry));
  return title;
}
