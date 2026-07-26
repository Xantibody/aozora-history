import type { BalanceChange } from "../domain/ledger.ts";
import type { RenderContext } from "./context.ts";
import type { StatementEntry } from "../domain/statement.ts";
import { accountStatements } from "../domain/statement.ts";
import { dayStart } from "./period.ts";
import { localDayKey } from "./format.ts";

/**
 * 明細がその増減の区間に入るか。明細は起算日(日単位)しか持たないため、
 * 区間の始まりはその日の0時まで広げて見る。スナップショットを取った時刻と
 * 銀行が起算する日は必ずしも同じ日にならない(深夜の入金など)
 */
function withinChange(statement: StatementEntry, change: BalanceChange): boolean {
  const at = dayStart(statement.valueDate);
  const from = dayStart(localDayKey(change.fromTakenAt));
  return at !== null && from !== null && at >= from && at <= change.toTakenAt;
}

/**
 * 口座の外との入出金の相手。つかいわけ口座ごとの明細を取り込めていれば、
 * 自動引落の引落先などが摘要で分かる。金額と期間で1件に絞れたときだけ言い切り、
 * 絞れなければ「外部」のままにする
 */
export function counterparty(ctx: RenderContext, change: BalanceChange): string {
  const matched = accountStatements(ctx.data.statements, change.accountId).filter(
    (statement) => statement.amount === change.externalDelta && withinChange(statement, change),
  );
  return matched.length === 1 && matched[0].remark !== "" ? matched[0].remark : "外部";
}
