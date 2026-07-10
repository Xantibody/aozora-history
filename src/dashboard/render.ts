import {
  type BalanceSnapshot,
  balanceSeries,
  latestSnapshot,
  sortTransfersDesc,
  type TransferRecord,
} from "../domain/ledger.ts";

export function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(className: string, title: string): HTMLElement {
  const node = el("section", className);
  node.append(el("h2", undefined, title));
  return node;
}

function table(headers: string[], rows: string[][]): HTMLElement {
  const tableEl = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(...headers.map((h) => el("th", undefined, h)));
  thead.append(headRow);

  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    tr.append(...row.map((cell) => el("td", undefined, cell)));
    tbody.append(tr);
  }

  tableEl.append(thead, tbody);
  return tableEl;
}

function balancesSection(snapshot: BalanceSnapshot): HTMLElement {
  const node = section("balances", "現在の残高");
  const list = el("div", "balance-cards");
  for (const account of snapshot.accounts) {
    const card = el("div", "balance-card");
    card.append(el("div", "account-name", account.name));
    card.append(el("div", "account-balance", formatYen(account.balance)));
    list.append(card);
  }
  const total = snapshot.accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalCard = el("div", "balance-card total");
  totalCard.append(el("div", "account-name", "合計"));
  totalCard.append(el("div", "account-balance", formatYen(total)));
  list.append(totalCard);

  node.append(list);
  node.append(
    el("p", "updated-at", `最終更新: ${snapshot.updatedAt ?? formatDateTime(snapshot.takenAt)}`),
  );
  return node;
}

function transfersSection(transfers: TransferRecord[]): HTMLElement {
  const node = section("transfers", "振替履歴");
  if (transfers.length === 0) {
    node.append(el("p", "empty", "まだ記録がありません"));
    return node;
  }
  const rows = sortTransfersDesc(transfers).map((t) => [
    formatDateTime(t.transferredAt),
    t.from.name,
    t.to.name,
    formatYen(t.amount),
  ]);
  node.append(table(["日時", "出金口座", "入金口座", "金額"], rows));
  return node;
}

function snapshotsSection(snapshots: BalanceSnapshot[]): HTMLElement {
  const node = section("snapshots", "残高推移");
  if (snapshots.length === 0) {
    node.append(el("p", "empty", "まだ記録がありません"));
    return node;
  }
  const columns = balanceSeries(snapshots);
  const rows = snapshots.toReversed().map((snapshot) => {
    const byId = new Map(snapshot.accounts.map((a) => [a.id, a.balance]));
    return [
      formatDateTime(snapshot.takenAt),
      ...columns.map((c) => {
        const balance = byId.get(c.id);
        return balance === undefined ? "—" : formatYen(balance);
      }),
    ];
  });
  node.append(table(["記録日時", ...columns.map((c) => c.name)], rows));
  return node;
}

export function renderDashboard(
  root: HTMLElement,
  snapshots: BalanceSnapshot[],
  transfers: TransferRecord[],
): void {
  root.replaceChildren();

  if (snapshots.length === 0 && transfers.length === 0) {
    root.append(el("p", "empty", "まだ記録がありません"));
    return;
  }

  const latest = latestSnapshot(snapshots);
  if (latest !== null) root.append(balancesSection(latest));
  root.append(transfersSection(transfers));
  root.append(snapshotsSection(snapshots));
}
