import type { AccountRef } from "./parser.ts";
import type { TransferRecord } from "./ledger.ts";

/**
 * つかいわけ口座の定額自動振替の設定。銀行サイトの
 * 「つかいわけ口座 > 定額自動振替」で登録した、毎月◯日などに口座間で
 * 自動的に移る設定を指す。
 *
 * 実行の履歴ではなく設定なので、これ自体は記録にならない。残高の差額から
 * 拾い直した口座間の移動が「たまたま打ち消し合っただけ」ではなく設定どおりの
 * 振替だと確かめるために使う
 */
export interface AutoTransferSetting {
  id: string;
  from: AccountRef;
  to: AccountRef;
  amount: number;
}

/** 出金口座・入金口座・金額が設定どおりの移動か */
export function matchesAutoTransfer(
  settings: AutoTransferSetting[],
  transfer: TransferRecord,
): boolean {
  return settings.some(
    (setting) =>
      setting.from.id === transfer.from.id &&
      setting.to.id === transfer.to.id &&
      setting.amount === transfer.amount,
  );
}
