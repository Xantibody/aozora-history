import { type LedgerData, mergeLedgers } from "../domain/merge.ts";
import { sha256Hex, signRequest } from "./sigv4.ts";
import type { HistoryStore } from "./storage.ts";

export interface SyncConfig {
  accountId: string;
  bucket: string;
  objectKey: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface FetchResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export class R2Client {
  constructor(
    private readonly config: SyncConfig,
    private readonly fetchFn: FetchLike,
    private readonly now: () => Date,
  ) {}

  private async request(method: string, body?: string): Promise<FetchResponse> {
    const { accountId, bucket, objectKey } = this.config;
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${objectKey}`);
    const payloadHash = await sha256Hex(body ?? "");
    const headers = await signRequest({
      method,
      url,
      headers: {
        "x-amz-content-sha256": payloadHash,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
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
  async download(): Promise<LedgerData | null> {
    const res = await this.request("GET");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2からの取得に失敗しました (HTTP ${res.status})`);
    return JSON.parse(await res.text()) as LedgerData;
  }

  async upload(data: LedgerData): Promise<void> {
    const res = await this.request("PUT", JSON.stringify(data));
    if (!res.ok) throw new Error(`R2への保存に失敗しました (HTTP ${res.status})`);
  }
}

/** ローカルとR2をマージし、両方へ書き戻す */
export async function syncWithR2(store: HistoryStore, client: R2Client): Promise<LedgerData> {
  const local = await store.loadLedger();
  const remote = await client.download();
  const merged = remote === null ? local : mergeLedgers(local, remote);
  await store.replaceLedger(merged);
  await client.upload(merged);
  return merged;
}
