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
import type { SyncConfig } from "../infrastructure/r2sync.ts";
import type { Comments } from "../infrastructure/storage.ts";

export interface DashboardData {
  snapshots: BalanceSnapshot[];
  transfers: TransferRecord[];
  comments: Comments;
  syncConfig: SyncConfig | null;
}

export interface DashboardHandlers {
  onCommentChange(key: string, text: string): void;
  onSaveSyncConfig(config: SyncConfig): Promise<string>;
  onSyncNow(): Promise<string>;
}

const DEFAULT_OBJECT_KEY = "aozora-history.json";

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

/** "YYYY-MM-DD" をローカル時刻の日付境界(エポックミリ秒)に変換する */
function dayStart(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM" をその月の[開始, 翌月開始)に変換する */
function monthBounds(value: string): [number, number] | null {
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return null;
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
}

function shiftMonth(value: string, delta: number): string {
  const [y, m] = value.split("-").map(Number);
  const shifted = new Date(y, m - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function renderDashboard(
  root: HTMLElement,
  data: DashboardData,
  handlers: DashboardHandlers,
): void {
  let selectedFromId: string | null = null;
  let periodFrom: number | null = null;
  let periodToExclusive: number | null = null;
  let periodFromValue = "";
  let periodToValue = "";
  let monthValue = "";

  const inPeriod = (ms: number): boolean => {
    if (periodFrom !== null && ms < periodFrom) return false;
    if (periodToExclusive !== null && ms >= periodToExclusive) return false;
    return true;
  };

  /** 月選択と日付指定は排他。残っている方の入力から境界を計算し直す */
  const applyBounds = (): void => {
    const bounds = monthValue === "" ? null : monthBounds(monthValue);
    if (bounds !== null) {
      [periodFrom, periodToExclusive] = bounds;
      return;
    }
    periodFrom = periodFromValue === "" ? null : dayStart(periodFromValue);
    const toStart = periodToValue === "" ? null : dayStart(periodToValue);
    periodToExclusive = toStart === null ? null : toStart + DAY_MS;
  };

  const selectMonth = (value: string): void => {
    monthValue = value;
    periodFromValue = periodToValue = "";
    applyBounds();
    draw();
  };

  const periodSection = (): HTMLElement => {
    const node = el("div", "period");

    const monthGroup = el("div", "month-nav");
    const prev = el("button", "month-prev", "◀");
    prev.title = "前の月";
    prev.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, -1));
    });

    const monthInput = document.createElement("input");
    monthInput.type = "month";
    monthInput.name = "period-month";
    monthInput.value = monthValue;
    monthInput.addEventListener("change", () => selectMonth(monthInput.value));

    const next = el("button", "month-next", "▶");
    next.title = "次の月";
    next.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, 1));
    });

    monthGroup.append(prev, monthInput, next);
    node.append(el("span", "period-label", "表示月:"), monthGroup);

    const detail = el("div", "period-detail");

    const fromInput = document.createElement("input");
    fromInput.type = "date";
    fromInput.name = "period-from";
    fromInput.value = periodFromValue;
    fromInput.addEventListener("change", () => {
      monthValue = "";
      periodFromValue = fromInput.value;
      applyBounds();
      draw();
    });

    const toInput = document.createElement("input");
    toInput.type = "date";
    toInput.name = "period-to";
    toInput.value = periodToValue;
    toInput.addEventListener("change", () => {
      monthValue = "";
      periodToValue = toInput.value;
      applyBounds();
      draw();
    });

    const clear = el("button", "period-clear", "クリア");
    clear.addEventListener("click", () => selectMonth(""));

    detail.append(
      el("span", "period-label", "詳細指定:"),
      fromInput,
      el("span", "period-separator", "〜"),
      toInput,
      clear,
    );
    node.append(detail);
    return node;
  };

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

    const filtered = sortTransfersDesc(transfersFrom(data.transfers, selectedFromId)).filter((t) =>
      inPeriod(t.transferredAt),
    );
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
    const changes = detectBalanceChanges(data.snapshots, data.transfers)
      .filter((c) => inPeriod(c.toTakenAt))
      .toSorted((a, b) => b.toTakenAt - a.toTakenAt);
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
    const visible = data.snapshots.filter((s) => inPeriod(s.takenAt));
    if (visible.length === 0) {
      node.append(el("p", "empty", "まだ記録がありません"));
      return node;
    }
    const columns = balanceSeries(visible);
    const rows = visible.toReversed().map((snapshot): Cell[] => {
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

  let syncStatus = "";

  const syncField = (
    label: string,
    name: string,
    value: string,
    type = "text",
  ): [HTMLElement, HTMLInputElement] => {
    const row = el("label", "sync-field");
    row.append(el("span", undefined, label));
    const input = document.createElement("input");
    input.type = type;
    input.name = name;
    input.value = value;
    row.append(input);
    return [row, input];
  };

  const syncSection = (): HTMLElement => {
    const node = section("sync", "同期 (Cloudflare R2)");
    const config = data.syncConfig;

    const [accountRow, accountInput] = syncField(
      "アカウントID",
      "sync-account-id",
      config?.accountId ?? "",
    );
    const [bucketRow, bucketInput] = syncField("バケット", "sync-bucket", config?.bucket ?? "");
    const [keyRow, keyInput] = syncField(
      "オブジェクトキー",
      "sync-object-key",
      config?.objectKey ?? DEFAULT_OBJECT_KEY,
    );
    const [akRow, akInput] = syncField(
      "アクセスキーID",
      "sync-access-key-id",
      config?.accessKeyId ?? "",
    );
    const [skRow, skInput] = syncField(
      "シークレットアクセスキー",
      "sync-secret",
      config?.secretAccessKey ?? "",
      "password",
    );

    const form = el("div", "sync-form");
    form.append(accountRow, bucketRow, keyRow, akRow, skRow);
    node.append(form);

    const showStatus = (message: string): void => {
      syncStatus = message;
      draw();
    };

    const save = el("button", "save-config", "設定を保存");
    save.addEventListener("click", () => {
      void handlers
        .onSaveSyncConfig({
          accountId: accountInput.value.trim(),
          bucket: bucketInput.value.trim(),
          objectKey: keyInput.value.trim() === "" ? DEFAULT_OBJECT_KEY : keyInput.value.trim(),
          accessKeyId: akInput.value.trim(),
          secretAccessKey: skInput.value.trim(),
        })
        .then(showStatus);
    });

    const syncNow = el("button", "sync-now", "今すぐ同期");
    syncNow.addEventListener("click", () => {
      syncStatus = "同期中…";
      draw();
      void handlers.onSyncNow().then(showStatus);
    });

    const buttons = el("div", "sync-buttons");
    buttons.append(save, syncNow);
    node.append(buttons);
    node.append(el("p", "sync-status", syncStatus));
    return node;
  };

  let view: "dashboard" | "settings" = "dashboard";

  const settingsView = (): HTMLElement => {
    const node = el("div", "settings-view");
    const back = el("button", "back-button", "← ダッシュボードに戻る");
    back.addEventListener("click", () => {
      view = "dashboard";
      draw();
    });
    node.append(back, syncSection());
    return node;
  };

  const settingsButton = (): HTMLElement => {
    const button = el("button", "settings-button", "⚙");
    button.title = "設定";
    button.setAttribute("aria-label", "設定");
    button.addEventListener("click", () => {
      view = "settings";
      draw();
    });
    return button;
  };

  const draw = (): void => {
    root.replaceChildren();

    if (view === "settings") {
      root.append(settingsView());
      return;
    }

    root.append(settingsButton());

    if (data.snapshots.length === 0 && data.transfers.length === 0) {
      root.append(el("p", "empty", "まだ記録がありません"));
      return;
    }

    const latest = latestSnapshot(data.snapshots);
    if (latest !== null) root.append(balancesSection(latest));
    root.append(periodSection());
    root.append(transfersSection());
    root.append(changesSection());
    root.append(snapshotsSection());
  };

  draw();
}
