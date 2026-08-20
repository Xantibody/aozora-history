import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { data, render, visible } from "./render.fixture.ts";
import { usePhone, useWideScreen } from "./screen.fixture.ts";
import type { DashboardData } from "./render.ts";

// フィクスチャの振替(7/10 5,000円 と 7/8 30,000円)に付けたコメント
const comments = {
  [`transfer:${Date.UTC(2026, 6, 10, 13, 30)}`]: { text: "積立の上乗せ", updatedAt: 1 },
  [`transfer:${Date.UTC(2026, 6, 8, 0, 0)}`]: { text: "家賃", updatedAt: 1 },
};

function withComments(): DashboardData {
  return data({ comments });
}

function pressKey(target: EventTarget, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("検索パレット", () => {
  const root = document.createElement("div");

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  function searchInput(): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(".search-input")!;
  }

  function type(text: string): void {
    const input = searchInput();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("/ キーでパレットが開き、入力にフォーカスが移る", () => {
    render(root, withComments());

    pressKey(document.body, "/");

    expect(root.querySelector(".search-palette")).not.toBeNull();
    expect(document.activeElement).toBe(searchInput());
  });

  it("ヘッダーの虫めがねからも開ける", () => {
    render(root, withComments());

    root.querySelector<HTMLButtonElement>(".search-button")!.click();

    expect(root.querySelector(".search-palette")).not.toBeNull();
  });

  it("別の入力に書いている最中の / では開かない", () => {
    render(root, withComments());
    // 行をクリックしてメモの入力欄を開き、そこへフォーカスを移す
    root.querySelector<HTMLElement>(".log-row")!.click();

    pressKey(document.activeElement!, "/");

    expect(root.querySelector(".search-palette")).toBeNull();
  });

  it("Esc で閉じる", () => {
    render(root, withComments());
    pressKey(document.body, "/");

    pressKey(document.body, "Escape");

    expect(root.querySelector(".search-palette")).toBeNull();
  });

  it("入力するとコメント候補が使用回数付きで並ぶ", () => {
    render(root, withComments());
    pressKey(document.body, "/");

    type("家賃");

    const candidate = root.querySelector(".search-comment")!;
    expect(candidate.textContent).toContain("家賃");
    expect(candidate.textContent).toContain("1回");
    expect(candidate.textContent).toContain("30,000円");
  });

  it("Enter で適用するとログが絞り込まれ、解除チップが出る", () => {
    render(root, withComments());
    pressKey(document.body, "/");
    type("家賃");

    pressKey(searchInput(), "Enter");

    expect(root.querySelector(".search-palette")).toBeNull();
    expect(root.querySelector(".search-chip")!.textContent).toContain("「家賃」で絞り込み中");
    expect(root.querySelectorAll(".log-row")).toHaveLength(1);
    // 一致したメモの中の語は、面の濃淡で指し示す
    expect(root.querySelector(".log-row .search-mark")!.textContent).toBe("家賃");
  });

  it("解除チップの × で絞り込みが外れる", () => {
    render(root, withComments());
    const before = root.querySelectorAll(".log-row").length;
    pressKey(document.body, "/");
    type("家賃");
    pressKey(searchInput(), "Enter");

    root.querySelector<HTMLButtonElement>(".search-clear")!.click();

    expect(root.querySelector(".search-chip")).toBeNull();
    expect(root.querySelectorAll(".log-row")).toHaveLength(before);
  });

  it("数字を入れると揺れチップが範囲の実値付きで出る", () => {
    render(root, withComments());
    pressKey(document.body, "/");

    type("5,000円");

    const labels = [...root.querySelectorAll(".search-tier")].map((chip) => chip.textContent);
    expect(labels).toStrictEqual([
      "完全一致",
      "ほぼ同額 4,500円〜5,500円",
      "同じ桁 2,500円〜7,500円",
    ]);
  });

  it("金額で適用すると近い記録だけが残り、行に近さバッジが付く", () => {
    render(root, withComments());
    pressKey(document.body, "/");
    type("5000");

    pressKey(searchInput(), "Enter");

    expect(root.querySelector(".search-chip")!.textContent).toContain("5,000円±10%");
    // 5,000円の振替と、-5,000円の外部入出金だけが残る(30,000円は外れる)
    const rows = [...root.querySelectorAll(".log-row")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector(".nearness-badge")!.textContent).toBe("同額");
    }
  });
});

describe("検索シート (狭い幅)", () => {
  const root = document.createElement("div");

  beforeEach(async () => {
    await usePhone();
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  afterEach(useWideScreen);

  function openFromTab(): void {
    [...root.querySelectorAll<HTMLButtonElement>(".bottom-tab")]
      .find((tab) => tab.textContent === "検索")!
      .click();
  }

  function type(text: string): void {
    const input = root.querySelector<HTMLInputElement>(".search-input")!;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("下部バーの検索タブから全画面シートが開く", () => {
    render(root, withComments());

    openFromTab();

    expect(root.querySelector(".search-palette")).not.toBeNull();
    // キー操作の手引きは出さず、主ボタンと閉じるを出す
    expect(visible(root.querySelector(".search-esc")!)).toBe(false);
    expect(visible(root.querySelector(".search-close")!)).toBe(true);
    expect(visible(root.querySelector(".search-apply")!)).toBe(true);
  });

  it("主ボタンは条件を言い切り、タップで絞り込みを適用する", () => {
    render(root, withComments());
    openFromTab();
    const apply = root.querySelector<HTMLButtonElement>(".search-apply")!;
    expect(apply.disabled).toBe(true);

    type("家賃");
    expect(apply.textContent).toBe("ログを「家賃」で絞り込む");
    apply.click();

    expect(root.querySelector(".search-palette")).toBeNull();
    expect(root.querySelector(".search-chip")!.textContent).toContain("「家賃」で絞り込み中");
  });

  it("閉じるボタンでシートが閉じる", () => {
    render(root, withComments());
    openFromTab();

    root.querySelector<HTMLButtonElement>(".search-close")!.click();

    expect(root.querySelector(".search-palette")).toBeNull();
  });
});

describe("検索パレット (広い幅の見た目)", () => {
  const root = document.createElement("div");

  beforeEach(() => {
    root.replaceChildren();
    document.body.replaceChildren(root);
  });

  it("主ボタンと閉じるは出さず、キー操作の手引きを出す", () => {
    render(root, withComments());
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }),
    );

    expect(visible(root.querySelector(".search-apply")!)).toBe(false);
    expect(visible(root.querySelector(".search-close")!)).toBe(false);
    expect(visible(root.querySelector(".search-esc")!)).toBe(true);
  });
});
