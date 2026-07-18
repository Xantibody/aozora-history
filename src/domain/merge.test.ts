import type { BalanceSnapshot, TransferRecord } from "./ledger.ts";
import { describe, expect, it } from "vitest";
import type { LedgerData } from "./merge.ts";
import { mergeLedgers } from "./merge.ts";
import { transferKey } from "./ledger.ts";

function snapshot(takenAt: number, balance: number): BalanceSnapshot {
  return { takenAt, updatedAt: null, accounts: [{ id: "100", name: "お財布", balance }] };
}

function transfer(at: number, amount: number): TransferRecord {
  return {
    transferredAt: at,
    from: { id: "100", name: "お財布" },
    to: { id: "101", name: "積立" },
    amount,
  };
}

function ledger(overrides: Partial<LedgerData> = {}): LedgerData {
  return { snapshots: [], transfers: [], comments: {}, deletions: {}, ...overrides };
}

function entry(text: string, updatedAt: number): { text: string; updatedAt: number } {
  return { text, updatedAt };
}

describe("mergeLedgers", () => {
  it("空同士は空を返す", () => {
    expect(mergeLedgers(ledger(), ledger())).toStrictEqual(ledger());
  });

  it("リモートにしかない記録を取り込み時系列順に並べる", () => {
    const local = ledger({ snapshots: [snapshot(30, 300)], transfers: [transfer(3, 3000)] });
    const remote = ledger({
      snapshots: [snapshot(10, 100), snapshot(20, 200)],
      transfers: [transfer(1, 1000)],
    });

    const merged = mergeLedgers(local, remote);

    expect(merged.snapshots.map((snap) => snap.takenAt)).toStrictEqual([10, 20, 30]);
    expect(merged.transfers.map((record) => record.transferredAt)).toStrictEqual([1, 3]);
  });

  it("両方にある同一の記録は1件にする", () => {
    const local = ledger({ snapshots: [snapshot(10, 100)], transfers: [transfer(1, 1000)] });
    const remote = ledger({ snapshots: [snapshot(10, 100)], transfers: [transfer(1, 1000)] });

    const merged = mergeLedgers(local, remote);

    expect(merged.snapshots).toHaveLength(1);
    expect(merged.transfers).toHaveLength(1);
  });

  it("同時刻の異なる金額の振替は別の記録として保持する", () => {
    const local = ledger({ transfers: [transfer(1, 1000)] });
    const remote = ledger({ transfers: [transfer(1, 2000)] });

    expect(mergeLedgers(local, remote).transfers).toHaveLength(2);
  });

  it("マージ後に連続する同じ残高のスナップショットは畳む", () => {
    // 別端末が同じ残高を別時刻に記録したケース
    const local = ledger({ snapshots: [snapshot(10, 100)] });
    const remote = ledger({ snapshots: [snapshot(20, 100), snapshot(30, 200)] });

    const merged = mergeLedgers(local, remote);

    expect(merged.snapshots.map((snap) => snap.takenAt)).toStrictEqual([10, 30]);
  });

  it("コメントは更新時刻の新しい方を採用する", () => {
    const local = ledger({
      comments: { "transfer:1": entry("ローカル", 5), "transfer:3": entry("ローカルのみ", 1) },
    });
    const remote = ledger({
      comments: { "transfer:1": entry("リモート", 9), "transfer:2": entry("リモートのみ", 1) },
    });

    expect(mergeLedgers(local, remote).comments).toStrictEqual({
      "transfer:1": entry("リモート", 9),
      "transfer:2": entry("リモートのみ", 1),
      "transfer:3": entry("ローカルのみ", 1),
    });
  });

  it("コメントの更新時刻が同じならローカルを優先する", () => {
    const local = ledger({ comments: { "transfer:1": entry("ローカル", 5) } });
    const remote = ledger({ comments: { "transfer:1": entry("リモート", 5) } });

    expect(mergeLedgers(local, remote).comments).toStrictEqual({
      "transfer:1": entry("ローカル", 5),
    });
  });

  it("削除の記録がある振替はマージ結果に含めない", () => {
    // 端末Aで削除→同期したとき、リモート(や自端末)に残る振替が復活しないこと
    const removed = transfer(1, 1000);
    const local = ledger({ deletions: { [transferKey(removed)]: 9 } });
    const remote = ledger({ transfers: [removed] });

    const merged = mergeLedgers(local, remote);

    expect(merged.transfers).toStrictEqual([]);
    expect(merged.deletions).toStrictEqual({ [transferKey(removed)]: 9 });
  });

  it("削除の記録は両方のものを持ち寄る", () => {
    const local = ledger({ deletions: { keyA: 1 } });
    const remote = ledger({ deletions: { keyB: 2 } });

    expect(mergeLedgers(local, remote).deletions).toStrictEqual({ keyA: 1, keyB: 2 });
  });

  it("削除の記録(tombstone)が新しければコメントは復活しない", () => {
    // 端末Aで削除→同期したとき、リモートに残る古いコメントが上書きで戻ってこないこと
    const local = ledger({ comments: { "transfer:1": entry("", 9) } });
    const remote = ledger({ comments: { "transfer:1": entry("家賃", 5) } });

    expect(mergeLedgers(local, remote).comments).toStrictEqual({ "transfer:1": entry("", 9) });
  });
});
