// @vitest-environment jsdom
import type { BalanceSnapshot, TransferRecord } from "../domain/ledger.ts";
import type { DashboardData, DashboardHandlers } from "./render.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDateTime,
  formatSigned,
  formatYen,
  renderDashboard,
  statementsCsv,
  transfersCsv,
} from "./render.ts";
import type { StatementEntry } from "../domain/statement.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";

const snapshots: BalanceSnapshot[] = [
  {
    takenAt: Date.UTC(2026, 6, 9, 13, 0),
    updatedAt: "2026/07/09 21:59",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 134_392 },
      { id: "133332", name: "02: 積立", balance: 82_520 },
    ],
  },
  {
    takenAt: Date.UTC(2026, 6, 10, 13, 34),
    updatedAt: "2026/07/10 22:34",
    accounts: [
      { id: "133331", name: "01: お財布", balance: 129_392 },
      { id: "133332", name: "02: 積立", balance: 82_520 },
      { id: "133805", name: "03: 支払い箱", balance: 272_469 },
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
    amount: 30_000,
  },
];

// ログの内訳(全期間):
//   振替 2件 (5,000円 / 30,000円)
//   外部入出金 2件 (02: 積立 -5,000円、03: 支払い箱 +272,469円; どちらも2つ目のスナップショット時点)
//   残高記録 2件 (合計 216,912円 → 484,381円、期間の増減 +267,469円)

const pad = (value: number): string => String(value).padStart(2, "0");

/** ヘッダーやログ行と同じ「M/D HH:MM」表記(ローカル時刻) */
function shortDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dispatchTouch(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  point: { clientX: number; clientY: number },
): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "touches", { value: [point] });
  target.dispatchEvent(event);
}

function swipe(target: Element, dx: number, dy = 0): void {
  dispatchTouch(target, "touchstart", { clientX: 200, clientY: 300 });
  dispatchTouch(target, "touchmove", { clientX: 200 + dx, clientY: 300 + dy });
  dispatchTouch(target, "touchend", { clientX: 200 + dx, clientY: 300 + dy });
}

/** 大きさの指定を除いた、色を表すクラスだけ */
function dotColor(dot: Element): string {
  return [...dot.classList].filter((name) => name.includes("#")).join(" ");
}

function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    snapshots,
    transfers,
    statements: [],
    autoTransfers: [],
    comments: {},
    deletions: {},
    syncConfig: null,
    lastSyncedAt: null,
    debugMode: false,
    lastCollect: null,
    ...overrides,
  };
}

type RenderResult = DashboardHandlers & { redraw: () => void };

function render(root: HTMLElement, dashboardData = data(), now?: () => number): RenderResult {
  const handlers = {
    onCommentChange: vi.fn<(key: string, text: string) => void>(),
    onDeleteTransfer: vi.fn<(transfer: TransferRecord) => void>(),
    onSaveSyncConfig: vi.fn<(config: SyncConfig) => Promise<string>>(() =>
      Promise.resolve("保存しました"),
    ),
    onSyncNow: vi.fn<() => Promise<string>>(() => Promise.resolve("同期しました")),
    onImportFile: vi.fn<(text: string) => Promise<string>>(() => Promise.resolve("読み込みました")),
    onToggleDebug: vi.fn<(enabled: boolean) => void>(),
    onRequestCollect: vi.fn<() => void>(),
  };
  const redraw = renderDashboard(root, dashboardData, { handlers, now });
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
    const transfer = {
      transferredAt: 1,
      from: { id: "1", name: 'A,B"C' },
      to: { id: "2", name: "D" },
      amount: 100,
    };

    const csv = transfersCsv([transfer], {});

    expect(csv).toContain('"A,B""C",D,100,');
  });
});

describe("formatYen", () => {
  it("カンマ区切りと円記号を付ける", () => {
    expect(formatYen(129_392)).toBe("129,392円");
    expect(formatYen(0)).toBe("0円");
  });
});

