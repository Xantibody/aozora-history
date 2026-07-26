import {
  accountStatements,
  mergeStatements,
  primaryStatements,
  sortStatementsDesc,
  statementKey,
  statementsExplainBalance,
} from "./statement.ts";
import { describe, expect, it } from "vitest";
import type { StatementEntry } from "./statement.ts";

function statement(valueDate: string, entryNumber: string, amount: number): StatementEntry {
  return { valueDate, entryNumber, amount, balance: 0, remark: "" };
}

function inAccount(accountId: string, entry: StatementEntry): StatementEntry {
  return { ...entry, accountId };
}

function withBalance(entry: StatementEntry, balance: number): StatementEntry {
  return { ...entry, balance };
}

describe("statementKey", () => {
  it("明細番号は日付ごとの採番のため、日付と組で一意にする", () => {
    expect(statementKey(statement("2026-07-24", "0001", -100))).toBe("2026-07-24:0001");
    expect(statementKey(statement("2026-07-25", "0001", -100))).not.toBe(
      statementKey(statement("2026-07-24", "0001", -100)),
    );
  });

  it("つかいわけ口座の明細は口座ごとに採番されるため、口座IDでも区別する", () => {
    const entry = statement("2026-07-24", "0001", -100);

    expect(statementKey(inAccount("133331", entry))).not.toBe(
      statementKey(inAccount("133332", entry)),
    );
  });

  it("代表口座の明細のキーは変えない(既存のコメントの紐付けを保つ)", () => {
    expect(statementKey(statement("2026-07-24", "0001", -100))).toBe("2026-07-24:0001");
  });
});

describe("primaryStatements / accountStatements", () => {
  const all = [
    statement("2026-07-24", "0001", -100),
    inAccount("133331", statement("2026-07-24", "0001", -200)),
    inAccount("133332", statement("2026-07-24", "0001", -300)),
  ];

  it("代表口座の明細だけを取り出す", () => {
    expect(primaryStatements(all)).toStrictEqual([statement("2026-07-24", "0001", -100)]);
  });

  it("指定したつかいわけ口座の明細だけを取り出す", () => {
    expect(accountStatements(all, "133331")).toStrictEqual([
      inAccount("133331", statement("2026-07-24", "0001", -200)),
    ]);
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

  it("口座が違えば同じ日付・明細番号でも別の明細として残す", () => {
    const merged = mergeStatements(
      [statement("2026-07-24", "0001", -100)],
      [inAccount("133331", statement("2026-07-24", "0001", -200))],
    );

    expect(merged).toHaveLength(2);
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

describe("明細番号の並び", () => {
  it("ゼロ埋めされていなくても数値の大小で並べる", () => {
    const sorted = sortStatementsDesc([
      statement("2026-07-26", "9", 100),
      statement("2026-07-26", "10", 200),
    ]);

    expect(sorted.map((line) => line.entryNumber)).toStrictEqual(["10", "9"]);
  });
});

describe("statementsExplainBalance", () => {
  it("最新の明細の残高が口座の残高と一致すれば取り込んでよい", () => {
    const entries = [
      withBalance(statement("2026-07-23", "0001", -100), 900),
      withBalance(statement("2026-07-24", "0001", -100), 800),
    ];

    expect(statementsExplainBalance(entries, 800)).toBe(true);
  });

  it("残高が合わなければ別口座の明細が返っているとみなす", () => {
    const entries = [withBalance(statement("2026-07-24", "0001", -100), 800)];

    expect(statementsExplainBalance(entries, 129_392)).toBe(false);
  });

  it("明細が空なら検算できないので取り込まない", () => {
    expect(statementsExplainBalance([], 0)).toBe(false);
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
