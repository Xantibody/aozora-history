import { setupContentScript } from "./content-script.ts";
import { BankApiClient, type BankFetchLike } from "./infrastructure/bank-api.ts";
import { collectFromBank } from "./infrastructure/collector.ts";
import { HistoryStore } from "./infrastructure/storage.ts";

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

setupContentScript(document, store, Date.now, () => collectFromBank(store, client));
