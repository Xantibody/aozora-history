import { HistoryStore, LAST_COLLECTED_KEY } from "./infrastructure/storage.ts";
import { BankApiClient } from "./infrastructure/bank-api.ts";
import type { BankFetchLike } from "./infrastructure/bank-api.ts";
import type { CollectReport } from "./domain/diagnostics.ts";
import { buildStamp } from "./build.ts";
import { collectFromBank } from "./infrastructure/collector.ts";
import { errorMessages } from "./domain/diagnostics.ts";
import { setupContentScript } from "./content-script.ts";

/**
 * content.fetch はページのプリンシパルでリクエストを出すため、ログイン中の
 * タブとまったく同じセッションになる(SameSite cookie も落ちない)。
 * 提供されない環境や、サンドボックス側のオブジェクトを渡せずに失敗した場合は
 * content script 自身の fetch に落とす
 */
const pageFetch = typeof content === "object" ? content?.fetch : undefined;

const fetchFn: BankFetchLike = async (request) => {
  const init = {
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
  };
  if (pageFetch !== undefined) {
    try {
      return await pageFetch(request.url, init);
    } catch {
      // noop: 拡張側の fetch で取り直す
    }
  }
  return fetch(request.url, init);
};

const store = new HistoryStore(browser.storage.local);
// ログイン中のタブのcookieをそのまま使うので、拡張側に認証情報を持たなくてよい
const client = new BankApiClient(fetchFn, () => document.cookie);

/**
 * 取り込みは裏で走るため、失敗しても画面には何も出ない。銀行側の仕様変更で
 * 静かに取れなくなったときに原因を追えるよう、結果を残す。
 *
 * 見送った回も残す。残さないと「間隔が空いていないだけ」なのか
 * 「content script が動いていない」のかを、後から区別できない
 */
async function collect(): Promise<unknown> {
  const result = await collectFromBank(store, client);
  const report: CollectReport = {
    at: Date.now(),
    build: buildStamp,
    ...result,
    errors: errorMessages(result.errors),
  };
  await store.recordLastCollect(report);
  if (await store.loadDebugMode()) {
    // eslint-disable-next-line no-console -- デバッグモードを入れている間だけ
    const log = report.errors.length === 0 ? console.info : console.warn;
    log("[aozora-history] 銀行APIの取り込み", report);
  }
  return report;
}

void setupContentScript(document, store, { now: Date.now, collect });

/** 取得時刻がnullに戻された = 設定画面の「今すぐ取り込む」が押された合図 */
function isCollectRequest(change: unknown): boolean {
  return (
    typeof change === "object" &&
    change !== null &&
    (change as { newValue?: unknown }).newValue === null
  );
}

/**
 * 「今すぐ取り込む」は、取得時刻の記録を消すことで合図にしている。
 * 銀行サイトのタブが開いていれば、間隔を待たずにその場で取りに行く
 */
function watchCollectRequests(): void {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && isCollectRequest(changes[LAST_COLLECTED_KEY])) {
      void collect();
    }
  });
}

void watchCollectRequests();
