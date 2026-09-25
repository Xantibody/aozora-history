import { describe, expect, it } from "vitest";
import type { StatementEntry } from "./statement.ts";
import type { TranMapping } from "./tran-mapping.ts";
import { mappedAccount } from "./tran-mapping.ts";

/** どの項目を引いたか見分けられるよう、項目ごとに別の口座にしておく */
const mapping: TranMapping = {
  atmWithdrawal: "atm-out",
  atmDeposit: "atm-in",
  debitWithdrawal: "debit",
  directDebit: "bills",
  sweepDebit: "sweep",
  fee: "fee",
  interest: "interest",
};

function statement(remark: string, amount: number): StatementEntry {
  return { entryNumber: "0001", valueDate: "2026-07-16", amount, balance: 0, remark };
}

describe("mappedAccount", () => {
  it.each([
    { kind: "ATMからの出金", remark: "ATM セブン銀行", amount: -20_000, expected: "atm-out" },
    { kind: "ATMからの入金", remark: "ATM ゆうちょ銀行", amount: 30_000, expected: "atm-in" },
    { kind: "利息", remark: "普通預金 利息", amount: 12, expected: "interest" },
    {
      kind: "口座振替(摘要は引落先の名前だけ)",
      remark: "ﾗｸﾃﾝｶ-ﾄﾞｻ-ﾋﾞｽ",
      amount: -48_000,
      expected: "bills",
    },
  ])("$kindは設定の口座に向く", ({ remark, amount, expected }) => {
    expect(mappedAccount(mapping, statement(remark, amount))).toBe(expected);
  });

  it.each([
    {
      kind: "振込の出金(口座は振込ごとに選ぶ)",
      remark: "振込 ラクテン アイザワ リユウ",
      amount: -173_000,
    },
    { kind: "給与", remark: "給与 カ）アツトマ－ク", amount: 635_144 },
    { kind: "ペイジー", remark: "PE 地方税共同機構 26178001526", amount: -9000 },
    { kind: "名前だけの入金(口座振替は出金だけ)", remark: "ｶ)ｻﾝﾌﾟﾙ", amount: 1000 },
  ])("$kindは設定では決めない", ({ remark, amount }) => {
    expect(mappedAccount(mapping, statement(remark, amount))).toBeNull();
  });
});
