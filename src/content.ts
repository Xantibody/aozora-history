import { BankApiClient } from "./infrastructure/bank-api.ts";
import type { BankFetchLike } from "./infrastructure/bank-api.ts";
import { HistoryStore } from "./infrastructure/storage.ts";
import { collectFromBank } from "./infrastructure/collector.ts";
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
 * 静かに取れなくなったときに原因を追えるよう、結果をコンソールに残す。
 *
 * 見送った回も出す。出さないと「間隔が空いていないだけ」なのか
 * 「content script が動いていない」のかが、コンソールから区別できない
 */
async function collect(): Promise<unknown> {
  const result = await collectFromBank(store, client);
  // eslint-disable-next-line no-console -- 裏で走る処理の唯一の手掛かり
  const log = result.errors.length === 0 ? console.info : console.warn;
  log("[aozora-history] 銀行APIの取り込み", result);
  return result;
}

void setupContentScript(document, store, { now: Date.now, collect });
