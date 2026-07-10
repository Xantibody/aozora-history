import { describe, expect, it } from "vitest";
import type { SubAccount } from "./parser.ts";
import {
  appendSnapshot,
  type BalanceSnapshot,
  balanceSeries,
  latestSnapshot,
  sortTransfersDesc,
  type TransferRecord,
} from "./ledger.ts";

function accounts(...balances: [string, number][]): SubAccount[] {
  return balances.map(([name, balance], i) => ({ id: String(100 + i), name, balance }));
}

function snapshot(takenAt: number, accs: SubAccount[]): BalanceSnapshot {
  return { takenAt, updatedAt: null, accounts: accs };
}

describe("appendSnapshot", () => {
  it("空の履歴に追加する", () => {
    const s = snapshot(1, accounts(["お財布", 100]));

    expect(appendSnapshot([], s)).toEqual([s]);
  });

  it("直前と同じ残高なら追加しない", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, accounts(["お財布", 100]));

    expect(appendSnapshot([s1], s2)).toEqual([s1]);
  });

  it("残高が変わっていれば追加する", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, accounts(["お財布", 200]));

    expect(appendSnapshot([s1], s2)).toEqual([s1, s2]);
  });

  it("口座名の変更も追加する", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, accounts(["生活費", 100]));

    expect(appendSnapshot([s1], s2)).toEqual([s1, s2]);
  });

  it("口座の追加・削除も追加する", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, accounts(["お財布", 100], ["積立", 0]));

    expect(appendSnapshot([s1], s2)).toEqual([s1, s2]);
  });

  it("直前と違えば過去と同じ残高でも追加する", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, accounts(["お財布", 200]));
    const s3 = snapshot(3, accounts(["お財布", 100]));

    expect(appendSnapshot([s1, s2], s3)).toEqual([s1, s2, s3]);
  });

  it("元の配列を変更しない", () => {
    const history = [snapshot(1, accounts(["お財布", 100]))];

    appendSnapshot(history, snapshot(2, accounts(["お財布", 200])));

    expect(history).toHaveLength(1);
  });
});

describe("latestSnapshot", () => {
  it("空の履歴はnullを返す", () => {
    expect(latestSnapshot([])).toBeNull();
  });

  it("最後のスナップショットを返す", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, accounts(["お財布", 200]));

    expect(latestSnapshot([s1, s2])).toEqual(s2);
  });
});

describe("balanceSeries", () => {
  it("空の履歴は空の系列を返す", () => {
    expect(balanceSeries([])).toEqual([]);
  });

  it("口座ごとに残高の推移をまとめる", () => {
    const s1 = snapshot(1, accounts(["お財布", 100], ["積立", 50]));
    const s2 = snapshot(2, accounts(["お財布", 80], ["積立", 70]));

    expect(balanceSeries([s1, s2])).toEqual([
      { id: "100", name: "お財布", points: [{ takenAt: 1, balance: 100 }, { takenAt: 2, balance: 80 }] },
      { id: "101", name: "積立", points: [{ takenAt: 1, balance: 50 }, { takenAt: 2, balance: 70 }] },
    ]);
  });

  it("途中で現れた口座は現れた時点からの系列になり、最新の名前を使う", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, [...accounts(["お財布", 100]), { id: "999", name: "旧名", balance: 10 }]);
    const s3 = snapshot(3, [...accounts(["お財布", 100]), { id: "999", name: "新名", balance: 20 }]);

    const series = balanceSeries([s1, s2, s3]);

    expect(series.find((s) => s.id === "999")).toEqual({
      id: "999",
      name: "新名",
      points: [{ takenAt: 2, balance: 10 }, { takenAt: 3, balance: 20 }],
    });
  });
});

describe("sortTransfersDesc", () => {
  it("振替日時の新しい順に並べ、元の配列は変更しない", () => {
    const t = (at: number): TransferRecord => ({
      transferredAt: at,
      from: { id: "100", name: "お財布" },
      to: { id: "101", name: "積立" },
      amount: 1000,
    });
    const transfers = [t(1), t(3), t(2)];

    expect(sortTransfersDesc(transfers).map((x) => x.transferredAt)).toEqual([3, 2, 1]);
    expect(transfers.map((x) => x.transferredAt)).toEqual([1, 3, 2]);
  });
});
