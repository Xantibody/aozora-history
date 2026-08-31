import { SCENARIOS, dummyData, toScenario } from "./dummy-data.ts";
import type { DummyData } from "./dummy-data.ts";
import type { FakeBrowser } from "./fake-browser.ts";
import { HistoryStore } from "../infrastructure/storage.ts";
import { createFakeBrowser } from "./fake-browser.ts";
import { createFakeR2Fetch } from "./fake-r2.ts";

/**
 * ブラウザで直接開くプレビューの入口。
 *
 * 拡張として読み込む代わりに `browser` と `fetch` をこの場で用意し、
 * ダミーの記録を入れてから、拡張と同じダッシュボードを起動する。
 * 画面を直すたびに拡張を入れ直さずに済み、記録がない・多すぎるといった
 * 手元では作りにくい状態も ?data= で切り替えて見られる。
 */

async function seed(fake: FakeBrowser, data: DummyData): Promise<void> {
  const store = new HistoryStore(fake.storage.local);
  await store.replaceLedger(data.ledger);
  await store.recordAutoTransfers(data.autoTransfers);
  await store.recordRegularTransfers(data.regularTransfers);
  await store.recordLastCollect(data.lastCollect);
  await store.saveDebugMode(data.debugMode);
  if (data.syncConfig !== null) {
    await store.saveSyncConfig(data.syncConfig);
    await store.markSynced();
  }
}

async function main(): Promise<void> {
  const scenario = toScenario(new URLSearchParams(globalThis.location.search).get("data"));
  const fake = createFakeBrowser();
  // ダッシュボードは読み込まれた時点で browser を使い始めるため、先に用意する
  Object.defineProperty(globalThis, "browser", { value: fake, configurable: true });
  globalThis.fetch = createFakeR2Fetch();

  await seed(fake, dummyData(scenario, Date.now()));
  console.info(`ダミーデータ: ${scenario} (?data=${SCENARIOS.join(" / ?data=")} で切り替え)`);

  await import("../dashboard/index.ts");
}

void main();
