// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupContentScript } from "./content-script.ts";
import { HistoryStore } from "./infrastructure/storage.ts";
import type { StorageArea } from "./infrastructure/storage.ts";

function fakeStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.has(key) ? { [key]: data.get(key) } : {}),
    set: (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      return Promise.resolve();
    },
  };
}

const accountsHtml = `
<div class="account-block">
  <div class="account-info">
    <a href="https://bank.gmo-aozora.com/bank/sp-account/details/133331">内訳</a>
    <div><span>01: お財布</span><span><span>129,392</span><span class="unit">円</span></span></div>
  </div>
</div>`;

const transferHtml = `
<div class="exchange-accounts">
  <div class="panel">
    <select>
      <option value="133331" selected>01: お財布</option>
      <option value="133332">02: 積立</option>
    </select>
  </div>
  <div class="panel">
    <select>
      <option value="133331">01: お財布</option>
      <option value="133332" selected>02: 積立</option>
    </select>
    <input type="text" class="num input-amount" value="5000">
  </div>
</div>
<button id="sp-account-account-to-account-confirm" type="button">確認</button>`;

// 実サイト(Vue)は確認クリックでモーダルを挿入し、確認/完了ブロックをv-showで
// 切り替える。完了文言は確認段階でも display:none のままDOMに存在する
const confirmModalHtml = `
<div class="modal">
  <div class="confirm-info panel inner-block">
    <header class="header-accent"><h4>つかいわけ口座振替　確認</h4></header>
    <div class="bottom-buttons">
      <button id="sp-account-account-to-account-back" type="button">戻る</button>
      <button id="sp-account-account-to-account-execute" type="button">実行</button>
    </div>
  </div>
  <div class="confirm-info panel inner-block" style="display: none;">
    <header class="header-accent"><h4>つかいわけ口座振替　完了</h4></header>
    <p class="panel-body">つかいわけ口座の振替が完了しました。</p>
    <div class="bottom-buttons">
      <button id="sp-account-account-to-account-close" type="button">閉じる</button>
    </div>
  </div>
</div>`;

async function openConfirmModal() {
  document.getElementById("sp-account-account-to-account-confirm")!.click();
  document.body.insertAdjacentHTML("beforeend", confirmModalHtml);
  await vi.runAllTimersAsync();
}

async function executeTransfer() {
  const [confirmStep, completeStep] =
    document.querySelectorAll<HTMLElement>(".modal .confirm-info");
  document.getElementById("sp-account-account-to-account-execute")!.click();
  confirmStep.style.display = "none";
  completeStep.style.display = "";
  await vi.runAllTimersAsync();
}

