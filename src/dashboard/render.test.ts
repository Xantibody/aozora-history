// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import {
  type DashboardData,
  formatDateTime,
  formatSigned,
  formatYen,
  renderDashboard,
} from "./render.ts";

const snapshots: BalanceSnapshot[] = [
  {
    takenAt: Date.UTC(2026, 6, 9, 13, 0),
    updatedAt: "2026/07/09 21:59",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 134392 },
      { id: "133332", name: "02: 積立", balance: 82520 },
    ],
  },
  {
    takenAt: Date.UTC(2026, 6, 10, 13, 34),
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
    // 2つ目のスナップショット区間 (7/9 13:00, 7/10 13:34] の中
    transferredAt: Date.UTC(2026, 6, 10, 13, 30),
    from: { id: "133331", name: "01: お財布" },
    to: { id: "133332", name: "02: 積立" },
    amount: 5000,
  },
  {
    transferredAt: Date.UTC(2026, 6, 8, 0, 0),
    from: { id: "133332", name: "02: 積立" },
    to: { id: "133805", name: "03: 支払い箱" },
    amount: 30000,
  },
];

function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return { snapshots, transfers, comments: {}, ...overrides };
}

function render(root: HTMLElement, d = data(), onCommentChange = vi.fn()) {
  renderDashboard(root, d, { onCommentChange });
  return onCommentChange;
}

describe("formatYen", () => {
  it("カンマ区切りと円記号を付ける", () => {
    expect(formatYen(129392)).toBe("129,392円");
    expect(formatYen(0)).toBe("0円");
  });
});

