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
  return { snapshots, transfers, comments: {}, syncConfig: null, ...overrides };
}

function render(root: HTMLElement, d = data()) {
  const handlers = {
    onCommentChange: vi.fn<(key: string, text: string) => void>(),
    onSaveSyncConfig: vi.fn(async () => "保存しました"),
    onSyncNow: vi.fn(async () => "同期しました"),
  };
  renderDashboard(root, d, handlers);
  return handlers;
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
      const { onCommentChange } = render(root);

      const input = root.querySelector<HTMLInputElement>(".transfers input.comment")!;
      input.value = "定期積立";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(onCommentChange).toHaveBeenCalledWith(
        `transfer:${transfers[0].transferredAt}`,
        "定期積立",
      );
    });

    it("残高変動のコメントも編集できる", () => {
      const { onCommentChange } = render(root);

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

    function setMonth(value: string) {
      const input = root.querySelector<HTMLInputElement>('input[name="period-month"]')!;
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

      root.querySelector<HTMLButtonElement>(".period .period-clear")!.click();

      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(2);
    });

    it("月を選択するとその月の記録だけ表示する", () => {
      render(root);

      setMonth("2026-07");
      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(2);

      setMonth("2026-06");
      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(0);
      expect(root.querySelector(".snapshots")!.textContent).toContain("まだ記録がありません");
    });

    it("前の月・次の月ボタンで月を移動する", () => {
      render(root);
      setMonth("2026-07");

      root.querySelector<HTMLButtonElement>(".period .month-next")!.click();

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe(
        "2026-08",
      );
      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(0);

      root.querySelector<HTMLButtonElement>(".period .month-prev")!.click();
      root.querySelector<HTMLButtonElement>(".period .month-prev")!.click();

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe(
        "2026-06",
      );
    });

    it("年をまたぐ月の移動もできる", () => {
      render(root);
      setMonth("2026-01");

      root.querySelector<HTMLButtonElement>(".period .month-prev")!.click();

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe(
        "2025-12",
      );
    });

    it("日付を指定すると月の選択は解除する", () => {
      render(root);
      setMonth("2026-06");

      setPeriod("period-from", "2026-07-10");

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe("");
      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(1);
    });

    it("月を選択すると日付の指定は解除する", () => {
      render(root);
      setPeriod("period-from", "2026-07-10");

      setMonth("2026-07");

      expect(root.querySelector<HTMLInputElement>('input[name="period-from"]')!.value).toBe("");
      expect(root.querySelectorAll(".transfers tbody tr")).toHaveLength(2);
    });

    it("クリアで月も日付も解除する", () => {
      render(root);
      setMonth("2026-06");

      root.querySelector<HTMLButtonElement>(".period .period-clear")!.click();

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe("");
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

  describe("設定画面 (R2同期)", () => {
    const savedConfig = {
      accountId: "abc123",
      bucket: "aozora",
      objectKey: "aozora-history.json",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    };

    function openSettings() {
      root.querySelector<HTMLButtonElement>("button.settings-button")!.click();
    }

    function syncInput(name: string): HTMLInputElement {
      return root.querySelector<HTMLInputElement>(`.sync input[name="${name}"]`)!;
    }

    it("ダッシュボードには同期設定を表示しない", () => {
      render(root);

      expect(root.querySelector(".sync")).toBeNull();
      expect(root.querySelector("button.settings-button")).not.toBeNull();
    });

    it("歯車ボタンで設定画面に切り替わる", () => {
      render(root, data({ syncConfig: savedConfig }));

      openSettings();

      expect(root.querySelector(".settings-view")).not.toBeNull();
      expect(root.querySelector(".balances")).toBeNull();
      expect(syncInput("sync-account-id").value).toBe("abc123");
      expect(syncInput("sync-secret").type).toBe("password");
    });

    it("戻るボタンでダッシュボードに戻る", () => {
      render(root);
      openSettings();

      root.querySelector<HTMLButtonElement>("button.back-button")!.click();

      expect(root.querySelector(".settings-view")).toBeNull();
      expect(root.querySelector(".balances")).not.toBeNull();
    });

    it("設定を保存すると入力値を渡し結果を表示する", async () => {
      const { onSaveSyncConfig } = render(root);
      openSettings();

      syncInput("sync-account-id").value = "acc";
      syncInput("sync-bucket").value = "bkt";
      syncInput("sync-access-key-id").value = "ak";
      syncInput("sync-secret").value = "sk";
      root.querySelector<HTMLButtonElement>(".sync button.save-config")!.click();
      await vi.waitFor(() => {
        expect(root.querySelector(".sync .sync-status")!.textContent).toBe("保存しました");
      });

      expect(onSaveSyncConfig).toHaveBeenCalledWith({
        accountId: "acc",
        bucket: "bkt",
        objectKey: "aozora-history.json",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      });
    });

    it("今すぐ同期を押すと結果を表示する", async () => {
      const { onSyncNow } = render(root, data({ syncConfig: savedConfig }));
      openSettings();

      root.querySelector<HTMLButtonElement>(".sync button.sync-now")!.click();
      await vi.waitFor(() => {
        expect(root.querySelector(".sync .sync-status")!.textContent).toBe("同期しました");
      });

      expect(onSyncNow).toHaveBeenCalled();
    });

    it("記録が空でも設定画面を開ける", () => {
      render(root, data({ snapshots: [], transfers: [] }));

      openSettings();

      expect(root.querySelector(".sync")).not.toBeNull();
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
