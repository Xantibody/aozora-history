import { describe, expect, it } from "vitest";
import { type HistoryEntry, sortByVisitedAt } from "./history.ts";

describe("sortByVisitedAt", () => {
  it("空の配列は空のまま返す", () => {
    expect(sortByVisitedAt([])).toEqual([]);
  });

  it("訪問日時の新しい順に並べる", () => {
    const entries: HistoryEntry[] = [
      { url: "https://example.com/a", title: "a", visitedAt: 1 },
      { url: "https://example.com/b", title: "b", visitedAt: 3 },
      { url: "https://example.com/c", title: "c", visitedAt: 2 },
    ];

    expect(sortByVisitedAt(entries).map((e) => e.title)).toEqual(["b", "c", "a"]);
  });

  it("元の配列を変更しない", () => {
    const entries: HistoryEntry[] = [
      { url: "https://example.com/a", title: "a", visitedAt: 1 },
      { url: "https://example.com/b", title: "b", visitedAt: 2 },
    ];

    sortByVisitedAt(entries);

    expect(entries.map((e) => e.visitedAt)).toEqual([1, 2]);
  });
});
