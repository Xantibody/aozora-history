import { sha256Hex, signRequest } from "./sigv4.ts";
import type { HistoryStore } from "./storage.ts";
import type { LedgerData } from "../domain/merge.ts";
import { mergeLedgers } from "../domain/merge.ts";
import { parseLedgerJson } from "../domain/serialization.ts";

export interface SyncConfig {
  accountId: string;
  bucket: string;
  objectKey: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const DEFAULT_OBJECT_KEY = "aozora-history.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function parseJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み込めませんでした");
  }
}

/** エクスポートした同期設定JSONを検証しつつ読み込む */
export function parseSyncConfigJson(text: string): SyncConfig {
  const parsed = parseJsonOrThrow(text);
  if (!isRecord(parsed)) {
    throw new Error("同期設定の形式が正しくありません");
  }
  const { accountId, bucket, objectKey, accessKeyId, secretAccessKey } = parsed;
  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(bucket) ||
    !isNonEmptyString(accessKeyId) ||
    !isNonEmptyString(secretAccessKey)
  ) {
    throw new Error("同期設定の形式が正しくありません");
  }
  return {
    accountId,
    bucket,
    objectKey: isNonEmptyString(objectKey) ? objectKey : DEFAULT_OBJECT_KEY,
    accessKeyId,
    secretAccessKey,
  };
}

export interface FetchResponse {
  status: number;
  ok: boolean;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}

/** R2上の台帳と、それを読んだときの版(ETag) */
export interface RemoteLedger {
  data: LedgerData;
  etag: string | null;
}

const HTTP_NOT_FOUND = 404;
const HTTP_PRECONDITION_FAILED = 412;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

/**
 * 読んだ版から変わっていないときだけ書く条件。他端末の書き込みを上書きで消さないため。
 * ETagが取れなかったときは条件を付けられないので、従来どおり上書きする
 */
function preconditionOf(base: RemoteLedger | null): Record<string, string> {
  if (base === null) {
    return { "if-none-match": "*" };
  }
  return base.etag === null ? {} : { "if-match": base.etag };
}

/** conflict: 読んだ版の後に他端末が書いていたため、書かなかった */
type UploadResult = "stored" | "conflict";

interface RequestOptions {
  body?: string;
  headers?: Record<string, string>;
}

export class R2Client {
  private readonly config: SyncConfig;

  private readonly fetchFn: FetchLike;

  private readonly now: () => Date;

  public constructor(config: SyncConfig, fetchFn: FetchLike, now: () => Date) {
    this.config = config;
    this.fetchFn = fetchFn;
    this.now = now;
  }

  private async request(method: string, options: RequestOptions = {}): Promise<FetchResponse> {
    const { body, headers: extraHeaders } = options;
    const { accountId, bucket, objectKey } = this.config;
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${objectKey}`);
    const payloadHash = await sha256Hex(body ?? "");
    const headers = await signRequest({
      method,
      url,
      headers: {
        "x-amz-content-sha256": payloadHash,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extraHeaders,
      },
      payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: "auto",
      service: "s3",
      date: this.now(),
    });
    return this.fetchFn(url.toString(), { method, headers, body });
  }

  /** 同期データが未作成(404)ならnullを返す */
  public async download(): Promise<RemoteLedger | null> {
    const res = await this.request("GET");
    if (res.status === HTTP_NOT_FOUND) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`R2からの取得に失敗しました (HTTP ${res.status})`);
    }
    // オブジェクトキーの指定ミスなどで別のデータが置かれていても、
    // マージ経由でローカルの記録を壊さないよう検証してから取り込む
    return { data: parseLedgerJson(await res.text()), etag: res.headers.get("etag") };
  }

  /** base は書き戻しの元にした版。R2がその版のままのときだけ書く */
  public async upload(data: LedgerData, base: RemoteLedger | null): Promise<UploadResult> {
    const res = await this.request("PUT", {
      body: JSON.stringify(data),
      headers: preconditionOf(base),
    });
    if (res.status === HTTP_PRECONDITION_FAILED) {
      return "conflict";
    }
    if (!res.ok) {
      throw new Error(`R2への保存に失敗しました (HTTP ${res.status})`);
    }
    return "stored";
  }
}

// AIDEV-NOTE: 順序まで含めた文字列比較。マージは並びを揃えるので同じ内容なら一致し、
// 取りこぼしても余計な書き込みが1回増えるだけで記録は壊れない
function sameLedger(left: LedgerData, right: LedgerData): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface SyncSides {
  merged: LedgerData;
  latest: LedgerData;
  remote: RemoteLedger | null;
}

/** マージ結果を、それと食い違う側にだけ書き戻す */
async function writeBack(
  store: HistoryStore,
  client: R2Client,
  { merged, latest, remote }: SyncSides,
): Promise<UploadResult> {
  // 書き込みはstorage.onChangedを鳴らし、backgroundの自動同期をもう一度走らせる
  if (!sameLedger(merged, latest)) {
    await store.replaceLedger(merged);
  }
  // 同じ内容の書き直しはClass A操作を消費するだけなので省く
  if (remote === null || !sameLedger(merged, remote.data)) {
    return client.upload(merged, remote);
  }
  return "stored";
}

/** 他端末の同期と重なり続けたときに諦めるまでの試行回数 */
const MAX_SYNC_ATTEMPTS = 3;

/** R2を読み、ローカルとマージする */
async function readAndMerge(store: HistoryStore, client: R2Client): Promise<SyncSides> {
  const local = await store.loadLedger();
  const remote = await client.download();
  const remoteMerged = remote === null ? local : mergeLedgers(local, remote.data);
  // ダウンロード待ちの間に増えた記録をreplaceLedgerで消さないよう、最新のローカルと再マージする
  const latest = await store.loadLedger();
  return { merged: mergeLedgers(remoteMerged, latest), latest, remote };
}

async function syncAttempt(
  store: HistoryStore,
  client: R2Client,
  attemptsLeft: number,
): Promise<LedgerData> {
  const sides = await readAndMerge(store, client);
  const result = await writeBack(store, client, sides);
  if (result === "conflict") {
    if (attemptsLeft <= 1) {
      throw new Error("他端末の同期と重なり続けたため、R2へ保存できませんでした");
    }
    // 他端末の書き込みを取り込み直す。ローカルへ書いた分は和集合なので次の回でも残る
    return syncAttempt(store, client, attemptsLeft - 1);
  }
  await store.markSynced();
  return sides.merged;
}

/** ローカルとR2をマージし、両方へ書き戻す */
export function syncWithR2(store: HistoryStore, client: R2Client): Promise<LedgerData> {
  return syncAttempt(store, client, MAX_SYNC_ATTEMPTS);
}