describe("setupContentScript", () => {
  let store: HistoryStore;
  let teardown: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    let tick = 0;
    store = new HistoryStore(fakeStorage(), () => ++tick);
    teardown = setupContentScript(document, store, () => 42);
  });

  afterEach(() => {
    teardown();
    vi.useRealTimers();
  });

  it("口座一覧が描画されたらスナップショットを保存する", async () => {
    document.body.innerHTML = accountsHtml;

    await vi.runAllTimersAsync();

    expect(await store.loadSnapshots()).toEqual([
      {
        takenAt: 42,
        updatedAt: null,
        accounts: [{ id: "133331", name: "01: お財布", balance: 129392 }],
      },
    ]);
  });

  it("再描画されても残高が同じなら重複保存しない", async () => {
    document.body.innerHTML = accountsHtml;
    await vi.runAllTimersAsync();

    document.body.innerHTML = "";
    await vi.runAllTimersAsync();
    document.body.innerHTML = accountsHtml;
    await vi.runAllTimersAsync();

    expect(await store.loadSnapshots()).toHaveLength(1);
  });

  it("確認モーダルが開いただけ(完了文言は非表示でDOMに存在)では記録もパネル表示もしない", async () => {
    document.body.innerHTML = transferHtml;
    await vi.runAllTimersAsync();

    await openConfirmModal();

    expect(await store.loadTransfers()).toEqual([]);
    expect(document.getElementById("aozora-history-comment")).toBeNull();
  });

  it("実行後に完了ブロックが表示されたら振替を記録する", async () => {
    document.body.innerHTML = transferHtml;
    await vi.runAllTimersAsync();

    await openConfirmModal();
    expect(await store.loadTransfers()).toEqual([]);

    await executeTransfer();

    expect(await store.loadTransfers()).toEqual([
      {
        transferredAt: 42,
        from: { id: "133331", name: "01: お財布" },
        to: { id: "133332", name: "02: 積立" },
        amount: 5000,
      },
    ]);
  });

  it("戻るでモーダルを閉じた場合は記録しない", async () => {
    document.body.innerHTML = transferHtml;
    await vi.runAllTimersAsync();

    await openConfirmModal();
    document.getElementById("sp-account-account-to-account-back")!.click();
    document.querySelector(".modal")!.remove();
    await vi.runAllTimersAsync();

    expect(await store.loadTransfers()).toEqual([]);
  });

  it("完了ブロックが表示されたままの間のDOM変化では再記録しない", async () => {
    document.body.innerHTML = transferHtml;
    await openConfirmModal();
    await executeTransfer();

    document.body.insertAdjacentHTML("beforeend", "<p>別の変化</p>");
    await vi.runAllTimersAsync();

    expect(await store.loadTransfers()).toHaveLength(1);
  });

  it("完了モーダルを閉じた後の2回目の振替も記録する", async () => {
    document.body.innerHTML = transferHtml;
    await openConfirmModal();
    await executeTransfer();

    document.getElementById("sp-account-account-to-account-close")!.click();
    document.querySelector(".modal")!.remove();
    await vi.runAllTimersAsync();

    await openConfirmModal();
    await executeTransfer();

    expect(await store.loadTransfers()).toHaveLength(2);
  });

  describe("振替直後のコメント入力", () => {
    async function confirmTransfer() {
      document.body.innerHTML = transferHtml;
      await openConfirmModal();
      await executeTransfer();
    }

    it("記録後にコメント入力パネルを表示する", async () => {
      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      expect(panel.textContent).toContain("振替を記録しました");
      expect(panel.querySelector("input")).not.toBeNull();
    });

    it("保存すると振替と同じキーでコメントを保存しパネルを閉じる", async () => {
      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      panel.querySelector("input")!.value = "家賃の移動";
      panel.querySelector<HTMLButtonElement>("button.save")!.click();
      await vi.runAllTimersAsync();

      expect(await store.loadComments()).toEqual({
        "transfer:42": { text: "家賃の移動", updatedAt: 1 },
      });
      expect(document.getElementById("aozora-history-comment")).toBeNull();
    });

    it("閉じるボタンで保存せずに閉じる", async () => {
      await confirmTransfer();

      document
        .getElementById("aozora-history-comment")!
        .querySelector<HTMLButtonElement>("button.close")!
        .click();
      await vi.runAllTimersAsync();

      expect(await store.loadComments()).toEqual({});
      expect(document.getElementById("aozora-history-comment")).toBeNull();
    });

    it("過去のコメントを入力候補として提示する", async () => {
      await store.setComment("transfer:1", "家賃");
      await store.setComment("transfer:2", "積立");

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      const input = panel.querySelector("input")!;
      const listId = input.getAttribute("list")!;
      const options = [...panel.querySelectorAll(`#${listId} option`)];
      expect(options.map((o) => o.getAttribute("value"))).toEqual(["積立", "家賃"]);
    });

    it("過去のコメントを目に見えるチップとしても表示する(datalist非対応環境向け)", async () => {
      await store.setComment("transfer:1", "家賃");
      await store.setComment("transfer:2", "積立");

      await confirmTransfer();

      const chips = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "#aozora-history-comment button.suggestion",
        ),
      ];
      expect(chips.map((c) => c.textContent)).toEqual(["積立", "家賃"]);
    });

    it("チップをタップすると入力欄に反映し、保存で永続化する", async () => {
      await store.setComment("transfer:1", "家賃");

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      panel.querySelector<HTMLButtonElement>("button.suggestion")!.click();
      expect(panel.querySelector("input")!.value).toBe("家賃");

      panel.querySelector<HTMLButtonElement>("button.save")!.click();
      await vi.runAllTimersAsync();

      expect((await store.loadComments())["transfer:42"]).toMatchObject({ text: "家賃" });
    });

    it("チップは多くても5件に絞る(候補全体はdatalistに残す)", async () => {
      for (let i = 1; i <= 7; i++) {
        await store.setComment(`transfer:${i}`, `メモ${i}`);
      }

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      expect(panel.querySelectorAll("button.suggestion")).toHaveLength(5);
      const listId = panel.querySelector("input")!.getAttribute("list")!;
      expect(panel.querySelectorAll(`#${listId} option`)).toHaveLength(7);
    });

    it("入力するとその文字を含む候補だけをチップに表示する", async () => {
      await store.setComment("transfer:1", "家賃");
      await store.setComment("transfer:2", "積立");
      await store.setComment("transfer:3", "積立NISA");

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      const input = panel.querySelector("input")!;
      input.value = "積";
      input.dispatchEvent(new Event("input"));

      const chips = [...panel.querySelectorAll<HTMLButtonElement>("button.suggestion")];
      expect(chips.map((c) => c.textContent)).toEqual(["積立NISA", "積立"]);
    });

    it("入力を空に戻すと全候補のチップに戻る", async () => {
      await store.setComment("transfer:1", "家賃");
      await store.setComment("transfer:2", "積立");

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      const input = panel.querySelector("input")!;
      input.value = "積";
      input.dispatchEvent(new Event("input"));
      input.value = "";
      input.dispatchEvent(new Event("input"));

      const chips = [...panel.querySelectorAll<HTMLButtonElement>("button.suggestion")];
      expect(chips.map((c) => c.textContent)).toEqual(["積立", "家賃"]);
    });

    it("どの候補にも一致しない入力ではチップを出さない", async () => {
      await store.setComment("transfer:1", "家賃");

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      const input = panel.querySelector("input")!;
      input.value = "旅行";
      input.dispatchEvent(new Event("input"));

      expect(panel.querySelectorAll("button.suggestion")).toHaveLength(0);
    });

    it("絞り込み後もチップのタップで入力欄に反映できる", async () => {
      await store.setComment("transfer:1", "家賃");
      await store.setComment("transfer:2", "積立");

      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      const input = panel.querySelector("input")!;
      input.value = "家";
      input.dispatchEvent(new Event("input"));

      panel.querySelector<HTMLButtonElement>("button.suggestion")!.click();
      expect(input.value).toBe("家賃");
    });

    it("コメントがなければチップの列は出さない", async () => {
      await confirmTransfer();

      const panel = document.getElementById("aozora-history-comment")!;
      expect(panel.querySelectorAll("button.suggestion")).toHaveLength(0);
    });

    it("記録に失敗した場合はパネルを出さない", async () => {
      document.body.innerHTML = transferHtml;
      document.querySelector<HTMLInputElement>("input.input-amount")!.value = "";

      await openConfirmModal();
      await executeTransfer();

      expect(document.getElementById("aozora-history-comment")).toBeNull();
    });
  });

  it("金額が不正なまま確認を押しても記録しない", async () => {
    document.body.innerHTML = transferHtml;
    document.querySelector<HTMLInputElement>("input.input-amount")!.value = "";

    await openConfirmModal();
    await executeTransfer();

    expect(await store.loadTransfers()).toEqual([]);
  });

  it("DOMの変化が続いていてもスナップショットを保存する", async () => {
    document.body.innerHTML = accountsHtml;
    const ticker = document.createElement("div");
    document.body.append(ticker);

    // チャットボット等でDOMがデバウンス間隔より短い周期で変化し続ける状況
    for (let i = 0; i < 20; i++) {
      ticker.textContent = String(i);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(await store.loadSnapshots()).toHaveLength(1);
  });

  it("口座一覧のないページでは何も保存しない", async () => {
    document.body.innerHTML = "<p>別のページ</p>";

    await vi.runAllTimersAsync();

    expect(await store.loadSnapshots()).toEqual([]);
  });
});
