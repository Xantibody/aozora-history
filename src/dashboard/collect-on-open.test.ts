import { describe, expect, it, vi } from "vitest";
import type { CollectOnOpenDeps } from "./collect-on-open.ts";
import { collectOnOpen } from "./collect-on-open.ts";

function deps(overrides: Partial<CollectOnOpenDeps> = {}): CollectOnOpenDeps {
  return {
    hasBankTab: (): Promise<boolean> => Promise.resolve(true),
    requestCollect: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    ...overrides,
  };
}

describe("collectOnOpen", () => {
  // 間隔は見ない。開くこと自体が「いまの残高が見たい」という合図
  it("銀行サイトのタブが開いていれば、間隔を待たずに取り込みを頼む", async () => {
    const requestCollect = vi.fn<() => Promise<void>>(() => Promise.resolve());

    await expect(collectOnOpen(deps({ requestCollect }))).resolves.toBe("collecting");
    expect(requestCollect).toHaveBeenCalledTimes(1);
  });

  it("銀行サイトのタブが開いていなければ、取り込めないことを返す", async () => {
    const requestCollect = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const state = await collectOnOpen(
      deps({ hasBankTab: () => Promise.resolve(false), requestCollect }),
    );

    expect(state).toBe("needs-bank-tab");
    expect(requestCollect).not.toHaveBeenCalled();
  });
});
