import { describe, expect, it } from "vitest";
import { nextTheme, themeAttribute, themeLabel, toThemePreference } from "./theme.ts";

// 文書を触らない判定だけ。属性を実際に置く applyTheme は theme.dom.test.ts
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
