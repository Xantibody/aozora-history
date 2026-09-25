import type { AccountBalance, LogEntry } from "../domain/log.ts";
import { INK_WEAK, el } from "./dom.ts";
import { formatYen } from "./format.ts";

type TransactionEntry = Extract<LogEntry, { kind: "transfer" | "external" | "statement" }>;

interface NamedBalance {
  name: string;
  balance: AccountBalance;
}

/** 口座別明細から残高が読めた口座。読めない口座は出さない(推定の値は並べない) */
function namedBalances(entry: TransactionEntry): NamedBalance[] {
  if (entry.kind === "transfer") {
    const { from, to } = entry.balances;
    return [
      ...(from === undefined ? [] : [{ name: entry.transfer.from.name, balance: from }]),
      ...(to === undefined ? [] : [{ name: entry.transfer.to.name, balance: to }]),
    ];
  }
  if (entry.kind === "statement" && entry.account !== undefined && entry.balance !== undefined) {
    return [{ name: entry.account.accountName, balance: entry.balance }];
  }
  return [];
}

function describe({ name, balance }: NamedBalance): string {
  return `${name} ${balance.before.toLocaleString("ja-JP")} → ${formatYen(balance.after)}`;
}

/**
 * その取引の前後で口座の残高がいくらからいくらになったか。
 *
 * 残高記録は取った時点の値しか持たず、あいだに振替や入金が重なると途中の
 * 残高が分からなくなる。銀行の口座別明細が持つ取引後の残高から読めるときだけ出す
 */
export function balanceLine(entry: TransactionEntry): HTMLElement[] {
  const balances = namedBalances(entry);
  if (balances.length === 0) {
    return [];
  }
  const text = `残高 ${balances.map((item) => describe(item)).join(" · ")}`;
  return [el("div", `balance-line text-xs tabular-nums ${INK_WEAK}`, text)];
}
