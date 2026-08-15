import { DAY_MS, statementAt } from "./period.ts";
import { describe, expect, it } from "vitest";

const NOW = new Date(2026, 7, 15, 14, 30).getTime();

describe("statementAt", () => {
  it("前日以前の明細はその日の終わりに置く", () => {
    // 起算日しか分からないので時刻は選べない。その日に記録した振替より
    // 後ろ(=新しい順の先頭)に来るよう、日の終わりへ寄せる
    const at = statementAt("2026-08-14", NOW);

    expect(at).toBe(new Date(2026, 7, 14).getTime() + DAY_MS - 1);
  });

  it("その日のうちに収める(日付の見出しがずれない)", () => {
    expect(new Date(statementAt("2026-08-14", NOW)!).getDate()).toBe(14);
  });

  it("当日の明細は取り込んだ今の時刻に置く", () => {
    // 当日はまだ日が終わっていない。先の時刻に置くと、この後の振替が
    // 先に取り込んだはずの明細より後ろに並んでしまう
    expect(statementAt("2026-08-15", NOW)).toBe(NOW);
  });

  it("読めない日付はnull", () => {
    expect(statementAt("", NOW)).toBeNull();
  });
});
