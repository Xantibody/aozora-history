import { describe, expect, it } from "vitest";
import { describeJson, errorMessages } from "./diagnostics.ts";

describe("describeJson", () => {
  it("配列の中身はキーまで見る(項目名の食い違いを見つけるため)", () => {
    const json = {
      queryDatetime: "2026-07-27T00:27:00+09:00",
      account: [{ spAccountId: "133331", spAccountName: "01: お財布", balance: "129392" }],
    };

    expect(describeJson(json)).toBe(
      "{ queryDatetime, account[1] { spAccountId, spAccountName, balance } }",
    );
  });

  it("金額や口座名といった値は出さない", () => {
    expect(describeJson({ amount: 304_000, name: "01: お財布" })).toBe("{ amount, name }");
  });

  it("空の配列は件数だけ", () => {
    expect(describeJson({ list: [] })).toBe("{ list[0] }");
  });

  it("オブジェクトでなければ型だけ", () => {
    expect(describeJson(null)).toBe("null");
    expect(describeJson("<!DOCTYPE html>")).toBe("string");
  });
});

describe("errorMessages", () => {
  it("stackを含めて残す", () => {
    const error = new Error("HTTP 403");
    error.stack = "HTTP 403\n    at get (content.js:1:1)";

    expect(errorMessages([error])).toStrictEqual(["HTTP 403\n    at get (content.js:1:1)"]);
  });

  it("stackにメッセージが入っていなければ添える", () => {
    const error = new Error("HTTP 403");
    error.stack = "get@content.js:1:1";

    expect(errorMessages([error])).toStrictEqual(["HTTP 403\nget@content.js:1:1"]);
  });

  it("例外でない値も残す", () => {
    expect(errorMessages(["まずいことが起きた"])).toStrictEqual(["まずいことが起きた"]);
  });
});
