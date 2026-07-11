import { describe, expect, it } from "vitest";
import { parseLedgerJson } from "./serialization.ts";

const validLedger = {
  snapshots: [
    {
      takenAt: 100,
      updatedAt: "2026/07/10 22:34",
      accounts: [{ id: "133331", name: "01: お財布", balance: 129392 }],
    },
  ],
  transfers: [
    {
      transferredAt: 200,
      from: { id: "133331", name: "01: お財布" },
      to: { id: "133332", name: "02: 積立" },
      amount: 5000,
    },
  ],
  comments: { "transfer:200": { text: "家賃", updatedAt: 300 } },
  deletions: { "100:133331:133332:5000": 400 },
};

describe("parseLedgerJson", () => {
  it("R2オブジェクトと同じ形式のJSONを読み込む", () => {
    expect(parseLedgerJson(JSON.stringify(validLedger))).toEqual(validLedger);
  });

  it("updatedAtがないスナップショットはnullとして読み込む", () => {
    const json = JSON.stringify({
      snapshots: [{ takenAt: 1, accounts: [] }],
      transfers: [],
      comments: {},
    });

    expect(parseLedgerJson(json).snapshots[0].updatedAt).toBeNull();
  });

  it("欠けているセクションは空として読み込む", () => {
    expect(parseLedgerJson("{}")).toEqual({
      snapshots: [],
      transfers: [],
      comments: {},
      deletions: {},
    });
  });

  it("JSONとして不正な文字列はエラーにする", () => {
    expect(() => parseLedgerJson("これはJSONではない")).toThrow("JSON");
  });

  it("配列やnullはエラーにする", () => {
    expect(() => parseLedgerJson("[]")).toThrow("形式");
    expect(() => parseLedgerJson("null")).toThrow("形式");
  });

  it("スナップショットの形式が壊れていればエラーにする", () => {
    const json = JSON.stringify({ snapshots: [{ takenAt: "文字列", accounts: [] }] });

    expect(() => parseLedgerJson(json)).toThrow("形式");
  });

  it("口座の形式が壊れていればエラーにする", () => {
    const json = JSON.stringify({
      snapshots: [{ takenAt: 1, accounts: [{ id: "1", name: "お財布" }] }],
    });

    expect(() => parseLedgerJson(json)).toThrow("形式");
  });

  it("振替の形式が壊れていればエラーにする", () => {
    const json = JSON.stringify({
      transfers: [{ transferredAt: 1, from: { id: "1", name: "a" }, amount: 100 }],
    });

    expect(() => parseLedgerJson(json)).toThrow("形式");
  });

  it("旧形式(文字列)のコメントは更新時刻0として読み込む", () => {
    const json = JSON.stringify({ comments: { "transfer:200": "家賃" } });

    expect(parseLedgerJson(json).comments).toEqual({
      "transfer:200": { text: "家賃", updatedAt: 0 },
    });
  });

  it("削除の記録の形式が壊れていればエラーにする", () => {
    expect(() => parseLedgerJson(JSON.stringify({ deletions: { k: "文字列" } }))).toThrow("形式");
    expect(() => parseLedgerJson(JSON.stringify({ deletions: [1] }))).toThrow("形式");
  });

  it("コメントの形式が壊れていればエラーにする", () => {
    expect(() => parseLedgerJson(JSON.stringify({ comments: { k: 123 } }))).toThrow("形式");
    expect(() => parseLedgerJson(JSON.stringify({ comments: { k: { text: "a" } } }))).toThrow(
      "形式",
    );
  });
});
