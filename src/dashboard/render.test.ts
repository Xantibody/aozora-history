// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import { formatDateTime, formatYen, renderDashboard } from "./render.ts";

const snapshots: BalanceSnapshot[] = [
  {
    takenAt: Date.UTC(2026, 6, 9, 13, 0), // JST 2026/07/09 22:00
    updatedAt: "2026/07/09 21:59",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 134392 },
      { id: "133332", name: "02: 積立", balance: 82520 },
    ],
  },
  {
    takenAt: Date.UTC(2026, 6, 10, 13, 34), // JST 2026/07/10 22:34
    updatedAt: "2026/07/10 22:34",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 129392 },
      { id: "133332", name: "02: 積立", balance: 82520 },
      { id: "133805", name: "03: 支払い箱", balance: 272469 },
    ],
  },
];

const transfers: TransferRecord[] = [
  {
    transferredAt: Date.UTC(2026, 6, 10, 13, 40),
    from: { id: "133331", name: "01: お財布" },
    to: { id: "133332", name: "02: 積立" },
    amount: 5000,
  },
];

describe("formatYen", () => {
  it("カンマ区切りと円記号を付ける", () => {
    expect(formatYen(129392)).toBe("129,392円");
    expect(formatYen(0)).toBe("0円");
  });
});

describe("formatDateTime", () => {
  it("エポックミリ秒をローカル日時で表示する", () => {
    const ms = new Date(2026, 6, 10, 22, 34).getTime();

    expect(formatDateTime(ms)).toBe("2026/07/10 22:34");
  });
});

describe("renderDashboard", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById("app")!;
  });

  it("記録がなければ空状態を表示する", () => {
    renderDashboard(root, [], []);

    expect(root.textContent).toContain("まだ記録がありません");
  });

  it("最新スナップショットの残高と合計を表示する", () => {
    renderDashboard(root, snapshots, transfers);

    const balances = root.querySelector(".balances")!;
    expect(balances.textContent).toContain("01: お財布");
    expect(balances.textContent).toContain("129,392円");
    expect(balances.textContent).toContain("03: 支払い箱");
    expect(balances.textContent).toContain("272,469円");
    expect(balances.textContent).toContain("合計");
    expect(balances.textContent).toContain("484,381円");
    expect(balances.textContent).toContain("2026/07/10 22:34");
  });

  it("振替履歴を新しい順に表示する", () => {
    const older: TransferRecord = {
      transferredAt: Date.UTC(2026, 6, 8, 0, 0),
      from: { id: "133332", name: "02: 積立" },
      to: { id: "133805", name: "03: 支払い箱" },
      amount: 30000,
    };

    renderDashboard(root, snapshots, [older, ...transfers]);

    const rows = [...root.querySelectorAll(".transfers tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("01: お財布");
    expect(rows[0].textContent).toContain("5,000円");
    expect(rows[1].textContent).toContain("30,000円");
  });

  it("残高推移をスナップショットの新しい順に表示する", () => {
    renderDashboard(root, snapshots, transfers);

    const table = root.querySelector(".snapshots")!;
    const header = table.querySelector("thead")!.textContent;
    expect(header).toContain("01: お財布");
    expect(header).toContain("03: 支払い箱");

    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("129,392円");
    // 古いスナップショットに存在しない口座はプレースホルダー表示
    expect(rows[1].textContent).toContain("—");
  });

  it("口座名のHTMLをそのまま解釈しない", () => {
    const malicious: BalanceSnapshot = {
      takenAt: 1,
      updatedAt: null,
      accounts: [{ id: "1", name: "<img src=x onerror=alert(1)>", balance: 1 }],
    };

    renderDashboard(root, [malicious], []);

    expect(root.querySelector("img")).toBeNull();
  });

  it("再描画すると前の内容を置き換える", () => {
    renderDashboard(root, snapshots, transfers);
    renderDashboard(root, snapshots, transfers);

    expect(root.querySelectorAll(".balances")).toHaveLength(1);
  });
});
