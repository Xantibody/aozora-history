import { describe, expect, it } from "vitest";
import { commentSuggestions } from "./comments.ts";

const comment = (text: string, updatedAt = 0): { text: string; updatedAt: number } => ({
  text,
  updatedAt,
});

describe("commentSuggestions", () => {
  it("コメントがなければ空を返す", () => {
    expect(commentSuggestions({})).toStrictEqual([]);
  });

  it("同じ内容のコメントは1つの候補にまとめる", () => {
    const comments = {
      "transfer:100": comment("家賃"),
      "transfer:200": comment("家賃"),
      "change:101:300": comment("給料"),
    };

    expect(commentSuggestions(comments)).toStrictEqual(["家賃", "給料"]);
  });

  it("使用回数の多い順に並べる", () => {
    const comments = {
      "transfer:100": comment("積立"),
      "transfer:200": comment("家賃"),
      "transfer:300": comment("家賃"),
      "transfer:400": comment("家賃"),
      "transfer:500": comment("積立"),
    };

    expect(commentSuggestions(comments)).toStrictEqual(["家賃", "積立"]);
  });

  it("使用回数が同じなら新しい記録のコメントを先にする", () => {
    const comments = {
      "transfer:100": comment("古いメモ"),
      "transfer:200": comment("新しいメモ"),
    };

    expect(commentSuggestions(comments)).toStrictEqual(["新しいメモ", "古いメモ"]);
  });

  it("編集時刻が記録より新しければそちらで比べる", () => {
    const comments = {
      "transfer:100": comment("後から編集", 900),
      "transfer:200": comment("新しい記録"),
    };

    expect(commentSuggestions(comments)).toStrictEqual(["後から編集", "新しい記録"]);
  });

  it("削除の記録(tombstone)は候補に出さない", () => {
    const comments = {
      "transfer:100": comment("家賃"),
      "transfer:200": comment("", 900),
    };

    expect(commentSuggestions(comments)).toStrictEqual(["家賃"]);
  });
});
