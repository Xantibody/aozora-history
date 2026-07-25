import { describe, expect, it } from "vitest";
import { parseOrdinaryStatement, parseSpAccountBalances } from "./api-parser.ts";

describe("parseSpAccountBalances", () => {
  it("つかいわけ口座の残高一覧をスナップショットに変換する", () => {
    const json = {
      queryDatetime: "2026-07-24T21:03:11+09:00",
      spAccountBalanceDetailsList: [
        { spAccountId: "133331", spAccountName: "01: お財布", totalBalance: "129392" },
        { spAccountId: "133332", spAccountName: "02: 積立", totalBalance: 50000 },
      ],
    };

    expect(parseSpAccountBalances(json)).toEqual({
      updatedAt: "2026-07-24T21:03:11+09:00",
      accounts: [
        { id: "133331", name: "01: お財布", balance: 129392 },
        { id: "133332", name: "02: 積立", balance: 50000 },
      ],
    });
  });

  it("最終更新日時がなければnullにする", () => {
    const json = {
      spAccountBalanceDetailsList: [
        { spAccountId: "133331", spAccountName: "01: お財布", totalBalance: "0" },
      ],
    };

    expect(parseSpAccountBalances(json)?.updatedAt).toBeNull();
  });

  it("口座が1件もなければnull(取得できていないとみなす)", () => {
    expect(parseSpAccountBalances({ spAccountBalanceDetailsList: [] })).toBeNull();
  });

  it("形が違えばnull", () => {
    expect(parseSpAccountBalances(null)).toBeNull();
    expect(parseSpAccountBalances({})).toBeNull();
    expect(
      parseSpAccountBalances({ spAccountBalanceDetailsList: [{ spAccountId: "1" }] }),
    ).toBeNull();
  });
});

describe("parseOrdinaryStatement", () => {
  const entry = {
    accountEntryNumber: "0001",
    valueDate: "20260724",
    creditDebitType: "2",
    amount: "173000",
    balance: "907425",
    remark: "振込 ラクテン アイザワ　リユウ",
  };

  it("出金は負、入金は正の符号付き金額にする", () => {
    const json = {
      statementList: [
        entry,
        {
          accountEntryNumber: "0002",
          valueDate: "20260724",
          creditDebitType: "1",
          amount: "635144",
          balance: "1080425",
          remark: "給与  カ）アツトマ－ク  ",
        },
      ],
    };

    expect(parseOrdinaryStatement(json)).toEqual([
      {
        entryNumber: "0001",
        valueDate: "2026-07-24",
        amount: -173000,
        balance: 907425,
        remark: "振込 ラクテン アイザワ　リユウ",
      },
      {
        entryNumber: "0002",
        valueDate: "2026-07-24",
        amount: 635144,
        balance: 1080425,
        remark: "給与  カ）アツトマ－ク",
      },
    ]);
  });

  it("日付はハイフン区切りでもスラッシュ区切りでも受け付ける", () => {
    const dates = ["2026-07-24", "2026/07/24", "20260724"];
    for (const valueDate of dates) {
      expect(
        parseOrdinaryStatement({ statementList: [{ ...entry, valueDate }] })?.[0].valueDate,
      ).toBe("2026-07-24");
    }
  });

  it("明細が空なら空配列", () => {
    expect(parseOrdinaryStatement({ statementList: [] })).toEqual([]);
  });

  it("形が違えばnull", () => {
    expect(parseOrdinaryStatement(null)).toBeNull();
    expect(parseOrdinaryStatement({})).toBeNull();
    expect(parseOrdinaryStatement({ statementList: [{ valueDate: "20260724" }] })).toBeNull();
  });
});
