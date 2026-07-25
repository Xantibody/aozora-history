import { parseOrdinaryStatement, parseSpAccountBalances } from "../domain/api-parser.ts";
import type { AccountsSnapshot } from "../domain/parser.ts";
import type { StatementEntry } from "../domain/statement.ts";

export const BANK_ORIGIN = "https://bank.gmo-aozora.com";

/** 銀行サイトのSPAが叩いているAPIのベースパス */
const API_BASE = "/v1/";

/** 明細の並び順コード。2 = 降順(新しい順) */
const ORDER_DESC = "2";

/** APIが1回に返せる明細の上限。銀行サイトの表示件数の選択肢に合わせている */
export const MAX_STATEMENT_LIMIT = 100;

export interface BankRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: "include";
}

export interface BankFetchResponse {
  ok: boolean;
  status: number;
  /**
   * ページ側のfetchで取ると本文のオブジェクトがページのコンパートメントに
   * できてしまうため、文字列で受け取って拡張側でJSONに直す
   */
  text: () => Promise<string>;
}

export type BankFetchLike = (request: BankRequest) => Promise<BankFetchResponse>;

const XSRF_COOKIE = /(?:^|;\s*)XSRF-TOKEN=(?<token>[^;]*)/u;

/** 銀行サイト本体と同じく、cookieのXSRFトークンをヘッダーに載せ替える */
function xsrfToken(cookie: string): string | null {
  const raw = XSRF_COOKIE.exec(cookie)?.groups?.token;
  if (raw === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * ログイン済みのタブと同じセッション(cookie)で、銀行サイトのAPIを直接叩く。
 * 画面を開かなくても残高や明細を取れるので、つかいわけ口座の一覧を
 * 経由せずに振替へ移動しても記録を残せる
 */
export class BankApiClient {
  private readonly fetchFn: BankFetchLike;

  private readonly cookie: () => string;

  private readonly origin: string;

  public constructor(fetchFn: BankFetchLike, cookie: () => string, origin: string = BANK_ORIGIN) {
    this.fetchFn = fetchFn;
    this.cookie = cookie;
    this.origin = origin;
  }

  private async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const query = params === undefined ? "" : `?${new URLSearchParams(params).toString()}`;
    const token = xsrfToken(this.cookie());
    const res = await this.fetchFn({
      url: `${this.origin}${API_BASE}${path}${query}`,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token === null ? {} : { "X-XSRF-TOKEN": token }),
      },
      // 拡張から出すリクエストでもタブのセッションcookieを載せる
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`銀行APIの取得に失敗しました (HTTP ${res.status})`);
    }
    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      // ログイン切れでログイン画面のHTMLが返るなど。記録は増やさず次の機会に取り直す
      return null;
    }
  }

  /** つかいわけ口座の現在残高。つかいわけ口座を使っていなければnull */
  public async spAccountBalances(): Promise<AccountsSnapshot | null> {
    const json = await this.get("balances/sp-accounts");
    return parseSpAccountBalances(json);
  }

  /** 代表口座(普通預金)の入出金明細を新しい順に取る */
  public async ordinaryStatement(limit: number): Promise<StatementEntry[] | null> {
    const json = await this.get("ordinary-deposits/statement", {
      limit: String(Math.min(limit, MAX_STATEMENT_LIMIT)),
      offset: "0",
      depositOrderType: ORDER_DESC,
    });
    return parseOrdinaryStatement(json);
  }
}
