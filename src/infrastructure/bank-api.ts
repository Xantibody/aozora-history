import { parseOrdinaryStatement, parseSpAccountBalances } from "../domain/api-parser.ts";
import type { StatementEntry } from "../domain/ledger.ts";
import type { AccountsSnapshot } from "../domain/parser.ts";

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
  json(): Promise<unknown>;
}

export type BankFetchLike = (request: BankRequest) => Promise<BankFetchResponse>;

/** 銀行サイト本体と同じく、cookieのXSRFトークンをヘッダーに載せ替える */
function xsrfToken(cookie: string): string | null {
  const match = /(?:^|;\s*)XSRF-TOKEN=([^;]*)/.exec(cookie);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * ログイン済みのタブと同じセッション(cookie)で、銀行サイトのAPIを直接叩く。
 * 画面を開かなくても残高や明細を取れるので、つかいわけ口座の一覧を
 * 経由せずに振替へ移動しても記録を残せる
 */
export class BankApiClient {
  constructor(
    private readonly fetchFn: BankFetchLike,
    private readonly cookie: () => string,
    private readonly origin: string = BANK_ORIGIN,
  ) {}

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
    if (!res.ok) throw new Error(`銀行APIの取得に失敗しました (HTTP ${res.status})`);
    return res.json();
  }

  /** つかいわけ口座の現在残高。つかいわけ口座を使っていなければnull */
  async spAccountBalances(): Promise<AccountsSnapshot | null> {
    return parseSpAccountBalances(await this.get("balances/sp-accounts"));
  }

  /** 代表口座(普通預金)の入出金明細を新しい順に取る */
  async ordinaryStatement(limit: number): Promise<StatementEntry[] | null> {
    return parseOrdinaryStatement(
      await this.get("ordinary-deposits/statement", {
        limit: String(Math.min(limit, MAX_STATEMENT_LIMIT)),
        offset: "0",
        depositOrderType: ORDER_DESC,
      }),
    );
  }
}
