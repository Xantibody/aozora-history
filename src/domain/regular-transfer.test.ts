import { describe, expect, it } from "vitest";
import type { RegularTransferSetting } from "./regular-transfer.ts";
import type { StatementEntry } from "./statement.ts";
import { matchingRegularTransfer } from "./regular-transfer.ts";

const rent: RegularTransferSetting = {
  id: "000003",
  payeeName: "アイザワ　リユウ",
  bankName: "楽天銀行",
  amount: 173_000,
  active: true,
  groupName: "家賃－投資",
};

function statement(overrides: Partial<StatementEntry> = {}): StatementEntry {
  return {
    entryNumber: "0001",
    valueDate: "2026-07-26",
    amount: -173_000,
    balance: 907_425,
    remark: "振込 ラクテン アイザワ　リユウ",
    ...overrides,
  };
}

describe("matchingRegularTransfer", () => {
  it("摘要に受取人名が入り金額も一致すれば、その契約を返す", () => {
    expect(matchingRegularTransfer([rent], statement())).toBe(rent);
  });

  // 契約の受取人名は姓と名を全角空白で区切るが、摘要では詰まっていることがある
  it("空白の入り方が違っても同じ名前として扱う", () => {
    const spaced = matchingRegularTransfer(
      [rent],
      statement({ remark: "振込 ラクテンアイザワリユウ" }),
    );

    expect(spaced).toBe(rent);
  });

  it("金額が違えば契約とは結び付けない", () => {
    expect(matchingRegularTransfer([rent], statement({ amount: -50_000 }))).toBeNull();
  });

  it("摘要に受取人名が無ければ結び付けない", () => {
    const other = statement({ remark: "振込 ミツビシユーエフジエイ" });

    expect(matchingRegularTransfer([rent], other)).toBeNull();
  });

  // 休止・解約の契約は実行されない。同額の別の振込を取り違えないようにする
  it("契約中でなければ結び付けない", () => {
    expect(matchingRegularTransfer([{ ...rent, active: false }], statement())).toBeNull();
  });

  it("入金の明細は定額自動振込ではない", () => {
    const income = statement({ amount: 173_000, remark: "振込 アイザワ　リユウ" });

    expect(matchingRegularTransfer([rent], income)).toBeNull();
  });

  it("受取人名が空の契約は、どの明細とも結び付けない", () => {
    expect(matchingRegularTransfer([{ ...rent, payeeName: "" }], statement())).toBeNull();
  });
});
