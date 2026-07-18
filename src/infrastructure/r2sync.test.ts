import type { FetchLike, SyncConfig } from "./r2sync.ts";
import { R2Client, parseSyncConfigJson, syncWithR2 } from "./r2sync.ts";
import { describe, expect, it } from "vitest";
import { HistoryStore } from "./storage.ts";
import type { LedgerData } from "../domain/merge.ts";
import type { StorageArea } from "./storage.ts";

const config: SyncConfig = {
  accountId: "abc123",
  bucket: "aozora",
  objectKey: "aozora-history.json",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

const emptyLedger: LedgerData = { snapshots: [], transfers: [], comments: {}, deletions: {} };

const remoteLedger: LedgerData = {
  snapshots: [
    { takenAt: 10, updatedAt: null, accounts: [{ id: "100", name: "お財布", balance: 100 }] },
  ],
  transfers: [],
  comments: { "transfer:1": { text: "リモート", updatedAt: 0 } },
  deletions: {},
};

interface Request {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(responses: { status: number; body?: string }[]): {
  fetchFn: FetchLike;
  requests: Request[];
} {
  const requests: Request[] = [];
  const fetchFn: FetchLike = (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body });
    const res = responses[requests.length - 1] ?? { status: 200 };
    return Promise.resolve({
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      text: () => Promise.resolve(res.body ?? ""),
    });
  };
  return { fetchFn, requests };
}

function noop(): void {
  /* empty */
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = noop;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** GETは gate の解放まで待たせて404、PUTは即時200を返す */
function gatedFetch(gate: Promise<void>): { fetchFn: FetchLike; requests: Request[] } {
  const requests: Request[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (init.method === "GET") {
      await gate;
    }
    const status = init.method === "GET" ? 404 : 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(""),
    };
  };
  return { fetchFn, requests };
}

function fakeStorage(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.has(key) ? { [key]: data.get(key) } : {}),
    set: (items) => {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, value);
      }
      return Promise.resolve();
    },
  };
}

function client(fetchFn: FetchLike): R2Client {
  return new R2Client(config, fetchFn, () => new Date(Date.UTC(2026, 6, 10)));
}

describe("R2Client", () => {
  it("バケットとキーからURLを組み立てて署名付きGETする", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: JSON.stringify(remoteLedger) }]);

    const data = await client(fetchFn).download();

    expect(data).toStrictEqual(remoteLedger);
    expect(requests[0].url).toBe(
      "https://abc123.r2.cloudflarestorage.com/aozora/aozora-history.json",
    );
    expect(requests[0].headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=key/");
    expect(requests[0].headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("404はまだ同期データがないものとしてnullを返す", async () => {
    const { fetchFn } = fakeFetch([{ status: 404 }]);

    await expect(client(fetchFn).download()).resolves.toBeNull();
  });

  it("その他のエラーは例外にする", async () => {
    const { fetchFn } = fakeFetch([{ status: 403 }]);

    await expect(client(fetchFn).download()).rejects.toThrow("403");
  });

  it("台帳の形式でないデータはローカルを壊さないようエラーにする", async () => {
    const wrongObject = { snapshots: "not an array" };
    const { fetchFn } = fakeFetch([{ status: 200, body: JSON.stringify(wrongObject) }]);

    await expect(client(fetchFn).download()).rejects.toThrow("形式が正しくありません");
  });

  it("JSONでないデータはエラーにする", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: "<html>error page</html>" }]);

    await expect(client(fetchFn).download()).rejects.toThrow("JSONとして読み込めませんでした");
  });

  it("アップロードはJSONボディをPUTする", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200 }]);

    await client(fetchFn).upload(remoteLedger);

    expect(requests[0].method).toBe("PUT");
    expect(JSON.parse(requests[0].body!)).toStrictEqual(remoteLedger);
    expect(requests[0].headers["content-type"]).toBe("application/json");
  });
});

