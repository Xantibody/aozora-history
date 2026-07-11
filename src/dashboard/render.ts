import type { AccountRef } from "../domain/parser.ts";
import {
  type BalanceChange,
  type BalanceSnapshot,
  balanceSeries,
  changeCommentKey,
  detectBalanceChanges,
  destinationTotals,
  flowTotals,
  latestSnapshot,
  signedAmountFor,
  sortTransfersDesc,
  transferCommentKey,
  type TransferRecord,
  transfersInvolving,
} from "../domain/ledger.ts";
import { parseSyncConfigJson, type SyncConfig } from "../infrastructure/r2sync.ts";
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
  onImportFile(text: string): Promise<string>;
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

// クラス名の先頭は意味を表すマーカー(テストとイベント処理のフック)、
// 続くTailwindユーティリティが見た目を担う
const MUTED = "text-sm text-(--muted)";
const CONTROL = "border border-(--border) bg-(--card-bg)";
const CELL =
  "border border-(--border) px-3 py-1.5 text-left tabular-nums whitespace-nowrap max-sm:px-2 max-sm:py-1 max-sm:text-sm";
const LINK_BUTTON = "cursor-pointer border-none bg-transparent p-0 text-(--accent) underline";

function section(className: string, title: string): HTMLElement {
  const node = el("section", className);
  node.append(el("h2", "mt-8 mb-3 text-[1.1rem] font-bold max-sm:mt-6", title));
  return node;
}

type Cell = string | HTMLElement;

/** 画面幅を超える表はラッパー内で横スクロールさせる(モバイル対応) */
function table(headers: string[], rows: Cell[][]): HTMLElement {
  const tableEl = el("table", "w-full border-collapse");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(...headers.map((h) => el("th", `${CELL} bg-(--card-bg)`, h)));
  thead.append(headRow);

  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    for (const cell of row) {
      const td = el("td", CELL);
      td.append(cell);
      tr.append(td);
    }
    tbody.append(tr);
  }

  tableEl.append(thead, tbody);
  const scroll = el("div", "table-scroll overflow-x-auto");
  scroll.append(tableEl);
  return scroll;
}

const CARD =
  "rounded-lg border bg-(--card-bg) px-5 py-3 min-w-40 max-sm:min-w-0 max-sm:flex-[1_1_calc(50%-0.25rem)] max-sm:px-3 max-sm:py-2.5";