describe("formatSigned", () => {
  it("符号付きで金額を表示する", () => {
    expect(formatSigned(280000)).toBe("+280,000円");
    expect(formatSigned(-5000)).toBe("-5,000円");
    expect(formatSigned(0)).toBe("±0円");
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
    render(root, data({ snapshots: [], transfers: [] }));

    expect(root.textContent).toContain("まだ記録がありません");
  });

  it("最新スナップショットの残高と合計を表示する", () => {
    render(root);

    const balances = root.querySelector(".balances")!;
    expect(balances.textContent).toContain("01: お財布");
    expect(balances.textContent).toContain("129,392円");
    expect(balances.textContent).toContain("合計");
    expect(balances.textContent).toContain("484,381円");
    expect(balances.textContent).toContain("2026/07/10 22:34");
  });

  it("振替履歴を新しい順に表示する", () => {
    render(root);

    const rows = [...root.querySelectorAll(".transfers tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("5,000円");
    expect(rows[1].textContent).toContain("30,000円");
  });

  describe("出金口座タブ", () => {
    it("すべての口座のタブと「すべて」タブを表示する", () => {
      render(root);

      const labels = [...root.querySelectorAll(".transfers .tab")].map((t) => t.textContent);
      expect(labels).toEqual(["すべて", "01: お財布", "02: 積立", "03: 支払い箱"]);
    });

    it("タブを選ぶと出金口座で絞り込む", () => {
      render(root);

      const walletTab = [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")].find(
        (t) => t.textContent === "01: お財布",
      )!;
      walletTab.click();

      const rows = [...root.querySelectorAll(".transfers tbody tr")];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("5,000円");
    });

    it("絞り込み中は入金先ごとの合計を表示する", () => {
      render(root);

      const savingTab = [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")].find(
        (t) => t.textContent === "02: 積立",
      )!;
      savingTab.click();

      const summary = root.querySelector(".transfers .destination-summary")!;
      expect(summary.textContent).toContain("03: 支払い箱");
      expect(summary.textContent).toContain("30,000円");
    });

    it("「すべて」タブに戻すと全件表示する", () => {
      render(root);
      const tabs = [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")];

      tabs.find((t) => t.textContent === "01: お財布")!.click();
      [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")]
        .find((t) => t.textContent === "すべて")!
        .click();

      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(2);
    });
  });

  describe("残高変動", () => {
    it("振替で説明できない増減を入金・出金として表示する", () => {
      // 支払い箱は途中から現れて +272,469円 → 振替記録がないため外部入金扱い
      render(root);

      const section = root.querySelector(".changes")!;
      expect(section.textContent).toContain("+272,469円");
      expect(section.textContent).toContain("入金");
    });

    it("変動がなければ空状態を表示する", () => {
      render(root, data({ snapshots: [snapshots[0]], transfers: [] }));

      expect(root.querySelector(".changes")!.textContent).toContain("まだ記録がありません");
    });
  });

  describe("コメント編集", () => {
    it("保存済みコメントを表示する", () => {
      const key = `transfer:${transfers[0].transferredAt}`;

      render(root, data({ comments: { [key]: "積立へ移動" } }));

      const inputs = [...root.querySelectorAll<HTMLInputElement>(".transfers input.comment")];
      expect(inputs.map((i) => i.value)).toContain("積立へ移動");
    });

    it("振替のコメントを編集するとキー付きで通知する", () => {
      const onCommentChange = render(root);

      const input = root.querySelector<HTMLInputElement>(".transfers input.comment")!;
      input.value = "定期積立";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(onCommentChange).toHaveBeenCalledWith(
        `transfer:${transfers[0].transferredAt}`,
        "定期積立",
      );
    });

    it("残高変動のコメントも編集できる", () => {
      const onCommentChange = render(root);

      const input = root.querySelector<HTMLInputElement>(".changes input.comment")!;
      input.value = "給料";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(onCommentChange).toHaveBeenCalledWith(expect.stringMatching(/^change:/), "給料");
    });

    it("タブを切り替えてもコメントは保持して表示する", () => {
      const key = `transfer:${transfers[0].transferredAt}`;

      render(root, data({ comments: { [key]: "積立へ移動" } }));
      [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")]
        .find((t) => t.textContent === "01: お財布")!
        .click();

      const input = root.querySelector<HTMLInputElement>(".transfers input.comment")!;
      expect(input.value).toBe("積立へ移動");
    });
  });

  describe("期間フィルタ", () => {
    function setPeriod(name: "period-from" | "period-to", value: string) {
      const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    it("開始日以降だけに絞り込む", () => {
      render(root);

      setPeriod("period-from", "2026-07-10");

      // 7/8の振替30,000円は範囲外、7/10の振替5,000円は範囲内
      const rows = [...root.querySelectorAll(".transfers tbody tr")];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("5,000円");
    });

    it("終了日までに絞り込み、残高推移にも適用する", () => {
      render(root);

      setPeriod("period-to", "2026-07-09");

      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(1);
      // スナップショットは7/9分だけになる
      expect(root.querySelectorAll(".snapshots tbody tr")).toHaveLength(1);
    });

    it("残高変動にも期間を適用する", () => {
      render(root);

      setPeriod("period-to", "2026-07-09");

      expect(root.querySelector(".changes")!.textContent).toContain("まだ記録がありません");
    });

    it("期間をクリアすると全件に戻る", () => {
      render(root);
      setPeriod("period-from", "2026-07-10");

      root.querySelector<HTMLButtonElement>(".period button")!.click();

      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(2);
    });

    it("期間を変えてもタブの選択は保持する", () => {
      render(root);
      [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")]
        .find((t) => t.textContent === "02: 積立")!
        .click();

      setPeriod("period-from", "2026-07-01");

      const active = root.querySelector(".transfers .tab.active")!;
      expect(active.textContent).toBe("02: 積立");
    });
  });

  it("口座名のHTMLをそのまま解釈しない", () => {
    const malicious: BalanceSnapshot = {
      takenAt: 1,
      updatedAt: null,
      accounts: [{ id: "1", name: "<img src=x onerror=alert(1)>", balance: 1 }],
    };

    render(root, data({ snapshots: [malicious], transfers: [] }));

    expect(root.querySelector("img")).toBeNull();
  });

  it("再描画すると前の内容を置き換える", () => {
    render(root);
    render(root);

    expect(root.querySelectorAll(".balances")).toHaveLength(1);
  });
});
