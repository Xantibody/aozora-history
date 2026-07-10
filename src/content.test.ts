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

describe("setupContentScript", () => {
  let store: HistoryStore;
  let teardown: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    store = new HistoryStore(fakeStorage());
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

  it("振替フォームで確認を押すと振替を記録する", async () => {
    document.body.innerHTML = transferHtml;
    await vi.runAllTimersAsync();

    document.getElementById("sp-account-account-to-account-confirm")!.click();
    await vi.runAllTimersAsync();

    expect(await store.loadTransfers()).toEqual([
      {
        transferredAt: 42,
        from: { id: "133331", name: "01: お財布" },
        to: { id: "133332", name: "02: 積立" },
        amount: 5000,
      },
    ]);
  });

  it("金額が不正なまま確認を押しても記録しない", async () => {
    document.body.innerHTML = transferHtml;
    document.querySelector<HTMLInputElement>("input.input-amount")!.value = "";

    document.getElementById("sp-account-account-to-account-confirm")!.click();
    await vi.runAllTimersAsync();

    expect(await store.loadTransfers()).toEqual([]);
  });

  it("口座一覧のないページでは何も保存しない", async () => {
    document.body.innerHTML = "<p>別のページ</p>";

    await vi.runAllTimersAsync();

    expect(await store.loadSnapshots()).toEqual([]);
  });
});
