import type { BalanceSnapshot, TransferRecord } from "./ledger.ts";
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile.ts";

const WALLET = { id: "1", name: "01: お財布" };
const SAVINGS = { id: "2", name: "02: 積立" };
const PAYMENTS = { id: "3", name: "03: 支払い箱" };

function snapshot(takenAt: number, balances: Record<string, number>): BalanceSnapshot {
  const named: Record<string, string> = {
    [WALLET.id]: WALLET.name,
    [SAVINGS.id]: SAVINGS.name,
    [PAYMENTS.id]: PAYMENTS.name,
  };
  return {
    takenAt,
    updatedAt: null,
    accounts: Object.entries(balances).map(([id, balance]) => ({
      id,
      name: named[id],
      balance,
    })),
  };
}

function transfer(transferredAt: number, amount: number): TransferRecord {
  return { transferredAt, from: WALLET, to: PAYMENTS, amount };
}

describe("reconcile", () => {
  it("記録がなくても、打ち消し合う増減は口座間の振替として拾い直す", () => {
    // 定額自動振替: お財布 → 支払い箱 に 80,000円。拡張は操作を検知していない
    const snapshots = [
      snapshot(100, { "1": 500_000, "3": 10_000 }),
      snapshot(200, { "1": 420_000, "3": 90_000 }),
    ];

    const result = reconcile(snapshots, []);

    expect(result.detected).toStrictEqual([
      { transferredAt: 200, from: WALLET, to: PAYMENTS, amount: 80_000 },
    ]);
    expect(result.changes).toStrictEqual([]);
  });

  it("拾い直した振替は記録済みの振替と1本にまとめ、時刻順に並べる", () => {
    const snapshots = [
      snapshot(100, { "1": 500_000, "3": 10_000 }),
      snapshot(300, { "1": 420_000, "3": 90_000 }),
    ];
    const recorded = transfer(50, 1000);

    const result = reconcile(snapshots, [recorded]);

    expect(result.transfers.map((tr) => tr.transferredAt)).toStrictEqual([50, 300]);
  });

  it("記録済みの振替で説明できる増減は拾い直さない(二重計上しない)", () => {
    const snapshots = [
      snapshot(100, { "1": 500_000, "3": 10_000 }),
      snapshot(300, { "1": 495_000, "3": 15_000 }),
    ];

    const result = reconcile(snapshots, [transfer(200, 5000)]);

    expect(result.detected).toStrictEqual([]);
    expect(result.changes.map((ch) => ch.externalDelta)).toStrictEqual([0, 0]);
  });

  it("打ち消し合わない増減は外部入出金として残す", () => {
    // 給与の入金。相手になる口座がないので振替にはできない
    const snapshots = [snapshot(100, { "1": 500_000 }), snapshot(200, { "1": 800_000 })];

    const result = reconcile(snapshots, []);

    expect(result.detected).toStrictEqual([]);
    expect(result.changes.map((ch) => ch.externalDelta)).toStrictEqual([300_000]);
  });

  it("同じ金額の候補が複数あるときは推測せず差額のまま残す", () => {
    // −5,000 が2口座。どちらが +5,000 の相手か決められない
    const snapshots = [
      snapshot(100, { "1": 10_000, "2": 10_000, "3": 10_000 }),
      snapshot(200, { "1": 5000, "2": 5000, "3": 15_000 }),
    ];

    const result = reconcile(snapshots, []);

    expect(result.detected).toStrictEqual([]);
    expect(result.changes).toHaveLength(3);
  });

  it("定額自動振替の設定に合う組が1つだけなら、候補が複数でも組める", () => {
    // −5,000 が2口座。設定が「積立 → 支払い箱 5,000円」なので、お財布の分ではないと分かる
    const snapshots = [
      snapshot(100, { "1": 10_000, "2": 10_000, "3": 10_000 }),
      snapshot(200, { "1": 5000, "2": 5000, "3": 15_000 }),
    ];
    const setting = { id: "9001", from: SAVINGS, to: PAYMENTS, amount: 5000 };

    const result = reconcile(snapshots, [], [setting]);

    expect(result.detected).toStrictEqual([
      { transferredAt: 200, from: SAVINGS, to: PAYMENTS, amount: 5000 },
    ]);
    expect(result.changes.map((ch) => ch.externalDelta)).toStrictEqual([-5000]);
  });

  it("設定に合う組が複数あるときは、やはり推測しない", () => {
    const snapshots = [
      snapshot(100, { "1": 10_000, "2": 10_000, "3": 10_000 }),
      snapshot(200, { "1": 5000, "2": 5000, "3": 15_000 }),
    ];
    const settings = [
      { id: "9001", from: SAVINGS, to: PAYMENTS, amount: 5000 },
      { id: "9002", from: WALLET, to: PAYMENTS, amount: 5000 },
    ];

    const result = reconcile(snapshots, [], settings);

    expect(result.detected).toStrictEqual([]);
  });

  it("区間をまたぐ増減は突き合わせない(別の機会に起きた入出金のため)", () => {
    const snapshots = [
      snapshot(100, { "1": 10_000, "3": 10_000 }),
      snapshot(200, { "1": 5000, "3": 10_000 }),
      snapshot(300, { "1": 5000, "3": 15_000 }),
    ];

    const result = reconcile(snapshots, []);

    expect(result.detected).toStrictEqual([]);
    expect(result.changes.map((ch) => ch.externalDelta)).toStrictEqual([-5000, 5000]);
  });

  it("金額が同じでも増減の向きが同じならペアにしない", () => {
    const snapshots = [
      snapshot(100, { "1": 10_000, "3": 10_000 }),
      snapshot(200, { "1": 15_000, "3": 15_000 }),
    ];

    const result = reconcile(snapshots, []);

    expect(result.detected).toStrictEqual([]);
    expect(result.changes).toHaveLength(2);
  });
});