function balancesSection(snapshot: BalanceSnapshot): HTMLElement {
  const node = section("balances", "現在の残高");
  const list = el("div", "balance-cards flex flex-wrap gap-3 max-sm:gap-2");
  const balanceCard = (name: string, balance: number, extra: string): HTMLElement => {
    const card = el("div", extra);
    card.append(el("div", `account-name ${MUTED}`, name));
    card.append(
      el("div", "account-balance text-[1.3rem] tabular-nums max-sm:text-lg", formatYen(balance)),
    );
    return card;
  };
  for (const account of snapshot.accounts) {
    list.append(
      balanceCard(account.name, account.balance, `balance-card ${CARD} border-(--border)`),
    );
  }
  const total = snapshot.accounts.reduce((sum, a) => sum + a.balance, 0);
  list.append(balanceCard("合計", total, `balance-card total ${CARD} border-(--accent)`));

  node.append(list);
  node.append(
    el(
      "p",
      `updated-at ${MUTED}`,
      `最終更新: ${snapshot.updatedAt ?? formatDateTime(snapshot.takenAt)}`,
    ),
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
    const node = el("div", "period mt-6 flex flex-wrap items-center gap-x-6 gap-y-2");

    const monthGroup = el("div", "month-nav inline-flex items-center gap-1.5");
    const monthButton = `${CONTROL} cursor-pointer rounded px-2.5 py-0.5`;
    const prev = el("button", `month-prev ${monthButton}`, "◀");
    prev.title = "前の月";
    prev.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, -1));
    });

    const monthInput = document.createElement("input");
    monthInput.className = `${CONTROL} rounded px-2 py-0.5`;
    monthInput.type = "month";
    monthInput.name = "period-month";
    monthInput.value = monthValue;
    monthInput.addEventListener("change", () => selectMonth(monthInput.value));

    const next = el("button", `month-next ${monthButton}`, "▶");
    next.title = "次の月";
    next.addEventListener("click", () => {
      selectMonth(shiftMonth(monthValue === "" ? currentMonth() : monthValue, 1));
    });

    monthGroup.append(prev, monthInput, next);
    node.append(el("span", `period-label ${MUTED}`, "表示月:"), monthGroup);

    const detail = el("div", "period-detail inline-flex flex-wrap items-center gap-2");

    const dateInput = `${CONTROL} rounded px-2 py-0.5 text-sm`;
    const fromInput = document.createElement("input");
    fromInput.className = dateInput;
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
    toInput.className = dateInput;
    toInput.type = "date";
    toInput.name = "period-to";
    toInput.value = periodToValue;
    toInput.addEventListener("change", () => {
      monthValue = "";
      periodToValue = toInput.value;
      applyBounds();
      draw();
    });

    const clear = el("button", `period-clear ${LINK_BUTTON} text-sm`, "クリア");
    clear.addEventListener("click", () => selectMonth(""));

    detail.append(
      el("span", "period-label text-xs text-(--muted)", "詳細指定:"),
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
    input.className =
      "comment w-full min-w-40 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm " +
      "hover:border-(--border) focus:border-(--accent) focus:bg-(--card-bg) focus:outline-none";
    input.placeholder = "コメント";
    input.value = data.comments[key] ?? "";
    input.addEventListener("change", () => handlers.onCommentChange(key, input.value));
    return input;
  };

  const transfersSection = (): HTMLElement => {
    const node = section("transfers", "振替履歴");

    const tabs = el("div", "tabs mb-3 flex flex-wrap gap-1.5");
    const tabDefs: { id: string | null; name: string }[] = [
      { id: null, name: "すべて" },
      ...tabAccounts(data),
    ];
    const tabBase = "tab cursor-pointer rounded-full border px-3.5 py-1 text-sm";
    for (const def of tabDefs) {
      const tab = el(
        "button",
        def.id === selectedFromId
          ? `${tabBase} active border-(--accent) bg-(--accent) text-(--on-accent)`
          : `${tabBase} border-(--border) bg-(--card-bg)`,
        def.name,
      );
      tab.addEventListener("click", () => {
        selectedFromId = def.id;
        draw();
      });
      tabs.append(tab);
    }
    node.append(tabs);

    const selectedId = selectedFromId;
    const filtered = sortTransfersDesc(transfersInvolving(data.transfers, selectedId)).filter((t) =>
      inPeriod(t.transferredAt),
    );
    if (filtered.length === 0) {
      node.append(el("p", "empty text-(--muted)", "まだ記録がありません"));
      return node;
    }

    const summary = el("div", `destination-summary mb-2.5 ${MUTED}`);
    const summaryItem = "summary-item ml-3 inline-block tabular-nums";
    if (selectedId === null) {
      summary.append(el("span", "summary-label", "入金先ごとの合計:"));
      for (const dest of destinationTotals(filtered)) {
        summary.append(el("span", summaryItem, `${dest.name} ${formatYen(dest.total)}`));
      }
    } else {
      const totals = flowTotals(filtered, selectedId);
      summary.append(el("span", "summary-label", "合計:"));
      summary.append(el("span", summaryItem, `出金 ${formatSigned(-totals.outgoing)}`));
      summary.append(el("span", summaryItem, `入金 ${formatSigned(totals.incoming)}`));
    }
    node.append(summary);

    // 口座を選んでいる間は、その口座から見た入出金を符号付きで表示する
    const amountCell = (t: TransferRecord): string =>
      selectedId === null ? formatYen(t.amount) : formatSigned(signedAmountFor(t, selectedId));

    const rows = filtered.map((t): Cell[] => [
      formatDateTime(t.transferredAt),
      t.from.name,
      t.to.name,
      amountCell(t),
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
      node.append(el("p", "empty text-(--muted)", "まだ記録がありません"));
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
      node.append(el("p", "empty text-(--muted)", "まだ記録がありません"));
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
    const row = el("label", `sync-field flex flex-col gap-1 ${MUTED}`);
    row.append(el("span", undefined, label));
    const input = document.createElement("input");
    input.className = `${CONTROL} rounded px-2.5 py-1.5 text-(--input-text)`;
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

    const form = el(
      "div",
      "sync-form mb-3 grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2",
    );
    form.append(accountRow, bucketRow, keyRow, akRow, skRow);
    node.append(form);

    const showStatus = (message: string): void => {
      syncStatus = message;
      draw();
    };

    const button = "cursor-pointer rounded-md border px-4 py-1.5";
    const save = el(
      "button",
      `save-config ${button} border-(--border) bg-(--card-bg)`,
      "設定を保存",
    );
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

    const syncNow = el(
      "button",
      `sync-now ${button} border-(--accent) bg-(--accent) text-(--on-accent)`,
      "今すぐ同期",
    );
    syncNow.addEventListener("click", () => {
      syncStatus = "同期中…";
      draw();
      void handlers.onSyncNow().then(showStatus);
    });

    const buttons = el("div", "sync-buttons flex gap-2.5");
    buttons.append(save, syncNow);
    node.append(buttons);

    if (config !== null) {
      const exportLink = document.createElement("a");
      exportLink.className = "export-config mt-3 inline-block text-(--accent) underline";
      exportLink.download = "aozora-history-sync-config.json";
      exportLink.textContent = "同期設定をエクスポート";
      exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(config))}`;
      node.append(exportLink);
    }

    const importConfigRow = el(
      "label",
      "import-config-row mt-3 flex flex-wrap items-center gap-2.5 text-sm",
    );
    importConfigRow.append(el("span", undefined, "設定JSONをインポート:"));
    const importConfigInput = document.createElement("input");
    importConfigInput.type = "file";
    importConfigInput.name = "import-config-file";
    importConfigInput.accept = ".json,application/json";
    importConfigInput.addEventListener("change", () => {
      const file = importConfigInput.files?.[0];
      if (file === undefined) return;
      void file.text().then((text) => {
        try {
          return handlers.onSaveSyncConfig(parseSyncConfigJson(text)).then(showStatus);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          showStatus(`読み込みに失敗しました: ${message}`);
        }
      });
    });
    importConfigRow.append(importConfigInput);
    node.append(importConfigRow);
    node.append(
      el(
        "p",
        `note ${MUTED}`,
        "エクスポートした設定ファイルにはシークレットアクセスキーが平文で含まれる。他端末に取り込んだら削除すること。",
      ),
    );

    node.append(el("p", `sync-status min-h-[1.2em] ${MUTED}`, syncStatus));
    return node;
  };

  let view: "dashboard" | "settings" = "dashboard";
  let importStatus = "";

  const importExportSection = (): HTMLElement => {
    const node = section("import-export", "インポート / エクスポート");

    const exportLink = document.createElement("a");
    exportLink.className = "export mb-3 inline-block text-(--accent) underline";
    exportLink.download = "aozora-history.json";
    exportLink.textContent = "JSONをエクスポート";
    const ledger = {
      snapshots: data.snapshots,
      transfers: data.transfers,
      comments: data.comments,
    };
    exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(ledger))}`;
    node.append(exportLink);

    const importRow = el("label", "import-row flex flex-wrap items-center gap-2.5 text-sm");
    importRow.append(el("span", undefined, "JSONをインポート(現在の記録とマージ):"));
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.name = "import-file";
    fileInput.accept = ".json,application/json";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file === undefined) return;
      importStatus = "読み込み中…";
      draw();
      void file
        .text()
        .then((text) => handlers.onImportFile(text))
        .then((message) => {
          importStatus = message;
          draw();
        });
    });
    importRow.append(fileInput);
    node.append(importRow);

    node.append(
      el(
        "p",
        `note ${MUTED}`,
        "R2上のオブジェクトやエクスポートしたファイルと同じ形式のJSONを読み込めます。",
      ),
    );
    node.append(el("p", `import-status min-h-[1.2em] ${MUTED}`, importStatus));
    return node;
  };

  const settingsView = (): HTMLElement => {
    const node = el("div", "settings-view");
    const back = el("button", `back-button ${LINK_BUTTON}`, "← ダッシュボードに戻る");
    back.addEventListener("click", () => {
      view = "dashboard";
      draw();
    });
    node.append(back, syncSection(), importExportSection());
    return node;
  };

  const settingsButton = (): HTMLElement => {
    const button = el(
      "button",
      `settings-button ${CONTROL} absolute top-6 right-6 h-10 w-10 cursor-pointer rounded-full text-lg leading-none max-sm:top-4 max-sm:right-3`,
      "⚙",
    );
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
      root.append(el("p", "empty text-(--muted)", "まだ記録がありません"));
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
