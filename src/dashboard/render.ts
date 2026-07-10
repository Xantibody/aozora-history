import type { AccountRef } from "../domain/parser.ts";
import {
  type BalanceChange,
  type BalanceSnapshot,
  balanceSeries,
  changeCommentKey,
  detectBalanceChanges,
  destinationTotals,
  latestSnapshot,
  sortTransfersDesc,
  transferCommentKey,
  type TransferRecord,
  transfersFrom,
} from "../domain/ledger.ts";
import type { Comments } from "../infrastructure/storage.ts";

export interface DashboardData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Comments;
}

export interface DashboardHandlers {
  onCommentChange(key: string, text: string): void;
}

export function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function formatSigned(amount: number): string {
  if (amount === 0) return "±0円";
  return (amount > 0 ? "+" : "-") + formatYen(Math.abs(amount));
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

type Cell = string | HTMLElement;

function table(headers: string[], rows: Cell[][]): HTMLElement {
  const tableEl = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(...headers.map((h) => el("th", undefined, h)));
  thead.append(headRow);

  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    for (const cell of row) {
      const td = el("td");
      td.append(cell);
      tr.append(td);
    }
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

/** タブに出す口座一覧。最新スナップショットの並びを基本に、振替にしか現れない口座を補う */
function tabAccounts(data: DashboardData): AccountRef[] {
  const accounts: AccountRef[] = [];
  const seen = new Set<string>();
  const latest = latestSnapshot(data.snapshots);
  for (const account of latest?.accounts ?? []) {
    accounts.push({ id: account.id, name: account.name });
    seen.add(account.id);
  }
  for (const t of data.transfers) {
    for (const ref of [t.from, t.to]) {
      if (seen.has(ref.id)) continue;
      accounts.push(ref);
      seen.add(ref.id);
    }
  }
  return accounts;
}

export function renderDashboard(
  root: HTMLElement,
  data: DashboardData,
  handlers: DashboardHandlers,
): void {
  let selectedFromId: string | null = null;

  const commentInput = (key: string): HTMLElement => {
    const input = document.createElement("input");
    input.className = "comment";
    input.placeholder = "コメント";
    input.value = data.comments[key] ?? "";
    input.addEventListener("change", () => handlers.onCommentChange(key, input.value));
    return input;
  };

  const transfersSection = (): HTMLElement => {
    const node = section("transfers", "振替履歴");

    const tabs = el("div", "tabs");
    const tabDefs: { id: string | null; name: string }[] = [
      { id: null, name: "すべて" },
      ...tabAccounts(data),
    ];
    for (const def of tabDefs) {
      const tab = el("button", def.id === selectedFromId ? "tab active" : "tab", def.name);
      tab.addEventListener("click", () => {
        selectedFromId = def.id;
        draw();
      });
      tabs.append(tab);
    }
    node.append(tabs);

    const filtered = sortTransfersDesc(transfersFrom(data.transfers, selectedFromId));
    if (filtered.length === 0) {
      node.append(el("p", "empty", "まだ記録がありません"));
      return node;
    }

    const summary = el("div", "destination-summary");
    summary.append(el("span", "summary-label", "入金先ごとの合計:"));
    for (const dest of destinationTotals(filtered)) {
      summary.append(el("span", "summary-item", `${dest.name} ${formatYen(dest.total)}`));
    }
    node.append(summary);

    const rows = filtered.map((t): Cell[] => [
      formatDateTime(t.transferredAt),
      t.from.name,
      t.to.name,
      formatYen(t.amount),
      commentInput(transferCommentKey(t)),
    ]);
    node.append(table(["日時", "出金口座", "入金口座", "金額", "コメント"], rows));
    return node;
  };

  const externalCell = (change: BalanceChange): string => {
    if (change.externalDelta === 0) return "—";
    const kind = change.externalDelta > 0 ? "入金" : "出金";
    return `${formatSigned(change.externalDelta)}（${kind}）`;
  };

  const changesSection = (): HTMLElement => {
    const node = section("changes", "残高変動");
    const changes = detectBalanceChanges(data.snapshots, data.transfers).toSorted(
      (a, b) => b.toTakenAt - a.toTakenAt,
    );
    if (changes.length === 0) {
      node.append(el("p", "empty", "まだ記録がありません"));
      return node;
    }
    const rows = changes.map((c): Cell[] => [
      formatDateTime(c.toTakenAt),
      c.accountName,
      formatSigned(c.delta),
      c.transferDelta === 0 ? "—" : formatSigned(c.transferDelta),
      externalCell(c),
      commentInput(changeCommentKey(c)),
    ]);
    node.append(table(["記録日時", "口座", "変動", "うち振替", "外部入出金", "コメント"], rows));
    return node;
  };

  const snapshotsSection = (): HTMLElement => {
    const node = section("snapshots", "残高推移");
    if (data.snapshots.length === 0) {
      node.append(el("p", "empty", "まだ記録がありません"));
      return node;
    }
    const columns = balanceSeries(data.snapshots);
    const rows = data.snapshots.toReversed().map((snapshot): Cell[] => {
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
  };

  const draw = (): void => {
    root.replaceChildren();

    if (data.snapshots.length === 0 && data.transfers.length === 0) {
      root.append(el("p", "empty", "まだ記録がありません"));
      return;
    }

    const latest = latestSnapshot(data.snapshots);
    if (latest !== null) root.append(balancesSection(latest));
    root.append(transfersSection());
    root.append(changesSection());
    root.append(snapshotsSection());
  };

  draw();
}
