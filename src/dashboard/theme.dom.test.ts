import { describe, expect, it } from "vitest";
import { applyTheme } from "./theme.ts";

// 文書に属性を置く一手だけがここ。判定は theme.test.ts (node) で確かめる
describe("applyTheme", () => {
  it("固定したテーマを属性に置く", () => {
    const root = document.createElement("html");

    applyTheme(root, "dark");

    expect(root.dataset.theme).toBe("dark");
  });

  it("システムに戻したら属性を消す", () => {
    const root = document.createElement("html");
    applyTheme(root, "dark");

    applyTheme(root, "system");

    expect(root.dataset.theme).toBeUndefined();
  });
});