describe("syncWithR2", () => {
  it("リモートとマージした結果をローカルとR2の両方に書き戻す", async () => {
    const store = new HistoryStore(fakeStorage());
    const localTransfer = {
      transferredAt: 5,
      from: { id: "100", name: "お財布" },
      to: { id: "101", name: "積立" },
      amount: 1000,
    };
    await store.recordTransfer(localTransfer);
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: JSON.stringify(remoteLedger) },
      { status: 200 },
    ]);

    const merged = await syncWithR2(store, client(fetchFn));

    expect(merged).toStrictEqual({
      snapshots: remoteLedger.snapshots,
      transfers: [localTransfer],
      comments: remoteLedger.comments,
      deletions: {},
    });
    // ローカルへ反映
    await expect(store.loadLedger()).resolves.toStrictEqual(merged);
    // R2へ反映
    expect(requests[1].method).toBe("PUT");
    expect(JSON.parse(requests[1].body!)).toStrictEqual(merged);
  });

  it("同期が完了したら最終同期時刻を記録する", async () => {
    const store = new HistoryStore(fakeStorage(), () => 777);
    const { fetchFn } = fakeFetch([{ status: 404 }, { status: 200 }]);

    await syncWithR2(store, client(fetchFn));

    await expect(store.loadLastSyncedAt()).resolves.toBe(777);
  });

  it("アップロードに失敗したら最終同期時刻は記録しない", async () => {
    const store = new HistoryStore(fakeStorage(), () => 777);
    const { fetchFn } = fakeFetch([{ status: 404 }, { status: 500 }]);

    await expect(syncWithR2(store, client(fetchFn))).rejects.toThrow("R2への保存に失敗しました");
    await expect(store.loadLastSyncedAt()).resolves.toBeNull();
  });

  it("リモートが未作成ならローカルの内容をそのままアップロードする", async () => {
    const store = new HistoryStore(fakeStorage());
    const { fetchFn, requests } = fakeFetch([{ status: 404 }, { status: 200 }]);

    const merged = await syncWithR2(store, client(fetchFn));

    expect(merged).toStrictEqual(emptyLedger);
    expect(JSON.parse(requests[1].body!)).toStrictEqual(emptyLedger);
  });

  it("ダウンロード待ちの間に記録された振替を消さずに同期する", async () => {
    const store = new HistoryStore(fakeStorage());
    const { promise: gate, release: releaseDownload } = deferred();
    const { fetchFn, requests } = gatedFetch(gate);

    const syncing = syncWithR2(store, client(fetchFn));
    // R2からの応答を待っている間に新しい振替が記録される
    await store.recordTransfer({
      transferredAt: 7,
      from: { id: "100", name: "お財布" },
      to: { id: "101", name: "積立" },
      amount: 500,
    });
    releaseDownload();
    const merged = await syncing;

    expect(merged.transfers).toHaveLength(1);
    await expect(store.loadTransfers()).resolves.toHaveLength(1);
    const putRequest = requests.find((request) => request.method === "PUT");
    expect(JSON.parse(putRequest!.body!).transfers).toHaveLength(1);
  });
});

describe("parseSyncConfigJson", () => {
  it("エクスポートした同期設定を読み込める", () => {
    expect(parseSyncConfigJson(JSON.stringify(config))).toStrictEqual(config);
  });

  it("objectKeyが無ければデフォルトを補う", () => {
    const { objectKey: _removed, ...withoutKey } = config;

    expect(parseSyncConfigJson(JSON.stringify(withoutKey))).toStrictEqual({
      ...config,
      objectKey: "aozora-history.json",
    });
  });

  it("JSONでなければエラーにする", () => {
    expect(() => parseSyncConfigJson("not json")).toThrow("JSONとして読み込めませんでした");
  });

  it.each(["accountId", "bucket", "accessKeyId", "secretAccessKey"])(
    "%s が欠けていたらエラーにする",
    (field) => {
      const broken = { ...config, [field]: undefined };

      expect(() => parseSyncConfigJson(JSON.stringify(broken))).toThrow(
        "同期設定の形式が正しくありません",
      );
    },
  );

  it("空文字のフィールドはエラーにする", () => {
    const broken = { ...config, accountId: "" };

    expect(() => parseSyncConfigJson(JSON.stringify(broken))).toThrow(
      "同期設定の形式が正しくありません",
    );
  });

  it("台帳のJSONを渡してもエラーにする", () => {
    expect(() => parseSyncConfigJson(JSON.stringify(emptyLedger))).toThrow(
      "同期設定の形式が正しくありません",
    );
  });
});
