// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import {
  type DashboardData,
  formatDateTime,
  formatSigned,
  formatYen,
  renderDashboard,
  transfersCsv,
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
  return {
    snapshots,
    transfers,
    comments: {},
    deletions: {},
    syncConfig: null,
    lastSyncedAt: null,
    ...overrides,
  };
}

function render(root: HTMLElement, d = data(), now?: () => number) {
  const handlers = {
    onCommentChange: vi.fn<(key: string, text: string) => void>(),
    onDeleteTransfer: vi.fn<(transfer: TransferRecord) => void>(),
    onSaveSyncConfig: vi.fn(async () => "保存しました"),
    onSyncNow: vi.fn(async () => "同期しました"),
    onImportFile: vi.fn(async () => "読み込みました"),
  };
  const redraw = renderDashboard(root, d, handlers, now);
  return { ...handlers, redraw };
}

describe("transfersCsv", () => {
  it("ヘッダー付きで振替を新しい順にCSV化する(Excel向けBOM付き)", () => {
    const comments = {
      [`transfer:${transfers[1].transferredAt}`]: { text: "生活費", updatedAt: 1 },
    };

    const csv = transfersCsv(transfers, comments);

    expect(csv).toBe(
      "﻿日時,出金口座,入金口座,金額,コメント\r\n" +
        `${formatDateTime(transfers[0].transferredAt)},01: お財布,02: 積立,5000,\r\n` +
        `${formatDateTime(transfers[1].transferredAt)},02: 積立,03: 支払い箱,30000,生活費\r\n`,
    );
  });

  it("カンマや引用符を含むフィールドはRFC4180形式でエスケープする", () => {
    const t = {
      transferredAt: 1,
      from: { id: "1", name: 'A,B"C' },
      to: { id: "2", name: "D" },
      amount: 100,
    };

    const csv = transfersCsv([t], {});

    expect(csv).toContain('"A,B""C",D,100,');
  });
});

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

  describe("口座タブ", () => {
    function clickTab(label: string) {
      [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")]
        .find((t) => t.textContent === label)!
        .click();
    }

    it("すべての口座のタブと「すべて」タブを表示する", () => {
      render(root);

      const labels = [...root.querySelectorAll(".transfers .tab")].map((t) => t.textContent);
      expect(labels).toEqual(["すべて", "01: お財布", "02: 積立", "03: 支払い箱"]);
    });

    it("タブを選ぶとその口座の入出金を符号付きで並べる", () => {
      render(root);

      clickTab("02: 積立");

      const rows = [...root.querySelectorAll(".transfers tbody tr")];
      expect(rows).toHaveLength(2);
      // お財布 → 積立 5,000円 は積立から見ると入金
      expect(rows[0].textContent).toContain("+5,000円");
      // 積立 → 支払い箱 30,000円 は出金
      expect(rows[1].textContent).toContain("-30,000円");
    });

    it("出金しかない口座は出金だけを表示する", () => {
      render(root);

      clickTab("01: お財布");

      const rows = [...root.querySelectorAll(".transfers tbody tr")];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("-5,000円");
    });

    it("絞り込み中は出金と入金の合計を表示する", () => {
      render(root);

      clickTab("02: 積立");

      const summary = root.querySelector(".transfers .destination-summary")!;
      expect(summary.textContent).toContain("出金 -30,000円");
      expect(summary.textContent).toContain("入金 +5,000円");
    });

    it("「すべて」タブに戻すと全件を符号なしで表示する", () => {
      render(root);

      clickTab("01: お財布");
      clickTab("すべて");

      const rows = [...root.querySelectorAll(".transfers tbody tr")];
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain("5,000円");
      expect(rows[0].textContent).not.toContain("-5,000円");
    });
  });

  describe("口座別サマリー", () => {
    function card(name: string): HTMLElement {
      return [...root.querySelectorAll<HTMLElement>(".workspaces .workspace-card")].find((c) =>
        c.querySelector(".workspace-name")!.textContent!.includes(name),
      )!;
    }

    it("口座ごとのカードに残高・変動・振替・外部入出金のKPIを表示する", () => {
      render(root);

      const cards = root.querySelectorAll(".workspaces .workspace-card");
      expect(cards).toHaveLength(3);

      const wallet = card("01: お財布");
      // 残高 129,392円、期間内変動 -5,000円(振替 -5,000円、外部 ±0円)
      expect(wallet.querySelector(".kpi-balance")!.textContent).toContain("129,392円");
      expect(wallet.querySelector(".kpi-delta")!.textContent).toContain("-5,000円");
      expect(wallet.querySelector(".kpi-transfer")!.textContent).toContain("-5,000円");
      expect(wallet.querySelector(".kpi-external")!.textContent).toContain("±0円");
    });

    it("残高が2点以上ある口座は推移の折れ線グラフを表示する", () => {
      render(root);

      const wallet = card("01: お財布");
      const svg = wallet.querySelector("svg.balance-chart")!;
      expect(svg).not.toBeNull();
      expect(svg.querySelector(".chart-line")).not.toBeNull();
      expect(svg.querySelector(".chart-area")).not.toBeNull();
      // 期間内の各スナップショットの値はホバーで読める
      expect(svg.querySelectorAll(".chart-hit")).toHaveLength(2);
    });

    it("残高が1点しかない口座はグラフを出さない", () => {
      render(root);

      // 支払い箱は2つ目のスナップショットにしか現れない
      expect(card("03: 支払い箱").querySelector("svg.balance-chart")).toBeNull();
    });

    it("期間で絞り込むとサマリーも追随する", () => {
      render(root);

      const input = root.querySelector<HTMLInputElement>('input[name="period-to"]')!;
      input.value = "2026-07-09";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(root.querySelectorAll(".workspaces .workspace-card")).toHaveLength(2);
      expect(card("01: お財布").querySelector(".kpi-balance")!.textContent).toContain("134,392円");
    });

    it("期間内にスナップショットがなければセクションを出さない", () => {
      render(root, data({ snapshots: [] }));

      expect(root.querySelector(".workspaces")).toBeNull();
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

      render(root, data({ comments: { [key]: { text: "積立へ移動", updatedAt: 1 } } }));

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

    it("過去のコメントを入力候補として提示する", () => {
      render(
        root,
        data({
          comments: {
            "transfer:1": { text: "家賃", updatedAt: 1 },
            "transfer:2": { text: "家賃", updatedAt: 1 },
            "change:101:3": { text: "給料", updatedAt: 1 },
          },
        }),
      );

      const input = root.querySelector<HTMLInputElement>("input.comment")!;
      const listId = input.getAttribute("list")!;
      const options = [...root.querySelectorAll(`#${listId} option`)];
      expect(options.map((o) => o.getAttribute("value"))).toEqual(["家賃", "給料"]);
    });

    it("コメントがなければ候補も空にする", () => {
      render(root);

      const input = root.querySelector<HTMLInputElement>("input.comment")!;
      const listId = input.getAttribute("list")!;
      expect(root.querySelectorAll(`#${listId} option`)).toHaveLength(0);
    });

    it("タブを切り替えてもコメントは保持して表示する", () => {
      const key = `transfer:${transfers[0].transferredAt}`;

      render(root, data({ comments: { [key]: { text: "積立へ移動", updatedAt: 1 } } }));
      [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")]
        .find((t) => t.textContent === "01: お財布")!
        .click();

      const input = root.querySelector<HTMLInputElement>(".transfers input.comment")!;
      expect(input.value).toBe("積立へ移動");
    });
  });

  describe("残高推移の合計グラフ", () => {
    it("スナップショットが2件以上あれば合計残高の折れ線を表示する", () => {
      render(root);

      const chart = root.querySelector(".snapshots .total-chart svg.balance-chart");
      expect(chart).not.toBeNull();
      // 最新の合計 129,392 + 82,520 + 272,469 = 484,381円 が終端ラベルに出る
      expect(chart!.textContent).toContain("484,381円");
    });

    it("スナップショットが1件なら合計グラフは表示しない", () => {
      render(root, data({ snapshots: [snapshots[0]], transfers: [] }));

      expect(root.querySelector(".snapshots .total-chart")).toBeNull();
    });
  });

  describe("記録の鮮度", () => {
    // 最新の記録は2つ目のスナップショット (7/10 13:34)
    const latestAt = Date.UTC(2026, 6, 10, 13, 34);
    const DAY = 24 * 60 * 60 * 1000;
    const config = {
      accountId: "abc",
      bucket: "b",
      objectKey: "k.json",
      accessKeyId: "ak",
      secretAccessKey: "sk",
    };

    it("最終記録の時刻を表示する", () => {
      render(root, data(), () => latestAt + DAY);

      expect(root.querySelector(".freshness .latest-record")!.textContent).toBe(
        `最終記録: ${formatDateTime(latestAt)}`,
      );
    });

    it("7日以上記録が増えていなければ警告する", () => {
      render(root, data(), () => latestAt + 8 * DAY);

      expect(root.querySelector(".freshness .stale-warning")).not.toBeNull();
    });

    it("記録が新しければ警告しない", () => {
      render(root, data(), () => latestAt + DAY);

      expect(root.querySelector(".freshness .stale-warning")).toBeNull();
    });

    it("同期設定があれば最終同期時刻を表示する", () => {
      const syncedAt = latestAt + DAY;
      render(root, data({ syncConfig: config, lastSyncedAt: syncedAt }), () => syncedAt);

      expect(root.querySelector(".freshness .last-synced")!.textContent).toBe(
        `最終同期: ${formatDateTime(syncedAt)}`,
      );
    });

    it("同期設定はあるがまだ同期していなければその旨を表示する", () => {
      render(root, data({ syncConfig: config }), () => latestAt);

      expect(root.querySelector(".freshness .last-synced")!.textContent).toContain(
        "まだ同期していません",
      );
    });

    it("同期設定がなければ最終同期は表示しない", () => {
      render(root, data(), () => latestAt);

      expect(root.querySelector(".freshness .last-synced")).toBeNull();
    });
  });

  describe("振替の削除", () => {
    it("削除ボタンを押し確認するとハンドラへ振替を渡す", () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { onDeleteTransfer } = render(root);

      root.querySelector<HTMLButtonElement>(".transfers button.delete-transfer")!.click();

      // 行は新しい順なので先頭の削除ボタンは transfers[0] のもの
      expect(onDeleteTransfer).toHaveBeenCalledWith(transfers[0]);
    });

    it("確認ダイアログをキャンセルしたら削除しない", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { onDeleteTransfer } = render(root);

      root.querySelector<HTMLButtonElement>(".transfers button.delete-transfer")!.click();

      expect(onDeleteTransfer).not.toHaveBeenCalled();
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

    it("保存済みの同期設定をエクスポートリンクに含める", () => {
      render(root, data({ syncConfig: savedConfig }));
      openSettings();

      const link = root.querySelector<HTMLAnchorElement>(".sync a.export-config")!;

      expect(link.download).toBe("aozora-history-sync-config.json");
      const prefix = "data:application/json;charset=utf-8,";
      expect(link.href.startsWith(prefix)).toBe(true);
      expect(JSON.parse(decodeURIComponent(link.href.slice(prefix.length)))).toEqual(savedConfig);
    });

    it("同期設定が未保存ならエクスポートリンクを出さない", () => {
      render(root);
      openSettings();

      expect(root.querySelector(".sync a.export-config")).toBeNull();
    });

    it("設定JSONを選ぶと保存して結果を表示する", async () => {
      const { onSaveSyncConfig } = render(root);
      openSettings();

      const input = root.querySelector<HTMLInputElement>('input[name="import-config-file"]')!;
      const file = new File([JSON.stringify(savedConfig)], "aozora-history-sync-config.json", {
        type: "application/json",
      });
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));

      await vi.waitFor(() => {
        expect(root.querySelector(".sync .sync-status")!.textContent).toBe("保存しました");
      });
      expect(onSaveSyncConfig).toHaveBeenCalledWith(savedConfig);
    });

    it("不正な設定JSONはエラーを表示して保存しない", async () => {
      const { onSaveSyncConfig } = render(root);
      openSettings();

      const input = root.querySelector<HTMLInputElement>('input[name="import-config-file"]')!;
      const file = new File(["not json"], "config.json", { type: "application/json" });
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));

      await vi.waitFor(() => {
        expect(root.querySelector(".sync .sync-status")!.textContent).toBe(
          "読み込みに失敗しました: JSONとして読み込めませんでした",
        );
      });
      expect(onSaveSyncConfig).not.toHaveBeenCalled();
    });
  });

  describe("インポート / エクスポート", () => {
    function openSettings() {
      root.querySelector<HTMLButtonElement>("button.settings-button")!.click();
    }

    it("エクスポートリンクがR2オブジェクトと同じ形式で現在のデータを含む", () => {
      const comments = { "transfer:1": { text: "メモ", updatedAt: 1 } };
      const deletions = { "9:1:2:100": 5 };
      render(root, data({ comments, deletions }));
      openSettings();

      const link = root.querySelector<HTMLAnchorElement>("a.export")!;

      expect(link.download).toBe("aozora-history.json");
      const prefix = "data:application/json;charset=utf-8,";
      expect(link.href.startsWith(prefix)).toBe(true);
      const json = JSON.parse(decodeURIComponent(link.href.slice(prefix.length)));
      expect(json).toEqual({ snapshots, transfers, comments, deletions });
    });

    it("CSVエクスポートリンクが振替履歴とコメントを含む", () => {
      const comments = {
        [`transfer:${transfers[0].transferredAt}`]: { text: "積立へ", updatedAt: 1 },
      };
      render(root, data({ comments }));
      openSettings();

      const link = root.querySelector<HTMLAnchorElement>("a.export-csv")!;

      expect(link.download).toBe("aozora-history.csv");
      const prefix = "data:text/csv;charset=utf-8,";
      expect(link.href.startsWith(prefix)).toBe(true);
      const csv = decodeURIComponent(link.href.slice(prefix.length));
      expect(csv).toContain("日時,出金口座,入金口座,金額,コメント");
      expect(csv).toContain("積立へ");
    });

    it("JSONファイルを選ぶと内容を渡して結果を表示する", async () => {
      const { onImportFile } = render(root);
      openSettings();

      const input = root.querySelector<HTMLInputElement>('input[name="import-file"]')!;
      const file = new File(['{"transfers":[]}'], "aozora-history.json", {
        type: "application/json",
      });
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));

      await vi.waitFor(() => {
        expect(root.querySelector(".import-status")!.textContent).toBe("読み込みました");
      });
      expect(onImportFile).toHaveBeenCalledWith('{"transfers":[]}');
    });

    it("ファイル未選択のchangeでは何もしない", () => {
      const { onImportFile } = render(root);
      openSettings();

      const input = root.querySelector<HTMLInputElement>('input[name="import-file"]')!;
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(onImportFile).not.toHaveBeenCalled();
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

  describe("再描画関数", () => {
    it("選択中のタブを保ったまま最新のデータを表示する", () => {
      const d = data();
      const { redraw } = render(root, d);
      [...root.querySelectorAll<HTMLButtonElement>(".transfers .tab")]
        .find((t) => t.textContent === "01: お財布")!
        .click();

      // 開いている間に別の場所(銀行サイトのタブや自動同期)で振替が増えた
      d.transfers = [
        ...transfers,
        {
          transferredAt: Date.UTC(2026, 6, 10, 14, 0),
          from: { id: "133331", name: "01: お財布" },
          to: { id: "133805", name: "03: 支払い箱" },
          amount: 700,
        },
      ];
      redraw();

      expect(root.querySelector(".transfers .tab.active")!.textContent).toBe("01: お財布");
      expect(root.querySelector(".transfers")!.textContent).toContain("700円");
    });
  });

  it("テーブルは横スクロール用のラッパーに入る", () => {
    render(root);

    const tables = root.querySelectorAll("table");
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.parentElement?.classList.contains("table-scroll")).toBe(true);
    }
  });
});
