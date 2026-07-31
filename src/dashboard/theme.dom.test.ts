import { applyTheme, nextTheme, themeAttribute, themeLabel, toThemePreference } from "./theme.ts";
import { describe, expect, it } from "vitest";

describe("nextTheme", () => {
  it("システム → ライト → ダーク → システム と巡回する", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("システムに合わせるときは属性を持たない", () => {
    // 属性が無い状態にOSの設定を充てている(styles.cssのdarkバリアント)
    expect(themeAttribute("system")).toBeNull();
  });

  it("固定するときはその名前を返す", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("toThemePreference", () => {
  it("保存された値を読む", () => {
    expect(toThemePreference("dark")).toBe("dark");
  });

  it("知らない値・未設定はシステムに合わせる", () => {
    expect(toThemePreference(null)).toBe("system");
    expect(toThemePreference("sepia")).toBe("system");
  });
});

describe("themeLabel", () => {
  it("いま何が選ばれているかを文字で示す", () => {
    expect(themeLabel("system")).toContain("システム");
    expect(themeLabel("light")).toContain("ライト");
    expect(themeLabel("dark")).toContain("ダーク");
  });
});

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
