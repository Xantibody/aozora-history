export interface SubAccount {
  id: string;
  name: string;
  balance: number;
}

export interface AccountsSnapshot {
  accounts: SubAccount[];
  updatedAt: string | null;
}

export interface AccountRef {
  id: string;
  name: string;
}

export interface TransferInput {
  from: AccountRef;
  to: AccountRef;
  amount: number;
}

/** 振替フォームのselectは出金口座・入金口座の2つ */
const TRANSFER_SELECT_COUNT = 2;

const ACCOUNT_DETAILS_PATTERN = /\/sp-account\/details\/(?<accountId>\d+)/u;

export function parseYen(text: string): number | null {
  const digits = text.replaceAll(/[¥,\s]/gu, "");
  if (!/^\d+$/u.test(digits)) {
    return null;
  }
  return Number(digits);
}

function parseAccountInfo(info: Element): SubAccount | null {
  const id = info.querySelector("a")?.href.match(ACCOUNT_DETAILS_PATTERN)?.groups?.accountId;
  const [nameEl, balanceEl] = info.querySelectorAll("div > span");
  const name = nameEl?.textContent?.trim();
  const balance = parseYen(balanceEl?.querySelector("span")?.textContent ?? "");
  if (id === undefined || !name || balance === null) {
    return null;
  }
  return { id, name, balance };
}

function parseUpdatedAt(doc: Document): string | null {
  const label = [...doc.querySelectorAll("small")].find((el) =>
    el.textContent?.includes("最終更新日時"),
  );
  return label?.querySelector("span")?.textContent?.trim() ?? null;
}

export function parseAccountsPage(doc: Document): AccountsSnapshot | null {
  const infos = [...doc.querySelectorAll(".account-block .account-info")];
  if (infos.length === 0) {
    return null;
  }

  const accounts: SubAccount[] = [];
  for (const info of infos) {
    const account = parseAccountInfo(info);
    if (account === null) {
      return null;
    }
    accounts.push(account);
  }

  return { accounts, updatedAt: parseUpdatedAt(doc) };
}

function selectedAccount(select: HTMLSelectElement): AccountRef | null {
  const [option] = select.selectedOptions;
  if (option === undefined) {
    return null;
  }
  return { id: option.value, name: option.textContent?.trim() ?? "" };
}

export function parseTransferForm(doc: Document): TransferInput | null {
  const selects = doc.querySelectorAll<HTMLSelectElement>(".exchange-accounts select");
  const amountInput = doc.querySelector<HTMLInputElement>(".exchange-accounts input.input-amount");
  if (selects.length !== TRANSFER_SELECT_COUNT || amountInput === null) {
    return null;
  }

  const from = selectedAccount(selects[0]);
  const to = selectedAccount(selects[1]);
  const amount = parseYen(amountInput.value);
  if (from === null || to === null || amount === null || from.id === to.id) {
    return null;
  }

  return { from, to, amount };
}
