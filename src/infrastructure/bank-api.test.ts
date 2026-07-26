import type { BankFetchLike, BankRequest } from "./bank-api.ts";
import { describe, expect, it } from "vitest";
import { BankApiClient } from "./bank-api.ts";

function recorder(responses: { ok?: boolean; status?: number; body: unknown }[]): {
  calls: BankRequest[];
  fetchFn: BankFetchLike;
} {
  const calls: BankRequest[] = [];
  let index = 0;
  const fetchFn: BankFetchLike = (request) => {
    calls.push(request);
    const res = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve({
      ok: res.ok ?? true,
      status: res.status ?? 200,
      text: () =>
        Promise.resolve(typeof res.body === "string" ? res.body : JSON.stringify(res.body)),
    });
  };
  return { calls, fetchFn };
}

const balancesBody = {
  queryDatetime: "2026-07-24T21:03:11+09:00",
  spAccountBalanceDetailsList: [
    { spAccountId: "133331", spAccountName: "01: お財布", totalBalance: "129392" },
  ],
};

const statementBody = {
  statementList: [
    {
      accountEntryNumber: "0001",
      valueDate: "20260724",
      creditDebitType: "2",
      amount: "173000",
      balance: "907425",
      remark: "振込 ラクテン",
    },
  ],
};

const autoTransferBody = {
  queryDatetime: "2026-07-26T14:59:00+09:00",
  spAccountAutoTransferList: [
    {
      spAutoTransferId: "9001",
      applyDate: "20260721",
      currency: "JPY",
      debitSpAccountId: "133331",
      debitSpAccountName: "01: お財布",
      creditSpAccountId: "133805",
      creditSpAccountName: "03: 支払い箱",
      amount: "80000",
      nextTransferDate: "20260826",
      transferCycle: "1",
      transferDayMonth: 26,
    },
  ],
};

describe("BankApiClient", () => {
  it("つかいわけ口座の残高を同一オリジンのAPIから取る", async () => {
    const { calls, fetchFn } = recorder([{ body: balancesBody }]);
    const client = new BankApiClient(fetchFn, () => "");

    const snapshot = await client.spAccountBalances();

    expect(calls[0].url).toBe("https://bank.gmo-aozora.com/v1/balances/sp-accounts");
    expect(calls[0].credentials).toBe("include");
    expect(snapshot).toStrictEqual({
      updatedAt: "2026-07-24T21:03:11+09:00",
      accounts: [{ id: "133331", name: "01: お財布", balance: 129_392 }],
    });
  });

  it("普通預金の入出金明細を新しい順・指定件数で取る", async () => {
    const { calls, fetchFn } = recorder([{ body: statementBody }]);
    const client = new BankApiClient(fetchFn, () => "");

    const statements = await client.ordinaryStatement(50);

    expect(calls[0].url).toBe(
      "https://bank.gmo-aozora.com/v1/ordinary-deposits/statement?limit=50&offset=0&depositOrderType=2",
    );
    expect(statements).toStrictEqual([
      {
        entryNumber: "0001",
        valueDate: "2026-07-24",
        amount: -173_000,
        balance: 907_425,
        remark: "振込 ラクテン",
      },
    ]);
  });

  it("つかいわけ口座の入出金明細を口座を指定して取り、明細に口座IDを付ける", async () => {
    const { calls, fetchFn } = recorder([{ body: statementBody }]);
    const client = new BankApiClient(fetchFn, () => "");

    const entries = await client.spAccountStatement("133331", 100);

    expect(calls[0].url).toBe(
      "https://bank.gmo-aozora.com/v1/sp-accounts/ordinary-deposits-statement" +
        "?spAccountId=133331&currency=JPY&limit=100&offset=0&depositOrderType=2",
    );
    expect(entries?.[0].accountId).toBe("133331");
  });

  it("定額自動振替の設定を取る", async () => {
    const { calls, fetchFn } = recorder([{ body: autoTransferBody }]);
    const client = new BankApiClient(fetchFn, () => "");

    const settings = await client.autoTransfers(100);

    expect(calls[0].url).toBe(
      "https://bank.gmo-aozora.com/v1/sp-accounts/auto-transfer" +
        "?limit=100&offset=0&sortKey=1&depositOrderType=2",
    );
    expect(settings).toStrictEqual([
      {
        id: "9001",
        from: { id: "133331", name: "01: お財布" },
        to: { id: "133805", name: "03: 支払い箱" },
        amount: 80_000,
      },
    ]);
  });

  it("XSRFトークンのcookieがあればヘッダーで送り返す(銀行サイト本体と同じ作法)", async () => {
    const { calls, fetchFn } = recorder([{ body: balancesBody }]);
    const client = new BankApiClient(fetchFn, () => "foo=1; XSRF-TOKEN=a%2Bb; bar=2");

    await client.spAccountBalances();

    expect(calls[0].headers["X-XSRF-TOKEN"]).toBe("a+b");
  });

  it("XSRFトークンのcookieがなければヘッダーを付けない", async () => {
    const { calls, fetchFn } = recorder([{ body: balancesBody }]);
    const client = new BankApiClient(fetchFn, () => "foo=1");

    await client.spAccountBalances();

    expect(calls[0].headers["X-XSRF-TOKEN"]).toBeUndefined();
  });

  it("未ログインなどでエラーが返れば例外にする", async () => {
    const { fetchFn } = recorder([{ ok: false, status: 401, body: {} }]);
    const client = new BankApiClient(fetchFn, () => "");

    await expect(client.spAccountBalances()).rejects.toThrow("HTTP 401");
  });

  it("想定外の形のレスポンスはnullを返す(記録を壊さない)", async () => {
    const { fetchFn } = recorder([{ body: { unexpected: true } }]);
    const client = new BankApiClient(fetchFn, () => "");

    await expect(client.spAccountBalances()).resolves.toBeNull();
  });

  it("ログイン画面のHTMLが返ってきてもnullを返す", async () => {
    const { fetchFn } = recorder([{ body: "<!DOCTYPE html><html>ログイン</html>" }]);
    const client = new BankApiClient(fetchFn, () => "");

    await expect(client.ordinaryStatement(100)).resolves.toBeNull();
  });
});
