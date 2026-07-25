import { describe, expect, it } from "vitest";
import { mergeStatements, sortStatementsDesc, statementKey } from "./statement.ts";
import type { StatementEntry } from "./statement.ts";

function statement(valueDate: string, entryNumber: string, amount: number): StatementEntry {
  return { valueDate, entryNumber, amount, balance: 0, remark: "" };
}

describe("statementKey", () => {
  it("明細番号は日付ごとの採番のため、日付と組で一意にする", () => {
    expect(statementKey(statement("2026-07-24", "0001", -100))).toBe("2026-07-24:0001");
    expect(statementKey(statement("2026-07-25", "0001", -100))).not.toBe(
      statementKey(statement("2026-07-24", "0001", -100)),
    );
  });
});

describe("mergeStatements", () => {
  it("同じ明細は後から渡した方で上書きする", () => {
    const merged = mergeStatements(
      [{ ...statement("2026-07-24", "0001", -100), remark: "旧" }],
      [{ ...statement("2026-07-24", "0001", -100), remark: "新" }],
    );

    expect(merged).toStrictEqual([{ ...statement("2026-07-24", "0001", -100), remark: "新" }]);
  });

  it("別の明細は両方残し、日付と明細番号の昇順に並べる", () => {
    const merged = mergeStatements(
      [statement("2026-07-24", "0002", 200)],
      [statement("2026-07-23", "0001", -100), statement("2026-07-24", "0001", 300)],
    );

    expect(merged.map((line) => statementKey(line))).toStrictEqual([
      "2026-07-23:0001",
      "2026-07-24:0001",
      "2026-07-24:0002",
    ]);
  });
});

describe("sortStatementsDesc", () => {
  it("新しい順(同日は明細番号の大きい順)に並べる", () => {
    const sorted = sortStatementsDesc([
      statement("2026-07-23", "0001", -100),
      statement("2026-07-24", "0001", 200),
      statement("2026-07-24", "0002", 300),
    ]);

    expect(sorted.map((line) => statementKey(line))).toStrictEqual([
      "2026-07-24:0002",
      "2026-07-24:0001",
      "2026-07-23:0001",
    ]);
  });
});