describe("formatSigned", () => {
  it("符号付きで金額を表示する", () => {
    expect(formatSigned(280_000)).toBe("+280,000円");
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
  const root = document.createElement("div");

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  function clickTab(label: string): void {
    [...root.querySelectorAll<HTMLButtonElement>(".view-tab")]
      .find((tab) => tab.textContent === label)!
      .click();
  }

  function clickChip(label: string): void {
    [...root.querySelectorAll<HTMLButtonElement>(".log-filters button")]
      .find((chip) => chip.textContent === label)!
      .click();
  }

  function clickAccountChip(name: string): void {
    [...root.querySelectorAll<HTMLButtonElement>(".account-chip")]
      .find((chip) => chip.querySelector(".chip-name")?.textContent === name)!
      .click();
  }

  it("記録がなければ空状態を表示する", () => {
    render(root, data({ snapshots: [], transfers: [] }));

    expect(root.textContent).toContain("まだ記録がありません");
    expect(root.querySelector("button.settings-button")).not.toBeNull();
  });

  describe("ヘッダー", () => {
    it("ログでは合計を文脈として1行に圧縮する(面を持たせない)", () => {
      render(root);

      expect(root.querySelector(".account-strip .total-balance")!.textContent).toBe("484,381円");
    });

    it("残高では合計を大きく出し、期間と増減を添える", () => {
      render(root, data(), () => Date.UTC(2026, 6, 27, 0, 0));
      clickTab("残高");

      const summary = root.querySelector(".total-summary")!;
      expect(summary.textContent).toContain("合計残高 · 7月");
      expect(summary.querySelector(".total-delta")!.textContent).toBe("+267,469円");
      expect(summary.querySelector(".total-balance")!.textContent).toBe("484,381円");
    });

    it("開いたときは当月を表示する", () => {
      render(root, data(), () => Date.UTC(2026, 6, 27, 0, 0));

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe(
        "2026-07",
      );
    });

    it("月ナビはヘッダーの1段目に置く(独立した段を作らない)", () => {
      render(root);

      expect(root.querySelector(".dashboard-header .period")).not.toBeNull();
      expect(root.querySelector("main .period")).toBeNull();
    });

    it("月を空にすると全期間に戻る", () => {
      render(root, data(), () => Date.UTC(2026, 6, 27, 0, 0));
      clickTab("残高");

      const input = root.querySelector<HTMLInputElement>('input[name="period-month"]')!;
      input.value = "";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(root.querySelector(".total-summary")!.textContent).toContain("全期間");
    });
  });

  describe("口座の色", () => {
    /** ログの「A → B」の行から、口座名とドットの色の組を集める */
    function coloredNames(): Map<string, string> {
      const pairs = new Map<string, string>();
      for (const label of root.querySelectorAll(".log-title .account-name")) {
        const dot = label.querySelector(".dot");
        if (dot !== null) {
          pairs.set(label.textContent ?? "", dotColor(dot));
        }
      }
      return pairs;
    }

    it("口座ごとに違う色を割り当てる(並び順で決めるのでぶつからない)", () => {
      render(root, data(), () => Date.UTC(2026, 6, 27, 0, 0));

      const byName = coloredNames();
      expect(byName.size).toBeGreaterThan(1);
      expect(new Set(byName.values()).size).toBe(byName.size);
    });

    it("同じ口座には残高ページでも同じ色を使う", () => {
      render(root, data(), () => Date.UTC(2026, 6, 27, 0, 0));
      const wallet = coloredNames().get("01: お財布");
      clickTab("残高");

      const card = [...root.querySelectorAll(".workspace-card")].find((node) =>
        node.textContent?.includes("01: お財布"),
      )!;

      expect(dotColor(card.querySelector(".dot")!)).toBe(wallet);
    });
  });

  describe("タブ", () => {
    it("初期表示はログタブで、role/aria-selectedを付ける", () => {
      render(root);

      expect(root.querySelector(".view-tabs")!.getAttribute("role")).toBe("tablist");
      const active = root.querySelector(".view-tab.active")!;
      expect(active.textContent).toBe("ログ");
      expect(active.getAttribute("role")).toBe("tab");
      expect(active.getAttribute("aria-selected")).toBe("true");
      expect(root.querySelector(".log")).not.toBeNull();
    });

    it("残高ページには口座カードと推移をまとめて置く", () => {
      render(root);

      clickTab("残高");

      expect(root.querySelector(".accounts")).not.toBeNull();
      expect(root.querySelector(".history")).not.toBeNull();
      expect(root.querySelector(".log")).toBeNull();
    });

    it("タブはログと残高の2つだけ", () => {
      render(root);

      expect([...root.querySelectorAll(".view-tab")].map((tab) => tab.textContent)).toStrictEqual([
        "ログ",
        "残高",
      ]);
    });

    it("タブを切り替えてもフォーカスは選んだタブに残る", () => {
      render(root);

      const tab = [...root.querySelectorAll<HTMLButtonElement>(".view-tab")].find(
        (candidate) => candidate.textContent === "残高",
      )!;
      tab.focus();
      tab.click();

      const nowActive = root.querySelector(".view-tab.active")!;
      expect(nowActive.textContent).toBe("残高");
      expect(document.activeElement).toBe(nowActive);
    });
  });

  describe("ログタブ", () => {
    it("振替・外部入出金を新しい順の1本のログに表示する", () => {
      render(root);

      const rows = [...root.querySelectorAll(".log .log-row")];
      expect(rows).toHaveLength(4);
      // 2つ目のスナップショット時点の外部入出金 → 振替 5,000円 → 7/8の振替 30,000円
      expect(rows.map((row) => row.textContent)).toStrictEqual([
        expect.stringMatching(/02: 積立 → 外部[\s\S]*-5,000円/u),
        expect.stringMatching(/外部 → 03: 支払い箱[\s\S]*\+272,469円/u),
        expect.stringMatching(/01: お財布 → 02: 積立[\s\S]*5,000円/u),
        expect.stringMatching(/02: 積立 → 03: 支払い箱[\s\S]*30,000円/u),
      ]);
    });

    it("残高記録を従属行として表示する", () => {
      render(root);

      const records = [...root.querySelectorAll(".log .snapshot-row")];
      expect(records).toHaveLength(2);
      expect(records[0].textContent).toContain("記録");
      expect(records[0].textContent).toContain("残高スナップショット");
      expect(records[0].textContent).toContain("484,381円");
      expect(records[1].textContent).toContain("216,912円");
    });

    it("日付ごとに見出しを置き、外部入出金の日計を添える", () => {
      render(root);

      const headings = [...root.querySelectorAll(".log .day-heading")];
      // 7/10(外部入出金+振替+記録)、7/9(記録)、7/8(振替) の3グループ
      expect(headings).toHaveLength(3);
      const date = new Date(snapshots[1].takenAt);
      expect(headings[0].textContent).toContain(`${date.getMonth() + 1}月${date.getDate()}日`);
      // 日計は外部入出金の合計のみ。振替だけ・記録だけの日には出さない
      expect(headings[0].querySelector(".day-total")!.textContent).toBe("+267,469円");
      expect(headings[1].querySelector(".day-total")).toBeNull();
      expect(headings[2].querySelector(".day-total")).toBeNull();
    });

    it("金額の列を固定幅・右揃えにし、行の種類によらず右端を揃える", () => {
      render(root);

      // 金額セルが可変幅だと、後続のコメント欄の位置が桁数分ずれてガタガタに見える
      const amounts = [...root.querySelectorAll<HTMLElement>(".log .log-row .amount")];
      expect(amounts.length).toBeGreaterThan(0);
      for (const amount of amounts) {
        expect(amount.className).toContain("w-[120px]");
        expect(amount.className).toContain("text-right");
      }

      // 削除ボタンは振替行にしかないため、外部入出金行には同じ幅のスペーサーを
      // 置かないと金額の右端が振替行より右にはみ出す
      const rows = [...root.querySelectorAll<HTMLElement>(".log .log-row")];
      const trailing = [
        ...root.querySelectorAll<HTMLElement>(
          ".log .log-row .delete-transfer, .log .log-row .delete-spacer",
        ),
      ];
      expect(trailing).toHaveLength(rows.length);
      for (const element of trailing) {
        expect(element.className).toContain("w-[18px]");
      }
    });

    it("極性を色で分けず、符号とインクの濃淡で示す", () => {
      render(root);

      const amounts = [...root.querySelectorAll<HTMLElement>(".log .log-row .amount")];
      // 外部出金 −5,000 / 外部入金 +272,469 / 振替
      expect(amounts[0].className).toContain("text-[#5b6675]");
      expect(amounts[1].className).toContain("text-[#0f172a]");
      for (const amount of amounts) {
        expect(amount.className).not.toContain("emerald");
        expect(amount.className).not.toContain("rose");
      }
    });

    it("1取引を1カードにし、残高記録は面を持たない従属行にする", () => {
      render(root);

      expect(root.querySelector(".log .log-row")!.className).toContain("rounded-[12px]");
      expect(root.querySelector(".log .snapshot-row")!.className).not.toContain("rounded");
    });

    describe("フィルタ", () => {
      it("「振替」は振替だけを表示し、記録行も隠す", () => {
        render(root);

        clickChip("振替");

        const rows = [...root.querySelectorAll(".log .log-row")];
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain("5,000円");
        expect(rows[1].textContent).toContain("30,000円");
        expect(root.querySelectorAll(".log .snapshot-row")).toHaveLength(0);
      });

      it("「入金」は外部入金だけを表示する", () => {
        render(root);

        clickChip("入金");

        const rows = [...root.querySelectorAll(".log .log-row")];
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain("+272,469円");
      });

      it("「出金」は外部出金だけを表示する", () => {
        render(root);

        clickChip("出金");

        const rows = [...root.querySelectorAll(".log .log-row")];
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain("-5,000円");
      });

      it("「すべて」に戻すと全件表示する", () => {
        render(root);

        clickChip("振替");
        clickChip("すべて");

        expect(root.querySelectorAll(".log .log-row")).toHaveLength(4);
        expect(root.querySelectorAll(".log .snapshot-row")).toHaveLength(2);
      });

      it("口座チップで絞り込むと関わる行だけを表示する", () => {
        render(root);

        clickAccountChip("02: 積立");

        // 積立が関わる振替2件と積立の外部出金1件。記録行は隠す
        const rows = [...root.querySelectorAll(".log .log-row")];
        expect(rows).toHaveLength(3);
        expect(root.querySelectorAll(".log .snapshot-row")).toHaveLength(0);
      });

      it("同じ口座チップをもう一度押すと絞り込みを解除する", () => {
        render(root);

        clickAccountChip("02: 積立");
        clickAccountChip("02: 積立");

        expect(root.querySelectorAll(".log .log-row")).toHaveLength(4);
      });

      it("該当がなければ空状態を表示する", () => {
        render(root, data({ transfers: [] }));

        clickChip("振替");

        expect(root.querySelector(".log .empty")!.textContent).toContain("まだ記録がありません");
      });

      it("フィルタを切り替えてもフォーカスは選んだチップに残る", () => {
        render(root);

        const chip = [...root.querySelectorAll<HTMLButtonElement>(".log-filters button")].find(
          (candidate) => candidate.textContent === "振替",
        )!;
        chip.focus();
        chip.click();

        expect((document.activeElement as HTMLElement).textContent).toBe("振替");
      });
    });

    describe("メモ", () => {
      it("保存済みのメモを2段目の本文として出す(入力欄は出さない)", () => {
        const key = `transfer:${transfers[0].transferredAt}`;

        render(root, data({ comments: { [key]: { text: "積立へ移動", updatedAt: 1 } } }));

        clickChip("振替");
        const row = root.querySelector(".log .log-row")!;
        expect(row.querySelector(".memo")!.textContent).toBe("積立へ移動");
        expect(row.querySelector<HTMLInputElement>("input.comment")!.classList).toContain("hidden");
      });

      it("メモがなければ書き込める場所だと分かる誘い文を出す", () => {
        render(root);

        clickChip("振替");
        expect(root.querySelector(".log .memo-add")!.textContent).toBe("メモを追加");
      });

      it("行をタップするとメモが入力欄に入れ替わる", () => {
        render(root);

        const row = root.querySelector<HTMLElement>(".log .log-row")!;
        const input = row.querySelector<HTMLInputElement>("input.comment")!;
        expect(input.classList).toContain("hidden");

        row.querySelector<HTMLElement>(".log-title")!.click();

        expect(input.classList).not.toContain("hidden");
        expect(row.querySelector(".memo")!.firstElementChild!.classList).toContain("hidden");
      });

      it("振替のコメントを編集するとキー付きで通知する", () => {
        const { onCommentChange } = render(root);

        clickChip("振替");
        const input = root.querySelector<HTMLInputElement>(".log input.comment")!;
        input.value = "定期積立";
        input.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onCommentChange).toHaveBeenCalledWith(
          `transfer:${transfers[0].transferredAt}`,
          "定期積立",
        );
      });

      it("外部入出金のコメントも編集できる", () => {
        const { onCommentChange } = render(root);

        clickChip("入金");
        const input = root.querySelector<HTMLInputElement>(".log input.comment")!;
        input.value = "給料";
        input.dispatchEvent(new Event("change", { bubbles: true }));

        expect(onCommentChange).toHaveBeenCalledWith(expect.stringMatching(/^change:/u), "給料");
      });

      it("入力欄のタップでは編集の開始を繰り返さない", () => {
        render(root);

        const row = root.querySelector<HTMLElement>(".log .log-row")!;
        row.querySelector<HTMLInputElement>("input.comment")!.click();

        expect(row.querySelector<HTMLInputElement>("input.comment")!.classList).toContain("hidden");
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
        expect(options.map((option) => option.getAttribute("value"))).toStrictEqual([
          "家賃",
          "給料",
        ]);
      });

      it("コメントがなければ候補も空にする", () => {
        render(root);

        const input = root.querySelector<HTMLInputElement>("input.comment")!;
        const listId = input.getAttribute("list")!;
        expect(root.querySelectorAll(`#${listId} option`)).toHaveLength(0);
      });

      it("フィルタを切り替えてもコメントは保持して表示する", () => {
        const key = `transfer:${transfers[0].transferredAt}`;

        render(root, data({ comments: { [key]: { text: "積立へ移動", updatedAt: 1 } } }));
        clickChip("振替");
        clickChip("すべて");
        clickChip("振替");

        const input = root.querySelector<HTMLInputElement>(".log input.comment")!;
        expect(input.value).toBe("積立へ移動");
      });
    });

    describe("スワイプ削除 (モバイル)", () => {
      function transferRow(): HTMLElement {
        // 振替行だけがスワイプ削除できる(先頭2行は外部入出金)
        return [...root.querySelectorAll<HTMLElement>(".log .log-row")].find(
          (row) => row.querySelector(".swipe-delete") !== null,
        )!;
      }

      it("左に大きくスワイプすると削除パネルの分だけ行が滑る", () => {
        render(root);
        const row = transferRow();

        swipe(row, -80);

        expect(row.querySelector<HTMLElement>(".swipe-slider")!.style.transform).toBe(
          "translateX(-72px)",
        );
      });

      it("スワイプ量が小さければ元の位置に戻る", () => {
        render(root);
        const row = transferRow();

        swipe(row, -20);

        expect(row.querySelector<HTMLElement>(".swipe-slider")!.style.transform).toBe(
          "translateX(0px)",
        );
      });

      it("縦方向の動きが主ならスクロールを優先して滑らせない", () => {
        render(root);
        const row = transferRow();

        swipe(row, -80, 200);

        expect(row.querySelector<HTMLElement>(".swipe-slider")!.style.transform).not.toBe(
          "translateX(-72px)",
        );
      });

      it("削除パネルをタップし確認するとハンドラへ振替を渡す", () => {
        vi.spyOn(globalThis, "confirm").mockReturnValue(true);
        const { onDeleteTransfer } = render(root);
        const row = transferRow();

        swipe(row, -80);
        row.querySelector<HTMLButtonElement>("button.swipe-delete")!.click();

        expect(onDeleteTransfer).toHaveBeenCalledWith(transfers[0]);
      });

      it("開いた状態の行タップはパネルを閉じるだけでメモの編集を開かない", () => {
        render(root);
        const row = transferRow();

        swipe(row, -80);
        row.querySelector<HTMLElement>(".log-title")!.click();

        expect(row.querySelector<HTMLElement>(".swipe-slider")!.style.transform).toBe(
          "translateX(0px)",
        );
        expect(row.querySelector<HTMLInputElement>("input.comment")!.classList).toContain("hidden");
      });

      it("外部入出金と残高記録の行にはスワイプ削除を付けない", () => {
        render(root);

        expect(root.querySelectorAll(".log .swipe-delete")).toHaveLength(2);
      });
    });

    describe("振替の削除", () => {
      it("削除ボタンを押し確認するとハンドラへ振替を渡す", () => {
        vi.spyOn(globalThis, "confirm").mockReturnValue(true);
        const { onDeleteTransfer } = render(root);

        root.querySelector<HTMLButtonElement>(".log button.delete-transfer")!.click();

        // 削除ボタンは振替行にだけ付くので、先頭は新しい方の振替のもの
        expect(onDeleteTransfer).toHaveBeenCalledWith(transfers[0]);
      });

      it("確認ダイアログをキャンセルしたら削除しない", () => {
        vi.spyOn(globalThis, "confirm").mockReturnValue(false);
        const { onDeleteTransfer } = render(root);

        root.querySelector<HTMLButtonElement>(".log button.delete-transfer")!.click();

        expect(onDeleteTransfer).not.toHaveBeenCalled();
      });

      it("外部入出金と残高記録には削除ボタンを付けない", () => {
        render(root);

        expect(root.querySelectorAll(".log button.delete-transfer")).toHaveLength(2);
      });
    });
  });

  describe("残高ページ · 口座カード", () => {
    function card(name: string): HTMLElement {
      return [...root.querySelectorAll<HTMLElement>(".accounts .workspace-card")].find(
        (candidate) => candidate.querySelector(".workspace-name")!.textContent!.includes(name),
      )!;
    }

    it("口座ごとのカードに残高・変動・振替・外部入出金のKPIを表示する", () => {
      render(root);
      clickTab("残高");

      const cards = root.querySelectorAll(".accounts .workspace-card");
      expect(cards).toHaveLength(3);

      const wallet = card("01: お財布");
      // 残高 129,392円、期間内変動 -5,000円(振替 -5,000円、外部 ±0円)
      expect(wallet.querySelector(".kpi-balance")!.textContent).toContain("129,392円");
      expect(wallet.querySelector(".kpi-delta")!.textContent).toContain("-5,000円");
      expect(wallet.querySelector(".kpi-transfer")!.textContent).toContain("-5,000円");
      expect(wallet.querySelector(".kpi-external")!.textContent).toContain("±0円");
    });

    it("合計に占める割合をバーで示す(スパークラインは推移パネルに一本化)", () => {
      render(root);
      clickTab("残高");

      const payments = [...root.querySelectorAll(".workspace-card")].find((node) =>
        node.textContent?.includes("03: 支払い箱"),
      )!;
      expect(payments.querySelector(".share-value")!.textContent).toBe("56.3%");
      expect(payments.querySelector("svg.workspace-sparkline")).toBeNull();
    });

    it("期間で絞り込むとサマリーも追随する", () => {
      render(root);
      clickTab("残高");

      const input = root.querySelector<HTMLInputElement>('input[name="period-to"]')!;
      input.value = "2026-07-09";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(root.querySelectorAll(".accounts .workspace-card")).toHaveLength(2);
      expect(card("01: お財布").querySelector(".kpi-balance")!.textContent).toContain("134,392円");
    });

    it("期間内にスナップショットがなければ空状態を表示する", () => {
      render(root, data({ snapshots: [] }));
      clickTab("残高");

      expect(root.querySelector(".accounts .empty")).not.toBeNull();
    });
  });

  describe("残高ページ · 推移", () => {
    it("推移パネルに折れ線と出入りの目盛りを描く", () => {
      render(root);
      clickTab("残高");

      const chart = root.querySelector(".history svg.balance-chart");
      expect(chart).not.toBeNull();
      // 最新の合計 129,392 + 82,520 + 272,469 = 484,381円 が終端ラベルに出る
      expect(chart!.textContent).toContain("484,381円");
    });

    it("記録が1件なら推移を描かない", () => {
      render(root, data({ snapshots: [snapshots[0]], transfers: [] }));
      clickTab("残高");

      expect(root.querySelector(".history svg.balance-chart")).toBeNull();
    });

    it("スナップショットを新しい順に前回比付きで一覧する", () => {
      render(root);
      clickTab("残高");

      const items = [...root.querySelectorAll(".snapshots .snapshot-item")];
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain(shortDateTime(snapshots[1].takenAt));
      expect(items[0].querySelector(".snapshot-total")!.textContent).toBe("484,381円");
      expect(items[0].querySelector(".snapshot-diff")!.textContent).toBe("+267,469円");
      // 最古の行は比べる相手がないので前回比を出さない
      expect([
        items[1].querySelector(".snapshot-total")!.textContent,
        items[1].querySelector(".snapshot-diff"),
      ]).toStrictEqual(["216,912円", null]);
    });

    it("行を開くと口座ごとの内訳を表示する", () => {
      render(root);
      clickTab("残高");

      const detail = root.querySelector(".snapshots .snapshot-item .snapshot-detail")!;
      expect(detail.textContent).toContain("01: お財布");
      expect(detail.textContent).toContain("129,392円");
      expect(detail.textContent).toContain("03: 支払い箱");
      expect(detail.textContent).toContain("272,469円");
    });

    it("期間で絞り込むと一覧も追随する", () => {
      render(root);
      clickTab("残高");

      const input = root.querySelector<HTMLInputElement>('input[name="period-to"]')!;
      input.value = "2026-07-09";
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(root.querySelectorAll(".snapshots .snapshot-item")).toHaveLength(1);
    });
  });

  describe("推移とログの連動", () => {
    function pickPoints(count: number): void {
      const hits = [...root.querySelectorAll<SVGElement>(".history .chart-hit")];
      for (const hit of hits.slice(0, count)) {
        hit.dispatchEvent(new Event("click", { bubbles: true }));
      }
    }

    it("点を2つ選ぶと区間になり、増減を出す", () => {
      render(root);
      clickTab("残高");

      pickPoints(2);

      expect(root.querySelector(".history .chart-span")).not.toBeNull();
      expect(root.querySelector(".span-total")!.textContent).toContain("この区間");
    });

    it("選ぶ前は選び方を案内する", () => {
      render(root);
      clickTab("残高");

      expect(root.querySelector(".span-summary")!.textContent).toContain("点を2つ選ぶ");
    });

    it("「この区間をログで見る」でログへ移り、区間チップを出す", () => {
      render(root);
      clickTab("残高");
      pickPoints(2);

      root.querySelector<HTMLButtonElement>(".span-open")!.click();

      expect(root.querySelector(".log")).not.toBeNull();
      expect(root.querySelector(".span-chip")!.textContent).toContain("区間で絞り込み中");
    });

    it("区間チップの×で絞り込みを解除する", () => {
      render(root);
      clickTab("残高");
      pickPoints(2);
      root.querySelector<HTMLButtonElement>(".span-open")!.click();

      root.querySelector<HTMLButtonElement>(".span-clear")!.click();

      expect(root.querySelector(".span-chip")).toBeNull();
    });

    it("区間チップ本体を押すと残高ページへ戻る", () => {
      render(root);
      clickTab("残高");
      pickPoints(2);
      root.querySelector<HTMLButtonElement>(".span-open")!.click();

      root.querySelector<HTMLButtonElement>(".span-back")!.click();

      expect(root.querySelector(".history")).not.toBeNull();
    });

    it("区間の外の記録はログに出さない", () => {
      render(root);
      clickTab("残高");
      // 1点だけ選ぶと、その1点だけの区間になる
      pickPoints(1);
      const before = root.querySelectorAll(".log .log-row").length;
      root.querySelector<HTMLButtonElement>(".view-tab")!.click();

      expect(root.querySelectorAll(".log .log-row").length).toBeLessThan(before + 4);
    });
  });

  describe("期間フィルタ", () => {
    function setPeriod(name: "period-from" | "period-to", value: string): void {
      const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setMonth(value: string): void {
      const input = root.querySelector<HTMLInputElement>('input[name="period-month"]')!;
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    it("詳細指定は開閉できる", () => {
      render(root);

      expect(root.querySelector(".period-detail")!.classList.contains("hidden")).toBe(true);

      root.querySelector<HTMLButtonElement>(".period-detail-toggle")!.click();

      expect(root.querySelector(".period-detail")!.classList.contains("hidden")).toBe(false);
    });

    it("開始日以降だけに絞り込む", () => {
      render(root);

      setPeriod("period-from", "2026-07-10");

      // 7/8の振替30,000円は範囲外
      const rows = [...root.querySelectorAll(".log .log-row")];
      expect(rows).toHaveLength(3);
      expect(root.textContent).not.toContain("30,000円");
    });

    it("終了日までに絞り込む", () => {
      render(root);

      setPeriod("period-to", "2026-07-09");

      // 残るのは7/8の振替と7/9の記録だけ
      const rows = [...root.querySelectorAll(".log .log-row")];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("30,000円");
      expect(root.querySelectorAll(".log .snapshot-row")).toHaveLength(1);
    });

    it("期間をクリアすると全件に戻る", () => {
      render(root);
      setPeriod("period-from", "2026-07-10");

      root.querySelector<HTMLButtonElement>(".period .period-clear")!.click();

      expect(root.querySelectorAll(".log .log-row")).toHaveLength(4);
    });

    it("月を選択するとその月の記録だけ表示する", () => {
      render(root);

      setMonth("2026-07");
      expect(root.querySelectorAll(".log .log-row")).toHaveLength(4);

      setMonth("2026-06");
      expect(root.querySelectorAll(".log .log-row")).toHaveLength(0);
      expect(root.querySelector(".log")!.textContent).toContain("まだ記録がありません");
    });

    it("前の月・次の月ボタンで月を移動する", () => {
      render(root);
      setMonth("2026-07");

      root.querySelector<HTMLButtonElement>(".period .month-next")!.click();

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe(
        "2026-08",
      );
      expect(root.querySelectorAll(".log .log-row")).toHaveLength(0);

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

    it("月送りボタンで再描画してもフォーカスを保つ", () => {
      render(root);

      const prev = root.querySelector<HTMLButtonElement>(".month-prev")!;
      prev.focus();
      prev.click();

      expect((document.activeElement as HTMLElement).classList.contains("month-prev")).toBe(true);
    });

    it("日付を指定すると月の選択は解除する", () => {
      render(root);
      setMonth("2026-06");

      setPeriod("period-from", "2026-07-10");

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe("");
      expect(root.querySelectorAll(".log .log-row")).toHaveLength(3);
    });

    it("月を選択すると日付の指定は解除する", () => {
      render(root);
      setPeriod("period-from", "2026-07-10");

      setMonth("2026-07");

      expect(root.querySelector<HTMLInputElement>('input[name="period-from"]')!.value).toBe("");
      expect(root.querySelectorAll(".log .log-row")).toHaveLength(4);
    });

    it("クリアで月も日付も解除する", () => {
      render(root);
      setMonth("2026-06");

      root.querySelector<HTMLButtonElement>(".period .period-clear")!.click();

      expect(root.querySelector<HTMLInputElement>('input[name="period-month"]')!.value).toBe("");
      expect(root.querySelectorAll(".log .log-row")).toHaveLength(4);
    });

    it("期間を変えてもタブとフィルタの選択は保持する", () => {
      render(root);
      clickChip("振替");

      setPeriod("period-from", "2026-07-01");

      expect(root.querySelector(".log-filters .active")!.textContent).toBe("振替");
      expect(root.querySelector(".view-tab.active")!.textContent).toBe("ログ");
    });
  });

  describe("記録の鮮度", () => {
    // 最新の記録は2つ目のスナップショット (7/10 13:34 UTC)
    const latestAt = Date.UTC(2026, 6, 10, 13, 34);
    const DAY = 24 * 60 * 60 * 1000;
    const config = {
      accountId: "abc",
      bucket: "b",
      objectKey: "k.json",
      accessKeyId: "ak",
      secretAccessKey: "sk",
    };

    it("最終記録の時刻をヘッダーに表示する", () => {
      render(root, data(), () => latestAt + DAY);

      expect(root.querySelector(".freshness .latest-record")!.textContent).toBe(
        `最終記録 ${shortDateTime(latestAt)}`,
      );
    });

    it("7日以上記録が増えていなければ警告する", () => {
      render(root, data(), () => latestAt + 8 * DAY);

      expect(root.querySelector(".freshness .stale-warning")).not.toBeNull();
      expect(root.querySelector(".freshness .latest-record")).toBeNull();
    });

    it("記録が新しければ警告しない", () => {
      render(root, data(), () => latestAt + DAY);

      expect(root.querySelector(".freshness .stale-warning")).toBeNull();
    });

    it("同期設定があれば最終同期時刻を表示する", () => {
      const syncedAt = latestAt + DAY;
      render(root, data({ syncConfig: config, lastSyncedAt: syncedAt }), () => syncedAt);

      expect(root.querySelector(".freshness .last-synced")!.textContent).toBe(
        `同期済 ${shortDateTime(syncedAt)}`,
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

  describe("設定画面 (R2同期)", () => {
    const savedConfig = {
      accountId: "abc123",
      bucket: "aozora",
      objectKey: "aozora-history.json",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    };

    function openSettings(): void {
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
      expect(root.querySelector(".dashboard-header")).toBeNull();
      expect(syncInput("sync-account-id").value).toBe("abc123");
      expect(syncInput("sync-secret").type).toBe("password");
    });

    it("戻るボタンでダッシュボードに戻る", () => {
      render(root);
      openSettings();

      root.querySelector<HTMLButtonElement>("button.back-button")!.click();

      expect(root.querySelector(".settings-view")).toBeNull();
      expect(root.querySelector(".dashboard-header")).not.toBeNull();
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

      expect(onSyncNow).toHaveBeenCalledWith();
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
      const exported = JSON.parse(decodeURIComponent(link.href.slice(prefix.length)));
      expect(exported).toStrictEqual(savedConfig);
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
    function openSettings(): void {
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
      expect(json).toStrictEqual({ snapshots, transfers, statements: [], comments, deletions });
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
    const evilTransfer: TransferRecord = {
      transferredAt: 2,
      from: { id: "1", name: "<img src=x onerror=alert(1)>" },
      to: { id: "2", name: "<b>B</b>" },
      amount: 1,
    };

    render(root, data({ snapshots: [malicious], transfers: [evilTransfer] }));

    expect(root.querySelector("img")).toBeNull();
  });

  it("再描画すると前の内容を置き換える", () => {
    render(root);
    render(root);

    expect(root.querySelectorAll(".dashboard-header")).toHaveLength(1);
  });

  describe("再描画関数", () => {
    it("選択中のフィルタを保ったまま最新のデータを表示する", () => {
      const dashboardData = data();
      const { redraw } = render(root, dashboardData);
      clickChip("振替");

      // 開いている間に別の場所(銀行サイトのタブや自動同期)で振替が増えた
      dashboardData.transfers = [
        ...transfers,
        {
          transferredAt: Date.UTC(2026, 6, 10, 14, 0),
          from: { id: "133331", name: "01: お財布" },
          to: { id: "133805", name: "03: 支払い箱" },
          amount: 700,
        },
      ];
      redraw();

      expect(root.querySelector(".log-filters .active")!.textContent).toBe("振替");
      expect(root.querySelector(".log")!.textContent).toContain("700円");
    });
  });
});

const statements: StatementEntry[] = [
  {
    entryNumber: "0001",
    valueDate: "2026-07-23",
    amount: -4100,
    balance: 445_281,
    remark: "振込 ミツビシユーエフジエイ",
  },
  {
    entryNumber: "0001",
    valueDate: "2026-07-24",
    amount: 635_144,
    balance: 1_080_425,
    remark: "給与  カ）アツトマーク",
  },
  {
    entryNumber: "0002",
    valueDate: "2026-07-24",
    amount: -173_000,
    balance: 907_425,
    remark: "振込 ラクテン",
  },
];

describe("代表口座の明細をログに統合する", () => {
  const root = document.createElement("div");

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  function open(): void {
    render(root, data({ statements }), () => Date.UTC(2026, 6, 27, 0, 0));
  }

  function titles(): string[] {
    return [...root.querySelectorAll(".log .log-title")].map((node) => node.textContent ?? "");
  }

  function clickChip(label: string): void {
    [...root.querySelectorAll<HTMLButtonElement>(".log-filters button")]
      .find((chip) => chip.textContent === label)!
      .click();
  }

  it("振替と同じ時系列に並べる(別タブに分けない)", () => {
    open();

    expect(titles()).toContain("給与  カ）アツトマーク → 普通預金");
    expect(titles()).toContain("普通預金 → 振込 ラクテン");
    expect(root.querySelector(".statements")).toBeNull();
  });

  it("代表口座は口座色を割り当てず灰色で示す", () => {
    open();

    const row = [...root.querySelectorAll(".log .log-row")].find((node) =>
      node.textContent?.includes("給与"),
    )!;
    expect(row.querySelector(".dot")!.className).toContain("bg-[#94a3b8]");
  });

  it("その日の合計に明細の出入りを含める", () => {
    open();

    // 7/24 は 給与 +635,144 と 振込 −173,000
    const heading = [...root.querySelectorAll(".log .day-heading")].find((node) =>
      node.textContent?.includes("7月24日"),
    )!;
    expect(heading.querySelector(".day-total")!.textContent).toBe("+462,144円");
  });

  it("入金・出金の絞り込みが明細にも効く", () => {
    open();
    clickChip("入金");

    expect(titles()).toContain("給与  カ）アツトマーク → 普通預金");
    expect(titles()).not.toContain("普通預金 → 振込 ラクテン");
  });

  it("振替で絞ると明細は出さない(口座間の移動ではない)", () => {
    open();
    clickChip("振替");

    expect(titles().some((title) => title.includes("普通預金"))).toBe(false);
  });

  it("摘要が空でも行として読める", () => {
    render(root, data({ statements: [{ ...statements[0], remark: "" }] }), () =>
      Date.UTC(2026, 6, 27, 0, 0),
    );

    expect(titles()).toContain("普通預金 → (摘要なし)");
  });

  it("明細にもメモを付けられる", () => {
    const { onCommentChange } = render(root, data({ statements }), () =>
      Date.UTC(2026, 6, 27, 0, 0),
    );

    const row = [...root.querySelectorAll<HTMLElement>(".log .log-row")].find((node) =>
      node.textContent?.includes("給与"),
    )!;
    const input = row.querySelector<HTMLInputElement>("input.comment")!;
    input.value = "月給";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onCommentChange).toHaveBeenCalledWith("statement:2026-07-24:0001", "月給");
  });
});

describe("記録にない口座間の移動(定額自動振替など)", () => {
  const root = document.createElement("div");

  // 定額自動振替: 01: お財布 → 03: 支払い箱 に 80,000円。
  // 振替ページを経由しないため、拡張には残高の変化しか見えない
  const autoTransferSnapshots: BalanceSnapshot[] = [
    {
      takenAt: Date.UTC(2026, 6, 25, 13, 0),
      updatedAt: null,
      accounts: [
        { id: "133331", name: "01: お財布", balance: 500_000 },
        { id: "133805", name: "03: 支払い箱", balance: 10_000 },
      ],
    },
    {
      takenAt: Date.UTC(2026, 6, 26, 13, 0),
      updatedAt: null,
      accounts: [
        { id: "133331", name: "01: お財布", balance: 420_000 },
        { id: "133805", name: "03: 支払い箱", balance: 90_000 },
      ],
    },
  ];

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
    render(root, data({ snapshots: autoTransferSnapshots, transfers: [], statements: [] }));
  });

  function logTitles(): string[] {
    return [...root.querySelectorAll(".log-title")].map((title) => title.textContent ?? "");
  }

  function clickAccountsTab(): void {
    [...root.querySelectorAll<HTMLButtonElement>(".view-tab")]
      .find((tab) => tab.textContent === "残高")!
      .click();
  }

  function externalKpis(): string[] {
    return [...root.querySelectorAll(".kpi-external")].map(
      (kpi) => kpi.lastElementChild?.textContent ?? "",
    );
  }

  it("打ち消し合う増減を1件の振替として表示する", () => {
    expect(logTitles()).toStrictEqual(["01: お財布 → 03: 支払い箱自動"]);
  });

  it("定額自動振替の設定と一致すれば、何の移動かを言い切る", () => {
    render(
      root,
      data({
        snapshots: autoTransferSnapshots,
        transfers: [],
        statements: [],
        autoTransfers: [
          {
            id: "9001",
            from: { id: "133331", name: "01: お財布" },
            to: { id: "133805", name: "03: 支払い箱" },
            amount: 80_000,
          },
        ],
      }),
    );

    expect(root.querySelector(".detected-badge")!.textContent).toBe("定額自動振替");
  });

  it("つかいわけ口座の明細があれば、外部への出金の相手を摘要で出す", () => {
    // 支払い箱からの自動引落。相手になる口座がないので振替にはならない
    const withDebit: BalanceSnapshot[] = [
      autoTransferSnapshots[1],
      {
        ...autoTransferSnapshots[1],
        takenAt: Date.UTC(2026, 6, 26, 14, 0),
        accounts: [
          { id: "133331", name: "01: お財布", balance: 420_000 },
          { id: "133805", name: "03: 支払い箱", balance: 40_000 },
        ],
      },
    ];

    render(
      root,
      data({
        snapshots: withDebit,
        transfers: [],
        statements: [
          {
            entryNumber: "0001",
            valueDate: "2026-07-26",
            amount: -50_000,
            balance: 40_000,
            remark: "カ）ジェーシービー",
            accountId: "133805",
          },
        ],
      }),
    );

    expect(logTitles()).toContain("03: 支払い箱 → カ）ジェーシービー");
  });

  it("起算日がスナップショットの前日でも突き合わせる(深夜の入金など)", () => {
    const withDebit: BalanceSnapshot[] = [
      autoTransferSnapshots[1],
      {
        ...autoTransferSnapshots[1],
        takenAt: Date.UTC(2026, 6, 26, 16, 6),
        accounts: [
          { id: "133331", name: "01: お財布", balance: 420_000 },
          { id: "133805", name: "03: 支払い箱", balance: 40_000 },
        ],
      },
    ];

    render(
      root,
      data({
        snapshots: withDebit,
        transfers: [],
        statements: [
          {
            entryNumber: "0001",
            // 区間の始まり(7/26 22:00 JST)より前の日付だが、同じ暦日なので拾う
            valueDate: "2026-07-26",
            amount: -50_000,
            balance: 40_000,
            remark: "カ）ジェーシービー",
            accountId: "133805",
          },
        ],
      }),
    );

    expect(logTitles()).toContain("03: 支払い箱 → カ）ジェーシービー");
  });

  it("外部入出金には数えない(口座間で動いただけなので収支は増減しない)", () => {
    clickAccountsTab();

    expect(externalKpis()).toStrictEqual(["±0円", "±0円"]);
  });

  it("記録ではないため削除できない", () => {
    expect(root.querySelector(".delete-transfer")).toBeNull();
  });
});

describe("statementsCsv", () => {
  it("ヘッダー付きで明細を新しい順にCSV化する(Excel向けBOM付き)", () => {
    const csv = statementsCsv(statements, {
      "statement:2026-07-24:0001": { text: "月給", updatedAt: 1 },
    });

    expect(csv).toBe(
      "﻿日付,摘要,金額,残高,コメント\r\n" +
        "2026-07-24,振込 ラクテン,-173000,907425,\r\n" +
        "2026-07-24,給与  カ）アツトマーク,635144,1080425,月給\r\n" +
        "2026-07-23,振込 ミツビシユーエフジエイ,-4100,445281,\r\n",
    );
  });
});

describe("狭い幅 (スマホ)", () => {
  const root = document.createElement("div");

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
    render(root, data({ statements }), () => Date.UTC(2026, 6, 27, 0, 0));
  });

  function bottomTab(label: string): HTMLButtonElement {
    return [...root.querySelectorAll<HTMLButtonElement>(".bottom-tab")].find(
      (tab) => tab.textContent === label,
    )!;
  }

  it("ページ切り替えを下部バーに置く(親指の届く位置に主要な操作を集める)", () => {
    expect([...root.querySelectorAll(".bottom-tab")].map((tab) => tab.textContent)).toStrictEqual([
      "ログ",
      "残高",
      "設定",
    ]);
  });

  it("下部バーから残高ページへ移れる", () => {
    bottomTab("残高").click();

    expect(root.querySelector(".accounts")).not.toBeNull();
  });

  it("下部バーから設定へ移れる(ヘッダーの歯車は狭い幅では隠す)", () => {
    bottomTab("設定").click();

    expect(root.querySelector(".settings-view")).not.toBeNull();
    expect(root.querySelector(".bottom-tab.active")!.textContent).toBe("設定");
  });

  it("ヘッダーのタブと歯車は狭い幅で隠す(下部バーと二重にしない)", () => {
    expect(root.querySelector(".view-tabs")!.className).toContain("max-sm:hidden");
    expect(root.querySelector(".settings-button")!.className).toContain("max-sm:hidden");
  });

  it("時刻を左の固定列から2段目へ回し、口座名に幅を空ける", () => {
    const row = root.querySelector(".log .log-row")!;
    expect(row.querySelector(".time")!.className).toContain("max-sm:hidden");
    expect(row.querySelector(".time-inline")!.className).toContain("sm:hidden");
  });

  it("口座カードのKPIは畳む(残高・増減・構成比まで読めれば足りる)", () => {
    bottomTab("残高").click();

    expect(root.querySelector(".workspace-card .kpis")!.className).toContain("max-sm:hidden");
    expect(root.querySelector(".workspace-card .share")).not.toBeNull();
  });
});

describe("設定画面 (整理)", () => {
  const root = document.createElement("div");

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  function openSettings(config: SyncConfig | null = null): void {
    render(root, data({ syncConfig: config, statements }));
    root.querySelector<HTMLButtonElement>("button.settings-button")!.click();
  }

  const savedConfig: SyncConfig = {
    accountId: "abc123",
    bucket: "aozora",
    objectKey: "aozora-history.json",
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
  };

  it("接続の状態と記録の時刻を同期カードの先頭に出す", () => {
    openSettings(savedConfig);

    expect(root.querySelector(".sync-state")!.textContent).toContain("接続済み");
    expect(root.querySelector(".record-state")!.textContent).toContain("最終記録");
  });

  it("未接続ならその旨を出す", () => {
    openSettings();

    expect(root.querySelector(".sync-state")!.textContent).toContain("未接続");
  });

  it("接続設定は既定で畳む(接続済みなら普段触らない)", () => {
    openSettings(savedConfig);

    const details = root.querySelector<HTMLDetailsElement>("details.sync-connection")!;
    expect(details.open).toBe(false);
    expect(details.querySelector('input[name="sync-account-id"]')).not.toBeNull();
  });

  it("書き出しは3つのボタンにする", () => {
    openSettings();

    expect(
      [".export", ".export-csv", ".export-statement-csv"].map(
        (marker) => root.querySelector(marker)!.textContent,
      ),
    ).toStrictEqual(["JSON(全記録)", "振替CSV", "明細CSV"]);
  });

  it("読み込みは面で受け、生のファイル入力は隠す", () => {
    openSettings();

    const row = root.querySelector(".import-row")!;
    expect(row.textContent).toContain("ドロップ");
    expect(row.querySelector('input[name="import-file"]')!.className).toContain("sr-only");
  });

  it("保存されている記録の件数を出す(書き出す前に量が分かる)", () => {
    openSettings();

    expect(root.querySelector(".record-counts")!.textContent).toBe(
      "保存されている記録 / 振替 2件 · 明細 3件 · スナップショット 2件",
    );
  });
});

describe("設定画面 (デバッグ)", () => {
  const root = document.createElement("div");

  const report = {
    at: Date.UTC(2026, 6, 26, 6, 41),
    build: "2026-07-26 15:30:00",
    skipped: false,
    balances: { count: 3, saved: false },
    statements: { count: 100, saved: true },
    accountStatements: { count: null, saved: false },
    autoTransfers: { count: 1, saved: true },
    errors: [],
  };

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  function openSettings(): void {
    root.querySelector<HTMLButtonElement>("button.settings-button")!.click();
  }

  function statTexts(): string[] {
    return [...root.querySelectorAll(".collect-stat")].map((row) => row.textContent ?? "");
  }

  it("既定では取り込みの詳細を出さない", () => {
    render(root, data({ debugMode: false, lastCollect: report }));
    openSettings();

    expect(root.querySelector(".debug-toggle")).not.toBeNull();
    expect(root.querySelector(".last-collect")).toBeNull();
  });

  it("有効にすると、APIごとに取れた件数と記録の更新有無を出す", () => {
    render(root, data({ debugMode: true, lastCollect: report }));
    openSettings();

    expect(statTexts()).toStrictEqual([
      "つかいわけ口座の残高3件 · 変化なし",
      "代表口座の明細100件 · 記録を更新",
      "つかいわけ口座の明細取得できず",
      "定額自動振替の設定1件 · 記録を更新",
    ]);
  });

  it("エラーはstackごとそのまま出す", () => {
    const stack = "GET balances/sp-accounts が HTTP 403\n    at get (content.js:812:15)";
    render(root, data({ debugMode: true, lastCollect: { ...report, errors: [stack] } }));
    openSettings();

    expect(root.querySelector(".collect-error")!.textContent).toBe(stack);
  });

  it("どのビルドが取り込んだのかを出す(入れ替えたつもりの取り違えを防ぐ)", () => {
    render(root, data({ debugMode: true, lastCollect: report }));
    openSettings();

    expect(root.querySelector(".build-stamp")!.textContent).toContain(
      "取り込み 2026-07-26 15:30:00",
    );
  });

  it("見送った回はその旨だけ出す", () => {
    render(root, data({ debugMode: true, lastCollect: { ...report, skipped: true } }));
    openSettings();

    expect(root.querySelector(".last-collect")!.textContent).toContain("間隔が空いていない");
    expect(statTexts()).toStrictEqual([]);
  });

  it("一度も走っていなければ、その旨を出す", () => {
    render(root, data({ debugMode: true, lastCollect: null }));
    openSettings();

    expect(root.querySelector(".last-collect")!.textContent).toContain(
      "まだ取り込みが走っていません",
    );
  });

  it("トグルの切り替えを通知する", () => {
    const { onToggleDebug } = render(root, data({ debugMode: false }));
    openSettings();

    root.querySelector<HTMLInputElement>('input[name="debug-mode"]')!.click();

    expect(onToggleDebug).toHaveBeenCalledWith(true);
  });

  it("「今すぐ取り込む」で取り込みを要求する", () => {
    const { onRequestCollect } = render(root, data({ debugMode: true, lastCollect: report }));
    openSettings();

    root.querySelector<HTMLButtonElement>("button.collect-now")!.click();

    expect(onRequestCollect).toHaveBeenCalledWith();
  });
});
