import {
  accountStatements,
  primaryStatements,
  statementsExplainBalance,
} from "../domain/statement.ts";
import { describe, expect, it } from "vitest";
import { dummyData, toScenario } from "./dummy-data.ts";
import { latestSnapshot } from "../domain/ledger.ts";
import { reconcile } from "../domain/reconcile.ts";

// 生成は now を基準にした相対日付。実行時刻に依らないよう固定して比べる
const NOW = Date.UTC(2026, 6, 27, 3, 0);

describe("dummyData", () => {
  describe("rich", () => {
    const data = dummyData("rich", NOW);
    const { snapshots } = data.ledger;

    it("最新スナップショットまで記録が伸びている(当月表示に何か出る)", () => {
      const latest = latestSnapshot(snapshots)!;

      expect(latest.takenAt).toBeGreaterThan(NOW - 24 * 60 * 60 * 1000);
      expect(latest.takenAt).toBeLessThanOrEqual(NOW);
    });

    it("代表口座の明細の残高が、つかいわけ口座の合計と一致する", () => {
      // 代表口座は傘で、その残高はつかいわけ口座の合計。ここが崩れていると
      // ダミーは実際の口座構造と違うものを描き、二重表示の再現も検証もできない
      const lines = primaryStatements(data.ledger.statements);
      const latest = lines.at(-1)!;
      const total = latestSnapshot(snapshots)!.accounts.reduce(
        (sum, account) => sum + account.balance,
        0,
      );

      expect(lines.length).toBeGreaterThan(0);
      expect(latest.balance).toBe(total);
    });

    it("外部との出入りは、代表口座とつかいわけ口座の両方の明細に出る", () => {
      // 給与・引落・デビットは銀行の外との出入りなので両方に現れる。
      // 振替は合計を変えないので代表口座には現れない
      const salary = primaryStatements(data.ledger.statements).filter((line) =>
        line.remark.includes("ｷﾕｳﾖ"),
      );
      const onWallet = accountStatements(data.ledger.statements, "133331").filter((line) =>
        line.remark.includes("ｷﾕｳﾖ"),
      );

      expect(salary.length).toBeGreaterThan(0);
      expect(onWallet.map((line) => line.amount)).toStrictEqual(salary.map((line) => line.amount));
    });

    it("振替は代表口座の明細に載らない", () => {
      const transfers = primaryStatements(data.ledger.statements).filter((line) =>
        line.remark.startsWith("ﾌﾘｶｴ"),
      );

      expect(transfers).toStrictEqual([]);
    });

    it("口座別明細の最新残高が、その口座の残高と一致する", () => {
      // 一致しない明細は取り込み時に捨てられる(statement.ts)。
      // ダミーでも同じ検算を通る形にしておかないと、実物と違う画面を見ることになる
      for (const account of latestSnapshot(snapshots)!.accounts) {
        const lines = accountStatements(data.ledger.statements, account.id);

        expect(statementsExplainBalance(lines, account.balance)).toBe(true);
      }
    });

    it("残高の増減が明細の増減と釣り合っている", () => {
      const [oldest] = snapshots;
      for (const account of latestSnapshot(snapshots)!.accounts) {
        const opening = oldest.accounts.find((ac) => ac.id === account.id)!.balance;
        const moved = accountStatements(data.ledger.statements, account.id).reduce(
          (sum, line) => sum + line.amount,
          0,
        );

        expect(account.balance - opening).toBe(moved);
      }
    });

    it("記録に残らない定額自動振替を、差額から拾い直せる形にしてある", () => {
      const [setting] = data.autoTransfers;
      const { detected } = reconcile(snapshots, data.ledger.transfers, data.autoTransfers);

      expect(detected.map((tr) => `${tr.from.id}→${tr.to.id}:${tr.amount}`)).toContain(
        `${setting.from.id}→${setting.to.id}:${setting.amount}`,
      );
    });

    it("コメント・代表口座の明細・取り込み結果も入れる(設定画面とログの見た目を確かめられる)", () => {
      expect(Object.keys(data.ledger.comments).length).toBeGreaterThan(0);
      expect(data.ledger.statements.some((line) => line.accountId === undefined)).toBe(true);
      expect(data.lastCollect.errors).toStrictEqual([]);
      expect(data.syncConfig).not.toBeNull();
    });

    it("同じ now からは同じ記録を作る(見え方の違いがデータのゆらぎ由来にならない)", () => {
      expect(JSON.stringify(dummyData("rich", NOW))).toBe(JSON.stringify(data));
    });
  });

  describe("empty", () => {
    it("記録も設定も持たない(空状態を確かめられる)", () => {
      const data = dummyData("empty", NOW);

      expect(data.ledger.snapshots).toStrictEqual([]);
      expect(data.ledger.transfers).toStrictEqual([]);
      expect(data.ledger.statements).toStrictEqual([]);
      expect(data.syncConfig).toBeNull();
    });
  });

  describe("dense", () => {
    it("1ページ(100件)に収まらない記録を作る(ページングと間引きを確かめられる)", () => {
      const data = dummyData("dense", NOW);

      expect(data.ledger.snapshots.length).toBeGreaterThan(100);
      expect(data.ledger.transfers.length).toBeGreaterThan(100);
    });
  });

  describe.each(["rich", "dense"] as const)("%s の月の流れ", (scenario) => {
    it("どの口座もマイナス残高にならない(銀行は残高を超える出金を通さない)", () => {
      // 出ていくばかりの口座があると、構成比がマイナスになるなど、
      // 実物では起きない見え方でしか画面を確かめられなくなる
      const { snapshots } = dummyData(scenario, NOW).ledger;
      const overdrawn = snapshots
        .flatMap((snapshot) => snapshot.accounts)
        .filter((account) => account.balance < 0)
        .map((account) => account.name);

      expect([...new Set(overdrawn)]).toStrictEqual([]);
    });
  });
});

describe("toScenario", () => {
  it("知っている名前はそのまま使う", () => {
    expect(toScenario("dense")).toBe("dense");
  });

  it("指定なし・知らない名前は既定の rich にする", () => {
    expect(toScenario(null)).toBe("rich");
    expect(toScenario("いろいろ")).toBe("rich");
  });
});
