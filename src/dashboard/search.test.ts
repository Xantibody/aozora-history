import {
  appliedSearchLabel,
  matchesSearch,
  parseAmount,
  searchKey,
  tierBadgeLabel,
  tierChipLabel,
} from "./search.ts";
import { describe, expect, it } from "vitest";
import type { SearchTier } from "./context.ts";

describe("parseAmount", () => {
  it("数字だけなら金額として読む", () => {
    expect(parseAmount("85000")).toBe(85_000);
  });

  it("カンマ・空白・「円」は取り除いて読む", () => {
    expect(parseAmount(" 85,000円 ")).toBe(85_000);
    expect(parseAmount("85，000")).toBe(85_000);
  });

  it("数字以外が混ざればテキストとして扱う(null)", () => {
    expect(parseAmount("家賃")).toBeNull();
    expect(parseAmount("85000円弱")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("matchesSearch(テキスト)", () => {
  const applied = { kind: "text", query: "家賃" } as const;

  it("メモか摘要のどれかに含まれれば一致", () => {
    expect(matchesSearch(applied, ["家賃の振替", ""], -85_000)).toBe(true);
    expect(matchesSearch(applied, ["", "カ）家賃サービス"], -85_000)).toBe(true);
  });

  it("どこにも含まれなければ外れる", () => {
    expect(matchesSearch(applied, ["食費", "スーパー"], -1200)).toBe(false);
  });
});

const at = (tier: SearchTier): { kind: "amount"; amount: number; tier: SearchTier } => ({
  kind: "amount",
  amount: 85_000,
  tier,
});

describe("matchesSearch(金額)", () => {
  it("同額の段階は完全一致だけを通す", () => {
    expect(matchesSearch(at(0), [], 85_000)).toBe(true);
    expect(matchesSearch(at(0), [], 85_001)).toBe(false);
  });

  it("出金(負の金額)は絶対値で比べる", () => {
    expect(matchesSearch(at(0), [], -85_000)).toBe(true);
  });

  it("ほぼ同額は±10%まで通す", () => {
    expect(matchesSearch(at(1), [], 93_500)).toBe(true);
    expect(matchesSearch(at(1), [], 76_500)).toBe(true);
    expect(matchesSearch(at(1), [], 60_000)).toBe(false);
  });

  it("同じ桁は隔たり50%まで通す(3,000円に対する6,000円までと同じ読み)", () => {
    expect(matchesSearch(at(2), [], 60_000)).toBe(true);
    expect(matchesSearch(at(2), [], 170_000)).toBe(true);
    expect(matchesSearch(at(2), [], 180_000)).toBe(false);
  });
});

describe("tierBadgeLabel", () => {
  it("同額はそう言い切る", () => {
    expect(tierBadgeLabel(85_000, -85_000)).toBe("同額");
  });

  it("差があれば実差のパーセントで示す", () => {
    expect(tierBadgeLabel(85_000, 93_500)).toBe("+10%");
    expect(tierBadgeLabel(85_000, -79_000)).toBe("-7%");
  });
});

describe("appliedSearchLabel", () => {
  it("テキストはかぎ括弧で包む", () => {
    expect(appliedSearchLabel({ kind: "text", query: "家賃" })).toBe("「家賃」");
  });

  it("金額は段階を添える", () => {
    expect(appliedSearchLabel({ kind: "amount", amount: 85_000, tier: 0 })).toBe(
      "85,000円（同額）",
    );
    expect(appliedSearchLabel({ kind: "amount", amount: 85_000, tier: 1 })).toBe("85,000円±10%");
    expect(appliedSearchLabel({ kind: "amount", amount: 85_000, tier: 2 })).toBe(
      "85,000円（同じ桁）",
    );
  });
});

describe("tierChipLabel", () => {
  it("範囲の実値をラベルに含める", () => {
    expect(tierChipLabel(85_000, 0)).toBe("完全一致");
    expect(tierChipLabel(85_000, 1)).toBe("ほぼ同額 76,500円〜93,500円");
    expect(tierChipLabel(85_000, 2)).toBe("同じ桁 42,500円〜127,500円");
  });
});

describe("searchKey", () => {
  it("条件が変わればキーも変わる(ページングを先頭へ戻すため)", () => {
    expect(searchKey(null)).toBe("");
    expect(searchKey({ kind: "text", query: "家賃" })).not.toBe(searchKey(null));
    expect(searchKey({ kind: "amount", amount: 85_000, tier: 1 })).not.toBe(
      searchKey({ kind: "amount", amount: 85_000, tier: 2 }),
    );
  });
});
