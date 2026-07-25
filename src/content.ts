import { setupContentScript } from "./content-script.ts";
import { BankApiClient, type BankFetchLike } from "./infrastructure/bank-api.ts";
import { collectFromBank } from "./infrastructure/collector.ts";
import { HistoryStore } from "./infrastructure/storage.ts";

const fetchFn: BankFetchLike = (request) =>
  fetch(request.url, {
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
  });

const store = new HistoryStore(browser.storage.local);
// ログイン中のタブのcookieをそのまま使うので、拡張側に認証情報を持たなくてよい
const client = new BankApiClient(fetchFn, () => document.cookie);

setupContentScript(document, store, Date.now, () => collectFromBank(store, client));
