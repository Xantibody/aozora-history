import { describe, expect, it } from "vitest";
import type { AccountRef } from "./parser.ts";
import type { TransferRecord } from "./ledger.ts";
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

const account = (id: string): AccountRef => ({ id, name: id });

const transfer = (transferredAt: number, amount: number): TransferRecord => ({
  transferredAt,
  from: account("133331"),
  to: account("133332"),
  amount,
});

describe("commentSuggestions(金額を渡したとき)", () => {
  it("同じ金額で使ったコメントを先にする", () => {
    // 「家賃」の方が使用回数は多いが、いま振り替えているのは3,000円
    const comments = {
      "transfer:100": comment("家賃"),
      "transfer:200": comment("家賃"),
      "transfer:300": comment("ランチ"),
    };
    const transfers = [transfer(100, 80_000), transfer(200, 80_000), transfer(300, 3000)];

    const suggestions = commentSuggestions(comments, { amount: 3000, transfers });

    expect(suggestions).toStrictEqual(["ランチ", "家賃"]);
  });

  it("同じ金額がなければ近い金額のコメントを先にする", () => {
    // 「家賃」の方が新しい記録。回数が同じなら本来こちらが先に来る
    const comments = {
      "transfer:100": comment("ランチ"),
      "transfer:200": comment("家賃"),
    };
    const transfers = [transfer(100, 3200), transfer(200, 80_000)];

    expect(commentSuggestions(comments, { amount: 3000, transfers })).toStrictEqual([
      "ランチ",
      "家賃",
    ]);
  });

  it("近さが同じくらいなら使用回数の多い順のまま", () => {
    // 数円の違いで普段使いの候補が押しのけられては、かえって選びにくい
    const comments = {
      "transfer:100": comment("食費"),
      "transfer:200": comment("食費"),
      "transfer:300": comment("ランチ"),
    };
    const transfers = [transfer(100, 3050), transfer(200, 3050), transfer(300, 3100)];

    expect(commentSuggestions(comments, { amount: 3000, transfers })).toStrictEqual([
      "食費",
      "ランチ",
    ]);
  });

  it("金額の分からないコメントも候補には残す", () => {
    // 明細に付けたコメントなど、振替の記録から金額を引けないもの
    const comments = {
      "statement:2026-07-24:0001": comment("給与", 900),
      "transfer:300": comment("ランチ"),
    };
    const transfers = [transfer(300, 3000)];

    expect(commentSuggestions(comments, { amount: 3000, transfers })).toStrictEqual([
      "ランチ",
      "給与",
    ]);
  });
});
