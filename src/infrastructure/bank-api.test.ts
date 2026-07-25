import { describe, expect, it } from "vitest";
import { BankApiClient, type BankFetchLike, type BankRequest } from "./bank-api.ts";

function recorder(responses: { ok?: boolean; status?: number; body: unknown }[]): {
  calls: BankRequest[];
  fetchFn: BankFetchLike;
} {
  const calls: BankRequest[] = [];
  let index = 0;
  const fetchFn: BankFetchLike = (request) => {
    calls.push(request);
    const res = responses[Math.min(index++, responses.length - 1)];
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

describe("BankApiClient", () => {
  it("つかいわけ口座の残高を同一オリジンのAPIから取る", async () => {
    const { calls, fetchFn } = recorder([{ body: balancesBody }]);
    const client = new BankApiClient(fetchFn, () => "");

    const snapshot = await client.spAccountBalances();

    expect(calls[0].url).toBe("https://bank.gmo-aozora.com/v1/balances/sp-accounts");
    expect(calls[0].credentials).toBe("include");
    expect(snapshot).toEqual({
      updatedAt: "2026-07-24T21:03:11+09:00",
      accounts: [{ id: "133331", name: "01: お財布", balance: 129392 }],
    });
  });

  it("普通預金の入出金明細を新しい順・指定件数で取る", async () => {
    const { calls, fetchFn } = recorder([{ body: statementBody }]);
    const client = new BankApiClient(fetchFn, () => "");

    const statements = await client.ordinaryStatement(50);

    expect(calls[0].url).toBe(
      "https://bank.gmo-aozora.com/v1/ordinary-deposits/statement?limit=50&offset=0&depositOrderType=2",
    );
    expect(statements).toEqual([
      {
        entryNumber: "0001",
        valueDate: "2026-07-24",
        amount: -173000,
        balance: 907425,
        remark: "振込 ラクテン",
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

    expect(await client.spAccountBalances()).toBeNull();
  });

  it("ログイン画面のHTMLが返ってきてもnullを返す", async () => {
    const { fetchFn } = recorder([{ body: "<!DOCTYPE html><html>ログイン</html>" }]);
    const client = new BankApiClient(fetchFn, () => "");

    expect(await client.ordinaryStatement(100)).toBeNull();
  });
});
