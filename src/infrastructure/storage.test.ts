import { describe, expect, it } from "vitest";
import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import { addTransfer, HistoryStore, type StorageArea } from "./storage.ts";

function fakeStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.has(key) ? { [key]: data.get(key) } : {}),
    set: (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      return Promise.resolve();
    },
  };
}

const snapshot: BalanceSnapshot = {
  takenAt: 1,
  updatedAt: "2026/07/10 22:34",
  accounts: [{ id: "133331", name: "01: お財布", balance: 129392 }],
};

const transfer: TransferRecord = {
  transferredAt: 2,
  from: { id: "133331", name: "01: お財布" },
  to: { id: "133332", name: "02: 積立" },
  amount: 5000,
};

describe("HistoryStore", () => {
  it("初期状態は空の履歴を返す", async () => {
    const store = new HistoryStore(fakeStorage());

    expect(await store.loadSnapshots()).toEqual([]);
    expect(await store.loadTransfers()).toEqual([]);
  });

  it("スナップショットを保存して読み出せる", async () => {
    const store = new HistoryStore(fakeStorage());

    const saved = await store.recordSnapshot(snapshot);

    expect(saved).toBe(true);
    expect(await store.loadSnapshots()).toEqual([snapshot]);
  });

  it("直前と同じ残高のスナップショットは保存しない", async () => {
    const store = new HistoryStore(fakeStorage());
    await store.recordSnapshot(snapshot);

    const saved = await store.recordSnapshot({ ...snapshot, takenAt: 5 });

    expect(saved).toBe(false);
    expect(await store.loadSnapshots()).toEqual([snapshot]);
  });

  it("振替記録を追記できる", async () => {
    const store = new HistoryStore(fakeStorage());

    await store.recordTransfer(transfer);
    await store.recordTransfer({ ...transfer, transferredAt: 3 });

    expect(await store.loadTransfers()).toEqual([transfer, { ...transfer, transferredAt: 3 }]);
  });
});

describe("addTransfer", () => {
  it("同一内容でも別の記録として追記する", () => {
    expect(addTransfer([transfer], transfer)).toEqual([transfer, transfer]);
  });
});
