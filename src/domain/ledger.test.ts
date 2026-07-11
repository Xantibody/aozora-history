import { describe, expect, it } from "vitest";
import type { SubAccount } from "./parser.ts";
import {
  appendSnapshot,
  type BalanceSnapshot,
  balanceSeries,
  commentSuggestions,
  detectBalanceChanges,
  destinationTotals,
  latestRecordAt,
  latestSnapshot,
  sortTransfersDesc,
  totalBalancePoints,
  type TransferRecord,
  flowTotals,
  signedAmountFor,
  transfersInvolving,
  workspaceSummaries,
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

describe("transfersInvolving", () => {
  const transfers = [
    transfer(1, ["100", "お財布"], ["101", "積立"], 1000),
    transfer(2, ["101", "積立"], ["100", "お財布"], 2000),
    transfer(3, ["100", "お財布"], ["102", "支払い箱"], 3000),
  ];

  it("nullなら全件返す", () => {
    expect(transfersInvolving(transfers, null)).toEqual(transfers);
  });

  it("出金側でも入金側でも関わる振替を返す", () => {
    expect(transfersInvolving(transfers, "101").map((t) => t.transferredAt)).toEqual([1, 2]);
  });

  it("該当がなければ空配列を返す", () => {
    expect(transfersInvolving(transfers, "999")).toEqual([]);
  });
});

describe("signedAmountFor", () => {
  const t = transfer(1, ["100", "お財布"], ["101", "積立"], 1000);

  it("出金は負にする", () => {
    expect(signedAmountFor(t, "100")).toBe(-1000);
  });

  it("入金は正にする", () => {
    expect(signedAmountFor(t, "101")).toBe(1000);
  });
});

describe("flowTotals", () => {
  const transfers = [
    transfer(1, ["100", "お財布"], ["101", "積立"], 1000),
    transfer(2, ["101", "積立"], ["100", "お財布"], 2000),
    transfer(3, ["101", "積立"], ["102", "支払い箱"], 3000),
  ];

  it("口座から見た出金合計と入金合計を返す", () => {
    expect(flowTotals(transfers, "101")).toEqual({ outgoing: 5000, incoming: 1000 });
  });

  it("関わる振替がなければゼロを返す", () => {
    expect(flowTotals(transfers, "999")).toEqual({ outgoing: 0, incoming: 0 });
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

describe("workspaceSummaries", () => {
  it("スナップショットがなければ空を返す", () => {
    expect(workspaceSummaries([], [])).toEqual([]);
  });

  it("口座ごとに残高・期間内変動・振替純額・外部入出金・推移をまとめる", () => {
    const s1 = snapshot(10, accounts(["お財布", 100000], ["積立", 50000]));
    const s2 = snapshot(20, accounts(["お財布", 65000], ["積立", 55000]));
    const transfers = [transfer(15, ["100", "お財布"], ["101", "積立"], 5000)];

    expect(workspaceSummaries([s1, s2], transfers)).toEqual([
      {
        id: "100",
        name: "お財布",
        balance: 65000,
        delta: -35000,
        transferNet: -5000,
        externalNet: -30000,
        points: [
          { takenAt: 10, balance: 100000 },
          { takenAt: 20, balance: 65000 },
        ],
      },
      {
        id: "101",
        name: "積立",
        balance: 55000,
        delta: 5000,
        transferNet: 5000,
        externalNet: 0,
        points: [
          { takenAt: 10, balance: 50000 },
          { takenAt: 20, balance: 55000 },
        ],
      },
    ]);
  });

  it("スナップショットが1件だけなら変動はゼロにする", () => {
    const s = snapshot(10, accounts(["お財布", 100000]));

    const summaries = workspaceSummaries([s], []);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].delta).toBe(0);
    expect(summaries[0].balance).toBe(100000);
  });

  it("スナップショットに現れない口座は含めない", () => {
    const s = snapshot(10, accounts(["お財布", 100000]));
    const transfers = [transfer(15, ["100", "お財布"], ["999", "外部"], 5000)];

    expect(workspaceSummaries([s], transfers).map((w) => w.id)).toEqual(["100"]);
  });

  it("外部入出金は期間境界をまたぐ変動も含める(残高変動の表と一致させる)", () => {
    // 期間前(10)と期間内(20)のスナップショットの間に外部入金があったケース。
    // 期間で絞ったスナップショットだけから計算すると区間ごと消えてしまう
    const s1 = snapshot(10, accounts(["お財布", 100000]));
    const s2 = snapshot(20, accounts(["お財布", 130000]));

    expect(workspaceSummaries([s1, s2], [], (ms) => ms >= 15)).toEqual([
      {
        id: "100",
        name: "お財布",
        balance: 130000,
        delta: 0,
        transferNet: 0,
        externalNet: 30000,
        points: [{ takenAt: 20, balance: 130000 }],
      },
    ]);
  });
});

describe("totalBalancePoints", () => {
  it("スナップショットがなければ空を返す", () => {
    expect(totalBalancePoints([])).toEqual([]);
  });

  it("スナップショットごとに全口座の合計を返す", () => {
    const s1 = snapshot(10, accounts(["お財布", 100], ["積立", 50]));
    const s2 = snapshot(20, accounts(["お財布", 70], ["積立", 90]));

    expect(totalBalancePoints([s1, s2])).toEqual([
      { takenAt: 10, balance: 150 },
      { takenAt: 20, balance: 160 },
    ]);
  });
});

describe("latestRecordAt", () => {
  it("記録がなければnullを返す", () => {
    expect(latestRecordAt([], [])).toBeNull();
  });

  it("スナップショットと振替のうち最新の時刻を返す", () => {
    const s = snapshot(10, accounts(["お財布", 100]));
    const t = transfer(25, ["100", "お財布"], ["101", "積立"], 500);

    expect(latestRecordAt([s], [t])).toBe(25);
    expect(latestRecordAt([s], [])).toBe(10);
  });
});

const c = (text: string, updatedAt = 0): { text: string; updatedAt: number } => ({
  text,
  updatedAt,
});

describe("commentSuggestions", () => {
  it("コメントがなければ空を返す", () => {
    expect(commentSuggestions({})).toEqual([]);
  });

  it("同じ内容のコメントは1つの候補にまとめる", () => {
    const comments = {
      "transfer:100": c("家賃"),
      "transfer:200": c("家賃"),
      "change:101:300": c("給料"),
    };

    expect(commentSuggestions(comments)).toEqual(["家賃", "給料"]);
  });

  it("使用回数の多い順に並べる", () => {
    const comments = {
      "transfer:100": c("積立"),
      "transfer:200": c("家賃"),
      "transfer:300": c("家賃"),
      "transfer:400": c("家賃"),
      "transfer:500": c("積立"),
    };

    expect(commentSuggestions(comments)).toEqual(["家賃", "積立"]);
  });

  it("使用回数が同じなら新しい記録のコメントを先にする", () => {
    const comments = {
      "transfer:100": c("古いメモ"),
      "transfer:200": c("新しいメモ"),
    };

    expect(commentSuggestions(comments)).toEqual(["新しいメモ", "古いメモ"]);
  });

  it("編集時刻が記録より新しければそちらで比べる", () => {
    const comments = {
      "transfer:100": c("後から編集", 900),
      "transfer:200": c("新しい記録"),
    };

    expect(commentSuggestions(comments)).toEqual(["後から編集", "新しい記録"]);
  });

  it("削除の記録(tombstone)は候補に出さない", () => {
    const comments = {
      "transfer:100": c("家賃"),
      "transfer:200": c("", 900),
    };

    expect(commentSuggestions(comments)).toEqual(["家賃"]);
  });
});

describe("sortTransfersDesc", () => {
  it("振替日時の新しい順に並べ、元の配列は変更しない", () => {
    const transfers = [transferAt(1), transferAt(3), transferAt(2)];

    expect(sortTransfersDesc(transfers).map((x) => x.transferredAt)).toEqual([3, 2, 1]);
    expect(transfers.map((x) => x.transferredAt)).toEqual([1, 3, 2]);
  });
});
