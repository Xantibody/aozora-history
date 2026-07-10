import { describe, expect, it } from "vitest";
import type { SubAccount } from "./parser.ts";
import {
  appendSnapshot,
  type BalanceSnapshot,
  balanceSeries,
  detectBalanceChanges,
  destinationTotals,
  latestSnapshot,
  sortTransfersDesc,
  type TransferRecord,
  transfersFrom,
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
      {
        id: "100",
        name: "お財布",
        points: [
          { takenAt: 1, balance: 100 },
          { takenAt: 2, balance: 80 },
        ],
      },
      {
        id: "101",
        name: "積立",
        points: [
          { takenAt: 1, balance: 50 },
          { takenAt: 2, balance: 70 },
        ],
      },
    ]);
  });

  it("途中で現れた口座は現れた時点からの系列になり、最新の名前を使う", () => {
    const s1 = snapshot(1, accounts(["お財布", 100]));
    const s2 = snapshot(2, [
      ...accounts(["お財布", 100]),
      { id: "999", name: "旧名", balance: 10 },
    ]);
    const s3 = snapshot(3, [
      ...accounts(["お財布", 100]),
      { id: "999", name: "新名", balance: 20 },
    ]);

    const series = balanceSeries([s1, s2, s3]);

    expect(series.find((s) => s.id === "999")).toEqual({
      id: "999",
      name: "新名",
      points: [
        { takenAt: 2, balance: 10 },
        { takenAt: 3, balance: 20 },
      ],
    });
  });
});

const transferAt = (at: number): TransferRecord => ({
  transferredAt: at,
  from: { id: "100", name: "お財布" },
  to: { id: "101", name: "積立" },
  amount: 1000,
});

function transfer(
  at: number,
  from: [string, string],
  to: [string, string],
  amount: number,
): TransferRecord {
  return {
    transferredAt: at,
    from: { id: from[0], name: from[1] },
    to: { id: to[0], name: to[1] },
    amount,
  };
}

describe("transfersFrom", () => {
  const transfers = [
    transfer(1, ["100", "お財布"], ["101", "積立"], 1000),
    transfer(2, ["101", "積立"], ["100", "お財布"], 2000),
    transfer(3, ["100", "お財布"], ["102", "支払い箱"], 3000),
  ];

  it("nullなら全件返す", () => {
    expect(transfersFrom(transfers, null)).toEqual(transfers);
  });

  it("出金口座で絞り込む", () => {
    expect(transfersFrom(transfers, "100").map((t) => t.transferredAt)).toEqual([1, 3]);
  });

  it("該当がなければ空配列を返す", () => {
    expect(transfersFrom(transfers, "999")).toEqual([]);
  });
});

describe("destinationTotals", () => {
  it("空の振替は空の集計を返す", () => {
    expect(destinationTotals([])).toEqual([]);
  });

  it("入金口座ごとに合計する", () => {
    const transfers = [
      transfer(1, ["100", "お財布"], ["101", "積立"], 1000),
      transfer(2, ["100", "お財布"], ["101", "積立"], 500),
      transfer(3, ["100", "お財布"], ["102", "支払い箱"], 3000),
    ];

    expect(destinationTotals(transfers)).toEqual([
      { id: "101", name: "積立", total: 1500 },
      { id: "102", name: "支払い箱", total: 3000 },
    ]);
  });

  it("入金口座の最新の名前を使う", () => {
    const transfers = [
      transfer(1, ["100", "お財布"], ["101", "旧名"], 1000),
      transfer(2, ["100", "お財布"], ["101", "新名"], 500),
    ];

    expect(destinationTotals(transfers)).toEqual([{ id: "101", name: "新名", total: 1500 }]);
  });
});

