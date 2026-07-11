import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerData } from "../domain/merge.ts";
import { AutoSync, type SyncRunner } from "./autosync.ts";
import type { SyncConfig } from "./r2sync.ts";
import { HistoryStore, type StorageArea } from "./storage.ts";

const config: SyncConfig = {
  accountId: "abc123",
  bucket: "aozora",
  objectKey: "aozora-history.json",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

const DELAY_MS = 3000;

const transfer = {
  transferredAt: 5,
  from: { id: "100", name: "お財布" },
  to: { id: "101", name: "積立" },
  amount: 1000,
};

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

/** syncWithR2と同じ契約: マージ結果をローカルへ書き戻して返す */
function fakeSync(store: HistoryStore): { runSync: SyncRunner; calls: SyncConfig[] } {
  const calls: SyncConfig[] = [];
  const runSync: SyncRunner = async (cfg) => {
    calls.push(cfg);
    const merged = await store.loadLedger();
    await store.replaceLedger(merged);
    return merged;
  };
  return { runSync, calls };
}

async function setup() {
  const store = new HistoryStore(fakeStorage());
  await store.saveSyncConfig(config);
  const { runSync, calls } = fakeSync(store);
  const errors: unknown[] = [];
  const autoSync = new AutoSync(store, runSync, DELAY_MS, (error) => errors.push(error));
  return { store, calls, errors, autoSync };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AutoSync", () => {
  it("台帳キーの変更後、待ち時間を置いて同期する", async () => {
    const { store, calls, autoSync } = await setup();
    await store.recordTransfer(transfer);

    autoSync.handleChange({ transferRecords: {} });
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(calls).toEqual([config]);
  });

  it("台帳以外のキーの変更では同期しない", async () => {
    const { calls, autoSync } = await setup();

    autoSync.handleChange({ syncConfig: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(calls).toHaveLength(0);
  });

  it("同期設定が未保存なら何もしない", async () => {
    const store = new HistoryStore(fakeStorage());
    await store.recordTransfer(transfer);
    const { runSync, calls } = fakeSync(store);
    const autoSync = new AutoSync(store, runSync, DELAY_MS, () => {});

    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(calls).toHaveLength(0);
  });

  it("連続した変更は1回の同期にまとめる", async () => {
    const { store, calls, autoSync } = await setup();
    await store.recordTransfer(transfer);

    autoSync.handleChange({ balanceSnapshots: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2);
    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(calls).toHaveLength(1);
  });

  it("同期自身の書き込みによる変更では再同期しない", async () => {
    const { store, calls, autoSync } = await setup();
    await store.recordTransfer(transfer);

    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(calls).toHaveLength(1);

    // syncWithR2のreplaceLedgerが発火させるonChangedを再現
    autoSync.handleChange({ balanceSnapshots: {}, transferRecords: {}, comments: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(calls).toHaveLength(1);
  });

  it("台帳が同期後に変わっていれば再び同期する", async () => {
    const { store, calls, autoSync } = await setup();
    await store.recordTransfer(transfer);

    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    await store.recordTransfer({ ...transfer, transferredAt: 6 });
    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(calls).toHaveLength(2);
  });

  it("同期中に来た変更は、完了後にもう一度同期する", async () => {
    const store = new HistoryStore(fakeStorage());
    await store.saveSyncConfig(config);
    await store.recordTransfer(transfer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const emptyLedger: LedgerData = { snapshots: [], transfers: [], comments: {}, deletions: {} };
    const results: LedgerData[] = [];
    // 同期中の変更を取りこぼした(=ローカルより古い)結果を返す遅い同期
    const runSync: SyncRunner = async () => {
      await gate;
      results.push(await store.loadLedger());
      return emptyLedger;
    };
    const autoSync = new AutoSync(store, runSync, DELAY_MS, () => {});

    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    // 1回目の同期が完了する前に新しい記録が入る
    await store.recordTransfer({ ...transfer, transferredAt: 6 });
    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    release();
    await vi.advanceTimersByTimeAsync(DELAY_MS);

    expect(results).toHaveLength(2);
    expect(results[1].transfers).toHaveLength(2);
  });

  it("同期に失敗してもエラーを漏らさず、次の変更で再試行する", async () => {
    const store = new HistoryStore(fakeStorage());
    await store.saveSyncConfig(config);
    await store.recordTransfer(transfer);
    const errors: unknown[] = [];
    let fail = true;
    const runSync: SyncRunner = async () => {
      if (fail) throw new Error("network down");
      const merged = await store.loadLedger();
      return merged;
    };
    const autoSync = new AutoSync(store, runSync, DELAY_MS, (error) => errors.push(error));

    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(errors).toHaveLength(1);

    fail = false;
    autoSync.handleChange({ transferRecords: {} });
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(errors).toHaveLength(1);
  });
});
