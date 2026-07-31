import { describe, expect, it } from "vitest";
import { createFakeR2Fetch } from "./fake-r2.ts";

const URL_TEXT = "https://dev.r2.cloudflarestorage.com/bucket/aozora-history.json";

describe("createFakeR2Fetch", () => {
  it("まだ置かれていなければ404を返す(同期は「未作成」として扱う)", async () => {
    const fetchFn = createFakeR2Fetch();

    const res = await fetchFn(URL_TEXT, { method: "GET" });

    expect(res.status).toBe(404);
  });

  it("PUTした本文をGETで読み戻せる", async () => {
    const fetchFn = createFakeR2Fetch();

    await fetchFn(URL_TEXT, { method: "PUT", body: '{"snapshots":[]}' });
    const res = await fetchFn(URL_TEXT, { method: "GET" });

    expect(res.ok).toBe(true);
    await expect(res.text()).resolves.toBe('{"snapshots":[]}');
  });
});