describe("detectBalanceChanges", () => {
  const wallet: SubAccount = { id: "100", name: "お財布", balance: 100000 };

  it("スナップショットが1件以下なら何も検出しない", () => {
    expect(detectBalanceChanges([], [])).toEqual([]);
    expect(detectBalanceChanges([snapshot(1, [wallet])], [])).toEqual([]);
  });

  it("振替で説明できる増減は外部入出金にしない", () => {
    const s1 = snapshot(10, [wallet, { id: "101", name: "積立", balance: 50000 }]);
    const s2 = snapshot(20, [
      { ...wallet, balance: 95000 },
      { id: "101", name: "積立", balance: 55000 },
    ]);
    const transfers = [transfer(15, ["100", "お財布"], ["101", "積立"], 5000)];

    expect(detectBalanceChanges([s1, s2], transfers)).toEqual([
      {
        accountId: "100",
        accountName: "お財布",
        fromTakenAt: 10,
        toTakenAt: 20,
        delta: -5000,
        transferDelta: -5000,
        externalDelta: 0,
      },
      {
        accountId: "101",
        accountName: "積立",
        fromTakenAt: 10,
        toTakenAt: 20,
        delta: 5000,
        transferDelta: 5000,
        externalDelta: 0,
      },
    ]);
  });

  it("振替記録のない急な増加は外部入金として検出する", () => {
    const s1 = snapshot(10, [wallet]);
    const s2 = snapshot(20, [{ ...wallet, balance: 380000 }]);

    expect(detectBalanceChanges([s1, s2], [])).toEqual([
      {
        accountId: "100",
        accountName: "お財布",
        fromTakenAt: 10,
        toTakenAt: 20,
        delta: 280000,
        transferDelta: 0,
        externalDelta: 280000,
      },
    ]);
  });

  it("振替と外部出金が混ざった減少を分離する", () => {
    const s1 = snapshot(10, [wallet, { id: "101", name: "積立", balance: 0 }]);
    const s2 = snapshot(20, [
      { ...wallet, balance: 60000 },
      { id: "101", name: "積立", balance: 10000 },
    ]);
    const transfers = [transfer(12, ["100", "お財布"], ["101", "積立"], 10000)];

    const changes = detectBalanceChanges([s1, s2], transfers);

    expect(changes.find((c) => c.accountId === "100")).toEqual({
      accountId: "100",
      accountName: "お財布",
      fromTakenAt: 10,
      toTakenAt: 20,
      delta: -40000,
      transferDelta: -10000,
      externalDelta: -30000,
    });
  });

  it("期間外の振替は集計に含めない", () => {
    const s1 = snapshot(10, [wallet]);
    const s2 = snapshot(20, [{ ...wallet, balance: 90000 }]);
    const transfers = [
      transfer(5, ["100", "お財布"], ["101", "積立"], 999),
      transfer(25, ["100", "お財布"], ["101", "積立"], 999),
      transfer(15, ["100", "お財布"], ["101", "積立"], 10000),
    ];

    expect(detectBalanceChanges([s1, s2], transfers)).toEqual([
      {
        accountId: "100",
        accountName: "お財布",
        fromTakenAt: 10,
        toTakenAt: 20,
        delta: -10000,
        transferDelta: -10000,
        externalDelta: 0,
      },
    ]);
  });

  it("変化のない口座は含めない", () => {
    const s1 = snapshot(10, [wallet, { id: "101", name: "積立", balance: 50000 }]);
    const s2 = snapshot(20, [
      { ...wallet, balance: 90000 },
      { id: "101", name: "積立", balance: 50000 },
    ]);

    const changes = detectBalanceChanges([s1, s2], []);

    expect(changes.map((c) => c.accountId)).toEqual(["100"]);
  });

  it("途中で現れた口座は残高0からの変化として扱う", () => {
    const s1 = snapshot(10, [wallet]);
    const s2 = snapshot(20, [wallet, { id: "101", name: "積立", balance: 30000 }]);

    expect(detectBalanceChanges([s1, s2], [])).toEqual([
      {
        accountId: "101",
        accountName: "積立",
        fromTakenAt: 10,
        toTakenAt: 20,
        delta: 30000,
        transferDelta: 0,
        externalDelta: 30000,
      },
    ]);
  });

  it("複数のスナップショット区間をそれぞれ検出する", () => {
    const s1 = snapshot(10, [wallet]);
    const s2 = snapshot(20, [{ ...wallet, balance: 120000 }]);
    const s3 = snapshot(30, [{ ...wallet, balance: 110000 }]);

    const changes = detectBalanceChanges([s1, s2, s3], []);

    expect(changes.map((c) => [c.toTakenAt, c.delta])).toEqual([
      [20, 20000],
      [30, -10000],
    ]);
  });
});

describe("sortTransfersDesc", () => {
  it("振替日時の新しい順に並べ、元の配列は変更しない", () => {
    const transfers = [transferAt(1), transferAt(3), transferAt(2)];

    expect(sortTransfersDesc(transfers).map((x) => x.transferredAt)).toEqual([3, 2, 1]);
    expect(transfers.map((x) => x.transferredAt)).toEqual([1, 3, 2]);
  });
});
