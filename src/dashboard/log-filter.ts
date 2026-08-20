import type { AppliedSearch, RenderContext, UiState } from "./context.ts";
import { inPeriod, statementAt } from "./period.ts";
import { matchesSearch, searchAmountOf } from "./search.ts";
import type { LogEntry } from "../domain/log.ts";
import { commentKeyOf } from "./memo-field.ts";
import { commentText } from "../domain/comments.ts";
import { counterparty } from "./counterparty.ts";
import { logEntries } from "../domain/log.ts";

/** どの行をログに出すかの判定。並べ方と見た目は log-tab.ts が持つ */

function matchesTransfer(
  state: UiState,
  transfer: Extract<LogEntry, { kind: "transfer" }>["transfer"],
): boolean {
  if (state.logFilter === "in" || state.logFilter === "out") {
    return false;
  }
  return (
    state.filterAccountId === null ||
    transfer.from.id === state.filterAccountId ||
    transfer.to.id === state.filterAccountId
  );
}

function matchesExternal(
  state: UiState,
  change: Extract<LogEntry, { kind: "external" }>["change"],
): boolean {
  if (state.logFilter === "transfer") {
    return false;
  }
  if (state.logFilter === "in" && change.externalDelta < 0) {
    return false;
  }
  if (state.logFilter === "out" && change.externalDelta > 0) {
    return false;
  }
  return state.filterAccountId === null || change.accountId === state.filterAccountId;
}

/**
 * 代表口座の明細。つかいわけ口座ではないので、口座で絞っている間は出さない。
 * 入金・出金の絞り込みは符号で判断する
 */
function matchesStatement(state: UiState, amount: number): boolean {
  if (state.logFilter === "transfer" || state.filterAccountId !== null) {
    return false;
  }
  if (state.logFilter === "in") {
    return amount > 0;
  }
  return state.logFilter === "out" ? amount < 0 : true;
}

/** 推移で選んだ区間。選んでいなければ素通りさせる */
function inSelectedSpan(state: UiState, at: number): boolean {
  const span = state.selectedSpan;
  return span === null || (at >= span.from && at <= span.to);
}

function matchesLog(state: UiState, entry: LogEntry): boolean {
  if (!inPeriod(state, entry.at) || !inSelectedSpan(state, entry.at)) {
    return false;
  }
  if (entry.kind === "transfer") {
    return matchesTransfer(state, entry.transfer);
  }
  if (entry.kind === "statement") {
    return matchesStatement(state, entry.statement.amount);
  }
  if (entry.kind === "external") {
    return matchesExternal(state, entry.change);
  }
  // 記録行は従属情報。何かで絞り込んでいる間はノイズになるため出さない
  return state.logFilter === "all" && state.filterAccountId === null;
}

/**
 * 検索がその行に当たるか。メモに加えて、明細は摘要、外部入出金は相手先も
 * 読み合わせる。従属行(残高記録)は検索の対象ではない
 */
export function entryMatchesSearch(
  ctx: RenderContext,
  applied: AppliedSearch,
  entry: LogEntry,
): boolean {
  if (entry.kind === "snapshot") {
    return false;
  }
  const comment = commentText(ctx.data.comments, commentKeyOf(entry));
  let other = "";
  if (entry.kind === "statement") {
    other = entry.statement.remark;
  } else if (entry.kind === "external") {
    other = counterparty(ctx, entry.change);
  }
  return matchesSearch(applied, [comment, other], searchAmountOf(entry));
}

/** 絞り込む前の時系列ログ。検索パレットの「記録に一致」もここから探す */
export function allLogEntries(ctx: RenderContext): LogEntry[] {
  return logEntries({
    snapshots: ctx.data.snapshots,
    transfers: ctx.ledger.transfers,
    statements: ctx.data.statements,
    placeAt: (valueDate) => statementAt(valueDate, ctx.now()),
  });
}

/** ログページに出す行。月・口座・種類・区間・検索のすべてをANDで重ねる */
export function visibleEntries(ctx: RenderContext): LogEntry[] {
  const applied = ctx.state.appliedSearch;
  return allLogEntries(ctx).filter(
    (entry) =>
      matchesLog(ctx.state, entry) && (applied === null || entryMatchesSearch(ctx, applied, entry)),
  );
}
