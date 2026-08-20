import type { RenderContext } from "./context.ts";
import { latestRecordAt } from "../domain/ledger.ts";
import { monthLabel } from "./period.ts";

/** 記録も明細もまだ何もない状態 */
export function hasNoRecord(ctx: RenderContext): boolean {
  return (
    latestRecordAt(ctx.data.snapshots, ctx.data.transfers) === null &&
    ctx.data.statements.length === 0
  );
}

/**
 * 空になった理由を言い分ける。
 *
 * 記録があるのに「まだ記録がありません」と出すと、取り込みが止まったと読める。
 * 表示は既定で当月なので、月が変わった直後はどのページもこの状態になり、
 * 「7日以上記録が増えていなければ警告する」のと目的が食い違ってしまう
 */
export function emptyMessage(ctx: RenderContext): string {
  if (hasNoRecord(ctx)) {
    return "まだ記録がありません";
  }
  // 検索が理由で空のときに「今月の記録はありません」と言うと、取り込みを疑わせる
  if (ctx.state.appliedSearch !== null) {
    return "この絞り込みに合う記録はありません";
  }
  if (ctx.state.monthValue !== "") {
    return `${monthLabel(ctx.state.monthValue)}の記録はありません`;
  }
  if (ctx.state.periodFrom !== null || ctx.state.periodToExclusive !== null) {
    return "この期間の記録はありません";
  }
  return "この絞り込みに合う記録はありません";
}
