import { describe, expect, it } from "vitest";
import {
  parseAutoTransfers,
  parseOrdinaryStatement,
  parseSpAccountBalances,
  parseSpAccountStatement,
} from "./api-parser.ts";

describe("parseSpAccountBalances", () => {
  it("つかいわけ口座の残高一覧をスナップショットに変換する", () => {
    const json = {
      queryDatetime: "2026-07-24T21:03:11+09:00",
      spAccountBalanceDetailsList: [
        { spAccountId: "133331", spAccountName: "01: お財布", totalBalance: "129392" },
        { spAccountId: "133332", spAccountName: "02: 積立", totalBalance: 50_000 },
      ],
    };

    expect(parseSpAccountBalances(json)).toStrictEqual({
      updatedAt: "2026-07-24T21:03:11+09:00",
      accounts: [
        { id: "133331", name: "01: お財布", balance: 129_392 },
        { id: "133332", name: "02: 積立", balance: 50_000 },
      ],
    });
  });

  it("残高照会は口座一覧を account で、残高を balance で返す", () => {
    const json = {
      queryDatetime: "2026-07-27T00:27:00+09:00",
      account: [{ spAccountId: "133331", spAccountName: "01: お財布", balance: "129392.0" }],
    };

    expect(parseSpAccountBalances(json)).toStrictEqual({
      updatedAt: "2026-07-27T00:27:00+09:00",
      accounts: [{ id: "133331", name: "01: お財布", balance: 129_392 }],
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

    expect(parseOrdinaryStatement(json)).toStrictEqual([
      {
        entryNumber: "0001",
        valueDate: "2026-07-24",
        amount: -173_000,
        balance: 907_425,
        remark: "振込 ラクテン アイザワ　リユウ",
      },
      {
        entryNumber: "0002",
        valueDate: "2026-07-24",
        amount: 635_144,
        balance: 1_080_425,
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
    expect(parseOrdinaryStatement({ statementList: [] })).toStrictEqual([]);
  });

  it("形が違えばnull", () => {
    expect(parseOrdinaryStatement(null)).toBeNull();
    expect(parseOrdinaryStatement({})).toBeNull();
    expect(parseOrdinaryStatement({ statementList: [{ valueDate: "20260724" }] })).toBeNull();
  });
});

describe("parseSpAccountStatement", () => {
  const entry = {
    accountEntryNumber: "0001",
    valueDate: "20260724",
    creditDebitType: "2",
    amount: "5000",
    balance: "129392",
    remark: "カード引落",
  };

  it("代表口座と同じ形のレスポンスに、どの口座の明細かを付ける", () => {
    const parsed = parseSpAccountStatement({ statementList: [entry] }, "133331");

    expect(parsed).toStrictEqual([
      {
        entryNumber: "0001",
        valueDate: "2026-07-24",
        amount: -5000,
        balance: 129_392,
        remark: "カード引落",
        accountId: "133331",
      },
    ]);
  });

  it("形が違えばnull", () => {
    expect(parseSpAccountStatement({}, "133331")).toBeNull();
  });
});

describe("parseAutoTransfers", () => {
  const setting = {
    spAutoTransferId: "9001",
    debitSpAccountId: "133331",
    debitSpAccountName: "01: お財布",
    creditSpAccountId: "133805",
    creditSpAccountName: "03: 支払い箱",
    amount: "80000",
    nextTransferDate: "20260826",
    transferCycle: "1",
    transferDayMonth: 26,
  };

  it("定額自動振替の設定を出金口座・入金口座・金額に落とす", () => {
    const parsed = parseAutoTransfers({ spAccountAutoTransferList: [setting] });

    expect(parsed).toStrictEqual([
      {
        id: "9001",
        from: { id: "133331", name: "01: お財布" },
        to: { id: "133805", name: "03: 支払い箱" },
        amount: 80_000,
      },
    ]);
  });

  it("設定が1件もなければ空配列(設定なしと取得失敗を区別する)", () => {
    expect(parseAutoTransfers({ spAccountAutoTransferList: [] })).toStrictEqual([]);
  });

  it("形が違えばnull", () => {
    expect(parseAutoTransfers(null)).toBeNull();
    expect(parseAutoTransfers({})).toBeNull();
    expect(
      parseAutoTransfers({ spAccountAutoTransferList: [{ spAutoTransferId: "9001" }] }),
    ).toBeNull();
  });
});
