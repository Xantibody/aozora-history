/**
 * 銀行APIの取り込みは、ログイン中のタブで裏側で走る。失敗しても画面には
 * 何も出ないため、銀行側の仕様変更で静かに取れなくなっても気づけない。
 *
 * ここでは最後の取り込みの結果を、設定画面に出せる形で持つ。
 */

/** 1つのAPIの取り込み結果 */
export interface CollectStat {
  /** 銀行が返した件数。nullは取得できなかった(形が違う・ログイン切れなど) */
  count: number | null;
  /** 記録に変化があって保存したか */
  saved: boolean;
}

export interface CollectReport {
  /** 取り込みを試みた時刻 */
  at: number;
  /** 間隔が空いていないなどで問い合わせ自体を見送った */
  skipped: boolean;
  balances: CollectStat;
  statements: CollectStat;
  accountStatements: CollectStat;
  autoTransfers: CollectStat;
  /** storageに入れるため、例外はメッセージだけにする */
  errors: string[];
}

export function errorMessages(errors: unknown[]): string[] {
  return errors.map((error) => (error instanceof Error ? error.message : String(error)));
}

/** 設定画面に出す1行の説明。件数が取れたか、保存まで進んだかが分かる形にする */
export function describeStat(stat: CollectStat): string {
  if (stat.count === null) {
    return "取得できず";
  }
  return stat.saved ? `${stat.count}件 · 記録を更新` : `${stat.count}件 · 変化なし`;
}
