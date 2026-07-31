import { describe, expect, it } from "vitest";
import { formatDateTime, formatSigned, formatYen, statementsCsv, transfersCsv } from "./render.ts";
import { statements, transfers } from "./render.fixture.ts";

describe("transfersCsv", () => {
  it("ヘッダー付きで振替を新しい順にCSV化する(Excel向けBOM付き)", () => {
    const comments = {
      [`transfer:${transfers[1].transferredAt}`]: { text: "生活費", updatedAt: 1 },
    };

    const csv = transfersCsv(transfers, comments);

    expect(csv).toBe(
      "﻿日時,出金口座,入金口座,金額,コメント\r\n" +
        `${formatDateTime(transfers[0].transferredAt)},01: お財布,02: 積立,5000,\r\n` +
        `${formatDateTime(transfers[1].transferredAt)},02: 積立,03: 支払い箱,30000,生活費\r\n`,
    );
  });

  it("カンマや引用符を含むフィールドはRFC4180形式でエスケープする", () => {
    const transfer = {
      transferredAt: 1,
      from: { id: "1", name: 'A,B"C' },
      to: { id: "2", name: "D" },
      amount: 100,
    };

    const csv = transfersCsv([transfer], {});

    expect(csv).toContain('"A,B""C",D,100,');
  });
});

describe("formatYen", () => {
  it("カンマ区切りと円記号を付ける", () => {
    expect(formatYen(129_392)).toBe("129,392円");
    expect(formatYen(0)).toBe("0円");
  });
});

describe("formatSigned", () => {
  it("符号付きで金額を表示する", () => {
    expect(formatSigned(280_000)).toBe("+280,000円");
    expect(formatSigned(-5000)).toBe("-5,000円");
    expect(formatSigned(0)).toBe("±0円");
  });
});

describe("formatDateTime", () => {
  it("エポックミリ秒をローカル日時で表示する", () => {
    const ms = new Date(2026, 6, 10, 22, 34).getTime();

    expect(formatDateTime(ms)).toBe("2026/07/10 22:34");
  });
});
describe("statementsCsv", () => {
  it("ヘッダー付きで明細を新しい順にCSV化する(Excel向けBOM付き)", () => {
    const csv = statementsCsv(statements, {
      "statement:2026-07-24:0001": { text: "月給", updatedAt: 1 },
    });

    expect(csv).toBe(
      "﻿日付,摘要,金額,残高,コメント\r\n" +
        "2026-07-24,振込 ラクテン,-173000,907425,\r\n" +
        "2026-07-24,給与  カ）アツトマーク,635144,1080425,月給\r\n" +
        "2026-07-23,振込 ミツビシユーエフジエイ,-4100,445281,\r\n",
    );
  });
});
