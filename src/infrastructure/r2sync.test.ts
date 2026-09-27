import type { FetchLike, FetchResponse, SyncConfig } from "./r2sync.ts";
import { HistoryStore, LEDGER_KEYS } from "./storage.ts";
import { R2Client, parseSyncConfigJson, pushToR2, syncWithR2 } from "./r2sync.ts";
import { describe, expect, it } from "vitest";
import type { LedgerData } from "../domain/merge.ts";
import type { StorageArea } from "./storage.ts";

const config: SyncConfig = {
  accountId: "abc123",
  bucket: "aozora",
  objectKey: "aozora-history.json",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

const emptyLedger: LedgerData = {
  snapshots: [],
  transfers: [],
  statements: [],
  comments: {},
  deletions: {},
};

const remoteLedger: LedgerData = {
  snapshots: [
    { takenAt: 10, updatedAt: null, accounts: [{ id: "100", name: "お財布", balance: 100 }] },
  ],
  transfers: [],
  statements: [],
  comments: { "transfer:1": { text: "リモート", updatedAt: 0 } },
  deletions: {},
};

interface Request {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface FakeResponse {
  status: number;
  body?: string;
  etag?: string;
}

function headersOf(etag?: string): FetchResponse["headers"] {
  return { get: (name) => (name.toLowerCase() === "etag" ? (etag ?? null) : null) };
}

function fakeFetch(responses: FakeResponse[]): {
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
      headers: headersOf(res.etag),
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
      headers: headersOf(),
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
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: JSON.stringify(remoteLedger), etag: '"v1"' },
    ]);

    const remote = await client(fetchFn).download();

    // ETagは書き戻すときに、読んだ版から変わっていないことの条件に使う
    expect(remote).toStrictEqual({ data: remoteLedger, etag: '"v1"' });
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

    await client(fetchFn).upload(remoteLedger, null);

    expect(requests[0].method).toBe("PUT");
    expect(JSON.parse(requests[0].body!)).toStrictEqual(remoteLedger);
    expect(requests[0].headers["content-type"]).toBe("application/json");
  });

  it("読んだ版があれば、その版から変わっていないときだけ書くようIf-Matchを付ける", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200 }]);

    await client(fetchFn).upload(remoteLedger, { etag: '"v1"' });

    expect(requests[0].headers["if-match"]).toBe('"v1"');
  });

  it("R2に未作成だったなら、その間に他端末が作っていたら書かないようIf-None-Matchを付ける", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200 }]);

    await client(fetchFn).upload(remoteLedger, null);

    expect(requests[0].headers["if-none-match"]).toBe("*");
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
      statements: [],
      comments: remoteLedger.comments,
      deletions: {},
    });
    // ローカルへ反映
    await expect(store.loadLedger()).resolves.toStrictEqual(merged);
    // R2へ反映
    expect(requests[1].method).toBe("PUT");
    expect(JSON.parse(requests[1].body!)).toStrictEqual(merged);
  });

  it("読んでから書くまでに他端末が書いていたら、取り直してマージし直す", async () => {
    const store = new HistoryStore(fakeStorage());
    const localTransfer = {
      transferredAt: 5,
      from: { id: "100", name: "お財布" },
      to: { id: "101", name: "積立" },
      amount: 1000,
    };
    const otherTransfer = { ...localTransfer, transferredAt: 6, amount: 2000 };
    await store.recordTransfer(localTransfer);
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: JSON.stringify(emptyLedger), etag: '"v1"' },
      { status: 412 },
      {
        status: 200,
        body: JSON.stringify({ ...emptyLedger, transfers: [otherTransfer] }),
        etag: '"v2"',
      },
      { status: 200 },
    ]);

    const merged = await syncWithR2(store, client(fetchFn));

    expect(merged.transfers).toStrictEqual([localTransfer, otherTransfer]);
    expect(requests.map((request) => request.method)).toStrictEqual(["GET", "PUT", "GET", "PUT"]);
    expect(requests[3].headers["if-match"]).toBe('"v2"');
    expect(JSON.parse(requests[3].body!)).toStrictEqual(merged);
  });

  it("他端末との書き込みの重なりが続いたら、諦めて同期失敗にする", async () => {
    const store = new HistoryStore(fakeStorage(), () => 777);
    await store.recordTransfer({
      transferredAt: 5,
      from: { id: "100", name: "お財布" },
      to: { id: "101", name: "積立" },
      amount: 1000,
    });
    const conflicted: FakeResponse[] = [
      { status: 200, body: JSON.stringify(emptyLedger), etag: '"v1"' },
      { status: 412 },
    ];
    const { fetchFn, requests } = fakeFetch([...conflicted, ...conflicted, ...conflicted]);

    await expect(syncWithR2(store, client(fetchFn))).rejects.toThrow("重なり続けた");
    expect(requests).toHaveLength(6);
    await expect(store.loadLastSyncedAt()).resolves.toBeNull();
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

  it("R2がすでにマージ結果と同じならPUTしない", async () => {
    const store = new HistoryStore(fakeStorage());
    await store.replaceLedger(remoteLedger);
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: JSON.stringify(remoteLedger) }]);

    await syncWithR2(store, client(fetchFn));

    expect(requests.map((request) => request.method)).toStrictEqual(["GET"]);
  });

  it("ローカルがすでにマージ結果と同じなら台帳を書き直さない", async () => {
    const storage = fakeStorage();
    const store = new HistoryStore(storage);
    await store.replaceLedger(remoteLedger);
    const writtenKeys: string[] = [];
    const { set } = storage;
    storage.set = (items): Promise<void> => {
      writtenKeys.push(...Object.keys(items));
      return set(items);
    };
    const { fetchFn } = fakeFetch([{ status: 200, body: JSON.stringify(remoteLedger) }]);

    await syncWithR2(store, client(fetchFn));

    // 台帳の書き込みはstorage.onChangedを鳴らし、backgroundの自動同期をもう一度走らせる
    expect(
      writtenKeys.filter((key) => (LEDGER_KEYS as readonly string[]).includes(key)),
    ).toStrictEqual([]);
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

describe("pushToR2", () => {
  const localTransfer = {
    transferredAt: 5,
    from: { id: "100", name: "お財布" },
    to: { id: "101", name: "積立" },
    amount: 1000,
  };

  /** 一度同期を済ませ、R2 の版 "v1" を覚えた状態の store */
  async function syncedStore(): Promise<HistoryStore> {
    const store = new HistoryStore(fakeStorage());
    const { fetchFn } = fakeFetch([{ status: 404 }, { status: 200, etag: '"v1"' }]);
    await pushToR2(store, client(fetchFn));
    return store;
  }

  it("前回同期した版を知らなければ、読んでマージしてから書く", async () => {
    const store = new HistoryStore(fakeStorage());
    const { fetchFn, requests } = fakeFetch([{ status: 404 }, { status: 200, etag: '"v1"' }]);

    await pushToR2(store, client(fetchFn));

    expect(requests.map((request) => request.method)).toStrictEqual(["GET", "PUT"]);
  });

  it("前回同期した版を知っていれば、読まずにその版を条件に書く", async () => {
    const store = await syncedStore();
    await store.recordTransfer(localTransfer);
    const { fetchFn, requests } = fakeFetch([{ status: 200, etag: '"v2"' }]);

    await pushToR2(store, client(fetchFn));

    expect(requests.map((request) => request.method)).toStrictEqual(["PUT"]);
    expect(requests[0].headers["if-match"]).toBe('"v1"');
    expect(JSON.parse(requests[0].body!).transfers).toStrictEqual([localTransfer]);
  });

  it("書いた版を覚え、次はその版を条件に書く", async () => {
    const store = await syncedStore();
    await store.recordTransfer(localTransfer);
    await pushToR2(store, client(fakeFetch([{ status: 200, etag: '"v2"' }]).fetchFn));
    await store.recordTransfer({ ...localTransfer, transferredAt: 6 });
    const { fetchFn, requests } = fakeFetch([{ status: 200, etag: '"v3"' }]);

    await pushToR2(store, client(fetchFn));

    expect(requests[0].headers["if-match"]).toBe('"v2"');
  });

  it("前回同期したときから記録が変わっていなければ、何も送らない", async () => {
    const store = await syncedStore();
    const { fetchFn, requests } = fakeFetch([]);

    await pushToR2(store, client(fetchFn));

    expect(requests).toHaveLength(0);
  });

  it("その版の後に他端末が書いていたら、読んでマージし直す", async () => {
    const store = await syncedStore();
    await store.recordTransfer(localTransfer);
    const otherTransfer = { ...localTransfer, transferredAt: 6, amount: 2000 };
    const { fetchFn, requests } = fakeFetch([
      { status: 412 },
      {
        status: 200,
        body: JSON.stringify({ ...emptyLedger, transfers: [otherTransfer] }),
        etag: '"v2"',
      },
      { status: 200, etag: '"v3"' },
    ]);

    const merged = await pushToR2(store, client(fetchFn));

    expect(requests.map((request) => request.method)).toStrictEqual(["PUT", "GET", "PUT"]);
    expect(merged.transfers).toStrictEqual([localTransfer, otherTransfer]);
  });

  it("同期先の設定が変わったら、覚えた版を使わない", async () => {
    const store = await syncedStore();
    await store.recordTransfer(localTransfer);
    const { fetchFn, requests } = fakeFetch([{ status: 404 }, { status: 200 }]);

    await pushToR2(
      store,
      new R2Client({ ...config, bucket: "other" }, fetchFn, () => new Date(Date.UTC(2026, 6, 10))),
    );

    expect(requests.map((request) => request.method)).toStrictEqual(["GET", "PUT"]);
  });

  it("書いた版がわからなかったら、次は読んでから書く", async () => {
    const store = await syncedStore();
    await store.recordTransfer(localTransfer);
    await pushToR2(store, client(fakeFetch([{ status: 200 }]).fetchFn));
    await store.recordTransfer({ ...localTransfer, transferredAt: 6 });
    const { fetchFn, requests } = fakeFetch([{ status: 404 }, { status: 200 }]);

    await pushToR2(store, client(fetchFn));

    expect(requests.map((request) => request.method)).toStrictEqual(["GET", "PUT"]);
  });

  it("R2へ書かずに済んだ同期でも、読んだ版を覚える", async () => {
    const store = new HistoryStore(fakeStorage());
    await store.replaceLedger(remoteLedger);
    const unchanged = fakeFetch([
      { status: 200, body: JSON.stringify(remoteLedger), etag: '"v1"' },
    ]);
    await syncWithR2(store, client(unchanged.fetchFn));
    await store.recordTransfer(localTransfer);
    const { fetchFn, requests } = fakeFetch([{ status: 200, etag: '"v2"' }]);

    await pushToR2(store, client(fetchFn));

    expect(requests[0].headers["if-match"]).toBe('"v1"');
  });

  it("書き込みが済んだら最終同期時刻を記録する", async () => {
    const store = await syncedStore();
    await store.recordTransfer(localTransfer);

    await pushToR2(store, client(fakeFetch([{ status: 200, etag: '"v2"' }]).fetchFn));

    await expect(store.loadLastSyncedAt()).resolves.not.toBeNull();
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
