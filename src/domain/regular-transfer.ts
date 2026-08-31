import type { StatementEntry } from "./statement.ts";

/**
 * 定額自動振込の契約。銀行サイトの「振込・支払 > 定額自動振込一覧」で
 * 登録した、毎月◯日などに外部の口座へ自動的に出ていく設定を指す。
 *
 * 実行の履歴ではなく設定なので、これ自体は記録にならない。取り込んだ明細が
 * 「毎月の決まった振込」なのか、その月だけの振込なのかを言い分けるために使う
 * (つかいわけ口座の定額自動振替に対する auto-transfer.ts と同じ立ち位置)
 */
export interface RegularTransferSetting {
  id: string;
  /** 受取人名カナ。実行されると、この名前がそのまま明細の摘要に入る */
  payeeName: string;
  /** 振込先の銀行名。摘要ではカナに略されるため、画面に出すのはこちら */
  bankName: string;
  amount: number;
  /** 契約中か。休止・解約の契約は実行されない */
  active: boolean;
  /** 銀行側で付けた用途のラベル(「家賃－投資」など)。未設定なら空 */
  groupName: string;
}

/**
 * 空白を落とした形。摘要は「振込 ラクテン アイザワ　リユウ」のように
 * 語の区切りに半角・全角の空白が入り、契約側の受取人名と揃わないことがある
 */
function withoutSpaces(text: string): string {
  return text.replaceAll(/\s/gu, "");
}

/**
 * この明細を出した定額自動振込の契約。金額が一致し、摘要に受取人名が
 * 入っているものを探す。
 *
 * 出金だけを見る。同じ名前・同じ額の入金があっても、それは振込の実行ではない
 */
export function matchingRegularTransfer(
  settings: RegularTransferSetting[],
  statement: StatementEntry,
): RegularTransferSetting | null {
  if (statement.amount >= 0) {
    return null;
  }
  const remark = withoutSpaces(statement.remark);
  const found = settings.find(
    (setting) =>
      setting.active &&
      setting.payeeName !== "" &&
      setting.amount === Math.abs(statement.amount) &&
      remark.includes(withoutSpaces(setting.payeeName)),
  );
  return found ?? null;
}
