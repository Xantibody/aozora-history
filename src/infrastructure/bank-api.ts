import {
  parseAutoTransfers,
  parseOrdinaryStatement,
  parseSpAccountBalances,
  parseSpAccountStatement,
} from "../domain/api-parser.ts";
import type { AccountsSnapshot } from "../domain/parser.ts";
import type { AutoTransferSetting } from "../domain/auto-transfer.ts";
import type { StatementEntry } from "../domain/statement.ts";
import { describeJson } from "../domain/diagnostics.ts";

const BANK_ORIGIN = "https://bank.gmo-aozora.com";

/** 銀行サイトのSPAが叩いているAPIのベースパス */
const API_BASE = "/v1/";

/** 明細の並び順コード。2 = 降順(新しい順) */
const ORDER_DESC = "2";

/** つかいわけ口座の明細は通貨を指定して取る。この拡張が扱うのは円普通預金だけ */
const JPY = "JPY";

/** 定額自動振替の並び替えキー。1 = 登録日 */
const SORT_BY_REGISTERED_DATE = "1";

/** JSONでない応答をエラーに載せる長さ。ログイン画面のHTMLだと分かれば十分 */
const BODY_EXCERPT = 120;

/** APIが1回に返せる明細の上限。銀行サイトの表示件数の選択肢に合わせている */
const MAX_STATEMENT_LIMIT = 100;

export interface BankRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: "include";
}

interface BankFetchResponse {
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

  /**
   * 失敗はすべて例外にする。nullを返して黙って諦めると、取り込みが動いて
   * いないのか銀行側の応答が変わったのかを後から切り分けられない
   */
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
      throw new Error(`GET ${path} が HTTP ${res.status}`);
    }
    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      // ログイン切れでログイン画面のHTMLが返るなど
      throw new Error(`GET ${path} がJSONを返しませんでした: ${body.slice(0, BODY_EXCERPT)}`);
    }
  }

  /** 応答は取れたが、この拡張が読める形ではなかった場合 */
  private static unexpected(path: string, json: unknown): Error {
    return new Error(`GET ${path} の応答が想定と違います: ${describeJson(json)}`);
  }

  /** つかいわけ口座の現在残高 */
  public async spAccountBalances(): Promise<AccountsSnapshot> {
    const path = "balances/sp-accounts";
    const json = await this.get(path);
    const parsed = parseSpAccountBalances(json);
    if (parsed === null) {
      throw BankApiClient.unexpected(path, json);
    }
    return parsed;
  }

  /** 代表口座(普通預金)の入出金明細を新しい順に取る */
  public async ordinaryStatement(limit: number): Promise<StatementEntry[]> {
    const path = "ordinary-deposits/statement";
    const json = await this.get(path, {
      limit: String(Math.min(limit, MAX_STATEMENT_LIMIT)),
      offset: "0",
      depositOrderType: ORDER_DESC,
    });
    const parsed = parseOrdinaryStatement(json);
    if (parsed === null) {
      throw BankApiClient.unexpected(path, json);
    }
    return parsed;
  }

  /**
   * つかいわけ口座(円普通預金)の入出金明細を新しい順に取る。
   * 銀行サイトの画面 S015「つかいわけ口座 入出金明細」と同じパラメータで呼ぶ。
   * この画面はメニューからの動線が公開されていないが、APIとルートは生きている
   */
  public async spAccountStatement(accountId: string, limit: number): Promise<StatementEntry[]> {
    const path = "sp-accounts/ordinary-deposits-statement";
    const json = await this.get(path, {
      spAccountId: accountId,
      currency: JPY,
      limit: String(Math.min(limit, MAX_STATEMENT_LIMIT)),
      offset: "0",
      depositOrderType: ORDER_DESC,
    });
    const parsed = parseSpAccountStatement(json, accountId);
    if (parsed === null) {
      throw BankApiClient.unexpected(path, json);
    }
    return parsed;
  }

  /**
   * つかいわけ口座の定額自動振替の設定一覧。
   * 画面「つかいわけ口座 定額自動振替」と同じ条件で呼ぶ。sortKey と
   * depositOrderType は表示の並び順でしかないが、省くと弾かれることがあるため送る
   */
  public async autoTransfers(limit: number): Promise<AutoTransferSetting[]> {
    const path = "sp-accounts/auto-transfer";
    const json = await this.get(path, {
      limit: String(Math.min(limit, MAX_STATEMENT_LIMIT)),
      offset: "0",
      sortKey: SORT_BY_REGISTERED_DATE,
      depositOrderType: ORDER_DESC,
    });
    const parsed = parseAutoTransfers(json);
    if (parsed === null) {
      throw BankApiClient.unexpected(path, json);
    }
    return parsed;
  }
}
