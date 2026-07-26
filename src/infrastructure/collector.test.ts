import { COLLECT_INTERVAL_MS, collectFromBank, shouldCollect } from "./collector.ts";
import { describe, expect, it } from "vitest";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { BankApiClient } from "./bank-api.ts";
import { HistoryStore } from "./storage.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { StorageArea } from "./storage.ts";

function fakeStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.has(key) ? { [key]: data.get(key) } : {}),
    set: (items) => {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, value);
      }
      return Promise.resolve();
    },
  };
}

const snapshot = {
  updatedAt: "2026-07-24T21:03:11+09:00",
  accounts: [{ id: "133331", name: "01: お財布", balance: 129_392 }],
};

const statements: StatementEntry[] = [
  {
    entryNumber: "0001",
    valueDate: "2026-07-24",
    amount: -173_000,
    balance: 907_425,
    remark: "振込",
  },
];

/** つかいわけ口座「01: お財布」の明細。最新の残高がスナップショットと一致している */
const accountStatements: StatementEntry[] = [
  {
    entryNumber: "0001",
    valueDate: "2026-07-24",
    amount: -5000,
    balance: 129_392,
    remark: "カード引落",
    accountId: "133331",
  },
];

const autoTransfers: AutoTransferSetting[] = [
  {
    id: "9001",
    from: { id: "133331", name: "01: お財布" },
    to: { id: "133805", name: "03: 支払い箱" },
    amount: 80_000,
  },
];

/** 成否を差し替えられる最小のAPIクライアント */
function fakeClient(overrides: Partial<BankApiClient> = {}): BankApiClient {
  return {
    spAccountBalances: () => Promise.resolve(snapshot),
    ordinaryStatement: () => Promise.resolve(statements),
    spAccountStatement: () => Promise.resolve(accountStatements),
    autoTransfers: () => Promise.resolve(autoTransfers),
    ...overrides,
  } as BankApiClient;
}

describe("shouldCollect", () => {
  it("一度も取得していなければ取りに行く", () => {
    expect(shouldCollect(null, 0)).toBe(true);
  });

  it("間隔が空いていなければ見送る", () => {
    expect(shouldCollect(1000, 1000 + COLLECT_INTERVAL_MS - 1)).toBe(false);
  });

  it("間隔が空いていれば取りに行く", () => {
    expect(shouldCollect(1000, 1000 + COLLECT_INTERVAL_MS)).toBe(true);
  });

  it("時計が巻き戻っても取りに行ける", () => {
    expect(shouldCollect(1000, 500)).toBe(true);
  });
});

describe("collectFromBank", () => {
  it("残高スナップショット・明細・定額自動振替の設定をまとめて記録する", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);

    const result = await collectFromBank(store, fakeClient(), () => 42);

    expect(result).toStrictEqual({
      skipped: false,
      balances: { count: 1, saved: true },
      statements: { count: 1, saved: true },
      accountStatements: { count: 1, saved: true },
      autoTransfers: { count: 1, saved: true },
      errors: [],
    });
    await expect(store.loadSnapshots()).resolves.toStrictEqual([{ takenAt: 42, ...snapshot }]);
    await expect(store.loadStatements()).resolves.toStrictEqual([
      ...statements,
      ...accountStatements,
    ]);
    await expect(store.loadAutoTransfers()).resolves.toStrictEqual(autoTransfers);
  });

  it("残高が合わないつかいわけ口座の明細は取り込まない(別口座の明細が返っている)", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    const client = fakeClient({
      spAccountStatement: () =>
        Promise.resolve([{ ...accountStatements[0], balance: 999_999 }] as StatementEntry[]),
    });

    const result = await collectFromBank(store, client, () => 42);

    // 取れてはいるが検算で弾いた、と分かるようにcountは残す
    expect(result.accountStatements).toStrictEqual({ count: 1, saved: false });
    await expect(store.loadStatements()).resolves.toStrictEqual(statements);
  });

  it("つかいわけ口座の明細に対応していなければ、残りの口座は試さない", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    let calls = 0;
    const client = fakeClient({
      spAccountBalances: () =>
        Promise.resolve({
          ...snapshot,
          accounts: [...snapshot.accounts, { id: "133805", name: "03: 支払い箱", balance: 1 }],
        }),
      spAccountStatement: () => {
        calls += 1;
        return Promise.reject(new Error("HTTP 400"));
      },
    });

    const result = await collectFromBank(store, client, () => 42);

    expect(calls).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.balances.saved).toBe(true);
  });

  it("間隔が空くまでは問い合わせない", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    let calls = 0;
    const client = fakeClient({
      spAccountBalances: () => {
        calls += 1;
        return Promise.resolve(snapshot);
      },
    });
    await collectFromBank(store, client, () => 42);

    const result = await collectFromBank(store, client, () => 43);

    expect(result.skipped).toBe(true);
    expect(calls).toBe(1);
  });

  it("残高の取得に失敗しても明細は記録する", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    const client = fakeClient({
      spAccountBalances: () => Promise.reject(new Error("HTTP 500")),
    });

    const result = await collectFromBank(store, client, () => 42);

    expect(result.balances).toStrictEqual({ count: null, saved: false });
    expect(result.statements.saved).toBe(true);
    expect(result.errors).toHaveLength(1);
    await expect(store.loadStatements()).resolves.toStrictEqual(statements);
  });

  it("残高が取れなければ、つかいわけ口座ごとの明細は取りに行かない", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    let calls = 0;
    const client = fakeClient({
      spAccountBalances: () => Promise.reject(new Error("HTTP 500")),
      spAccountStatement: () => {
        calls += 1;
        return Promise.resolve(accountStatements);
      },
    });

    await collectFromBank(store, client, () => 42);

    expect(calls).toBe(0);
  });

  it("失敗しても取得時刻は記録する(未ログインのページで叩き続けない)", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    const client = fakeClient({
      spAccountBalances: () => Promise.reject(new Error("HTTP 401")),
      ordinaryStatement: () => Promise.reject(new Error("HTTP 401")),
    });

    const result = await collectFromBank(store, client, () => 42);

    expect(result.errors).toHaveLength(2);
    await expect(store.loadLastCollectedAt()).resolves.toBe(42);
  });

  it("つかいわけ口座を使っていなければスナップショットを残さない", async () => {
    const store = new HistoryStore(fakeStorage(), () => 42);
    const client = fakeClient({ spAccountBalances: () => Promise.resolve(null) });

    const result = await collectFromBank(store, client, () => 42);

    // 取れなかった(null)であって、件数0ではない
    expect(result.balances).toStrictEqual({ count: null, saved: false });
    await expect(store.loadSnapshots()).resolves.toStrictEqual([]);
  });
});
