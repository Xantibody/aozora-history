import type { StatementEntry } from "./statement.ts";

/**
 * つかいわけ口座の「入出金の設定」。ATM・デビット・口座振替などの入出金を、
 * どのつかいわけ口座で受けるかの振り分け。値はつかいわけ口座のID。
 *
 * 取れるのは今の設定だけで、過去に変えた履歴は無い。明細がどの口座の動きかの
 * 決め手には使うが、それだけで口座を言い切らない(設定を変える前の明細もあるため)
 */
export interface TranMapping {
  atmWithdrawal: string | null;
  atmDeposit: string | null;
  debitWithdrawal: string | null;
  directDebit: string | null;
  sweepDebit: string | null;
  fee: string | null;
  interest: string | null;
}

/**
 * 摘要の先頭に取引の種類が付く明細。振込・給与・ペイジーは設定の項目に無く
 * (振込の出金口座は振込ごとに選ぶ)、設定では決めない
 */
const KNOWN_KINDS = new Set(["ATM", "振込", "給与", "普通預金", "PE"]);

/** 摘要の先頭の語。半角・全角のどちらの空白でも区切る */
function kindOf(remark: string): string {
  return remark.trim().split(/\s/u)[0] ?? "";
}

/**
 * 設定のとおりなら、この代表口座の明細を受けたはずのつかいわけ口座。
 *
 * 口座振替の摘要は引落先の名前だけで、種類を示す語が付かない。そこで種類の
 * 分からない出金を口座振替とみなす。デビットや証券コネクトの摘要の形は
 * まだ見たことがなく、それらもここに入る。外れうる推定なので、呼び出し側は
 * 残高の動きで裏付けが取れたときだけ使うこと
 */
export function mappedAccount(mapping: TranMapping, statement: StatementEntry): string | null {
  const kind = kindOf(statement.remark);
  if (kind === "ATM") {
    return statement.amount < 0 ? mapping.atmWithdrawal : mapping.atmDeposit;
  }
  if (kind === "普通預金" && statement.remark.includes("利息")) {
    return mapping.interest;
  }
  return KNOWN_KINDS.has(kind) || statement.amount >= 0 ? null : mapping.directDebit;
}
