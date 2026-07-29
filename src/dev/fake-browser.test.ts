import { describe, expect, it, vi } from "vitest";
import { createFakeBrowser } from "./fake-browser.ts";

describe("createFakeBrowser", () => {
  it("保存した値を読み戻せる", async () => {
    const fake = createFakeBrowser();

    await fake.storage.local.set({ transferRecords: [{ amount: 1000 }] });

    await expect(fake.storage.local.get("transferRecords")).resolves.toStrictEqual({
      transferRecords: [{ amount: 1000 }],
    });
  });

  it("保存していないキーは空で返す(実物と同じく既定値は呼び出し側が決める)", async () => {
    const fake = createFakeBrowser();

    await expect(fake.storage.local.get("comments")).resolves.toStrictEqual({});
  });

  it("出し入れで値を写す(実物はstorageに入る際に複製される)", async () => {
    const fake = createFakeBrowser();
    const records = [{ amount: 1000 }];

    await fake.storage.local.set({ transferRecords: records });
    records[0].amount = 9999;

    await expect(fake.storage.local.get("transferRecords")).resolves.toStrictEqual({
      transferRecords: [{ amount: 1000 }],
    });
  });

  it("保存すると変更を購読者へ知らせる(ダッシュボードの自動更新が動く)", async () => {
    const fake = createFakeBrowser();
    const listener = vi.fn<(changes: Record<string, unknown>, areaName: string) => void>();
    fake.storage.onChanged.addListener(listener);

    await fake.storage.local.set({ themePreference: "dark" });

    expect(listener).toHaveBeenCalledWith(
      { themePreference: { oldValue: undefined, newValue: "dark" } },
      "local",
    );
  });
});
