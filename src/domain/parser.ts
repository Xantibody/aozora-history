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

export function parseYen(text: string): number | null {
  const digits = text.replace(/[¥,\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

export function parseAccountsPage(doc: Document): AccountsSnapshot | null {
  const infos = [...doc.querySelectorAll(".account-block .account-info")];
  if (infos.length === 0) return null;

  const accounts: SubAccount[] = [];
  for (const info of infos) {
    const id = info.querySelector("a")?.href.match(/\/sp-account\/details\/(\d+)/)?.[1];
    const [nameEl, balanceEl] = info.querySelectorAll("div > span");
    const name = nameEl?.textContent?.trim();
    const balance = parseYen(balanceEl?.querySelector("span")?.textContent ?? "");
    if (id === undefined || !name || balance === null) return null;
    accounts.push({ id, name, balance });
  }

  const updatedAtLabel = [...doc.querySelectorAll("small")].find((el) =>
    el.textContent?.includes("最終更新日時"),
  );
  const updatedAt = updatedAtLabel?.querySelector("span")?.textContent?.trim() ?? null;

  return { accounts, updatedAt };
}

function selectedAccount(select: HTMLSelectElement): AccountRef | null {
  const option = select.selectedOptions[0];
  if (option === undefined) return null;
  return { id: option.value, name: option.textContent?.trim() ?? "" };
}

export function parseTransferForm(doc: Document): TransferInput | null {
  const selects = doc.querySelectorAll<HTMLSelectElement>(".exchange-accounts select");
  const amountInput = doc.querySelector<HTMLInputElement>(".exchange-accounts input.input-amount");
  if (selects.length !== 2 || amountInput === null) return null;

  const from = selectedAccount(selects[0]);
  const to = selectedAccount(selects[1]);
  const amount = parseYen(amountInput.value);
  if (from === null || to === null || amount === null) return null;
  if (from.id === to.id) return null;

  return { from, to, amount };
}
