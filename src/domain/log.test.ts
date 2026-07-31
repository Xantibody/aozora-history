import { describe, expect, it } from "vitest";
import type { BalanceSnapshot } from "./ledger.ts";
import type { LogEntry } from "./log.ts";
import type { StatementEntry } from "./statement.ts";
import { logEntries } from "./log.ts";

/** "yyyy-MM-dd" をローカル0時に。ダッシュボードが渡しているものと同じ役 */
function dayStart(valueDate: string): number | null {
  const [year, month, day] = valueDate.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day).getTime() : null;
}

/**
 * ATMで20,000円下ろしただけの台帳。
 *
 * 代表口座(円普通預金)の残高はつかいわけ口座の合計なので、この1回の出金は
 * 代表口座の明細としても、つかいわけ口座の残高減としても現れる
 */
const snapshots: BalanceSnapshot[] = [
  {
    takenAt: new Date(2026, 6, 16, 9, 0).getTime(),
    updatedAt: null,
    accounts: [{ id: "133331", name: "01: お財布", balance: 120_000 }],
  },
  {
    takenAt: new Date(2026, 6, 16, 21, 0).getTime(),
    updatedAt: null,
    accounts: [{ id: "133331", name: "01: お財布", balance: 100_000 }],
  },
];

const atmWithdrawal: StatementEntry = {
  entryNumber: "0001",
  valueDate: "2026-07-16",
  amount: -20_000,
  balance: 100_000,
  remark: "ATM セブン銀行",
};

function entries(statements: StatementEntry[]): LogEntry[] {
  return logEntries({ snapshots, transfers: [], statements, dayStart });
}

function kinds(log: LogEntry[]): string[] {
  return log.filter((entry) => entry.kind !== "snapshot").map((entry) => entry.kind);
}

type StatementLine = Extract<LogEntry, { kind: "statement" }>;

function statementLines(log: LogEntry[]): StatementLine[] {
  return log.filter((entry): entry is StatementLine => entry.kind === "statement");
}

describe("logEntries", () => {
  it("同じお金の動きを代表口座の明細と残高変動で二重に並べない", () => {
    // 代表口座の明細が説明している出金なので、行は1つでよい
    expect(kinds(entries([atmWithdrawal]))).toHaveLength(1);
  });

  it("明細を取り込めていない外部入出金はそのまま残す", () => {
    expect(kinds(entries([]))).toStrictEqual(["external"]);
  });

  it("説明できた明細には、どのつかいわけ口座の動きかを書き込む", () => {
    // 明細は口座を持たないので、突き合わせた残高変動から補う
    const scopes = statementLines(entries([atmWithdrawal])).map((line) => line.account);

    expect(scopes).toStrictEqual([{ accountId: "133331", accountName: "01: お財布" }]);
  });

  it("間隔が空いて合算された残高変動も、内訳の明細で説明できれば畳む", () => {
    // issueの実例。7/12と7/16のATM出金が1回の残高変動(-35,000)に合算される
    const wide: BalanceSnapshot[] = [
      {
        takenAt: new Date(2026, 6, 11, 9, 0).getTime(),
        updatedAt: null,
        accounts: [{ id: "133331", name: "01: お財布", balance: 135_000 }],
      },
      {
        takenAt: new Date(2026, 6, 19, 9, 0).getTime(),
        updatedAt: null,
        accounts: [{ id: "133331", name: "01: お財布", balance: 100_000 }],
      },
    ];
    const statements: StatementEntry[] = [
      { ...atmWithdrawal, valueDate: "2026-07-12", amount: -15_000, balance: 120_000 },
      { ...atmWithdrawal, valueDate: "2026-07-16", amount: -20_000, balance: 100_000 },
    ];

    const log = logEntries({ snapshots: wide, transfers: [], statements, dayStart });

    // 合算の1行ではなく、いつ何にいくら使ったかが分かる2行が残る
    expect(kinds(log)).toStrictEqual(["statement", "statement"]);
  });

  it("複数口座の動きが同じ区間に重なったら畳まない(どちらの金か決められない)", () => {
    const twoAccounts: BalanceSnapshot[] = [
      {
        takenAt: new Date(2026, 6, 16, 9, 0).getTime(),
        updatedAt: null,
        accounts: [
          { id: "133331", name: "01: お財布", balance: 120_000 },
          { id: "133332", name: "02: 積立", balance: 50_000 },
        ],
      },
      {
        takenAt: new Date(2026, 6, 16, 21, 0).getTime(),
        updatedAt: null,
        accounts: [
          { id: "133331", name: "01: お財布", balance: 100_000 },
          { id: "133332", name: "02: 積立", balance: 30_000 },
        ],
      },
    ];
    // 同額の出金が2件。どの明細がどちらの口座のものかは読み取れない
    const statements: StatementEntry[] = [
      atmWithdrawal,
      { ...atmWithdrawal, entryNumber: "0002", balance: 80_000 },
    ];

    const log = logEntries({ snapshots: twoAccounts, transfers: [], statements, dayStart });

    expect(kinds(log).filter((kind) => kind === "external")).toHaveLength(2);
    expect(kinds(log).filter((kind) => kind === "statement")).toHaveLength(2);
  });

  it("残高変動で説明できない明細は残す(取り込みの穴を隠さない)", () => {
    // 残高が動いていない日の明細。畳むと記録から消える
    const unexplained: StatementEntry = {
      ...atmWithdrawal,
      entryNumber: "0002",
      amount: -777,
      balance: 99_223,
    };

    expect(kinds(entries([unexplained]))).toContain("statement");
  });
});
