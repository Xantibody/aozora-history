import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FINE_PRINT,
  INPUT,
  LINK,
  LINK_BUTTON,
  MUTED,
  el,
  section,
} from "./dom.ts";
import { DEFAULT_OBJECT_KEY, parseSyncConfigJson } from "../infrastructure/r2sync.ts";
import type { DashboardData, RenderContext } from "./context.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";
import { transfersCsv } from "./csv.ts";

interface SyncFieldDef {
  label: string;
  name: string;
  value: string;
  type?: string;
}

function syncField(def: SyncFieldDef): [HTMLElement, HTMLInputElement] {
  const row = el(
    "label",
    "sync-field flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300",
  );
  row.append(el("span", undefined, def.label));
  const input = document.createElement("input");
  input.className = `${INPUT} text-slate-900 dark:text-slate-100`;
  input.type = def.type ?? "text";
  input.name = def.name;
  input.value = def.value;
  row.append(input);
  return [row, input];
}

interface SyncInputs {
  account: HTMLInputElement;
  bucket: HTMLInputElement;
  objectKey: HTMLInputElement;
  accessKey: HTMLInputElement;
  secret: HTMLInputElement;
}

function syncForm(config: SyncConfig | null): { form: HTMLElement; inputs: SyncInputs } {
  const [accountRow, account] = syncField({
    label: "アカウントID",
    name: "sync-account-id",
    value: config?.accountId ?? "",
  });
  const [bucketRow, bucket] = syncField({
    label: "バケット",
    name: "sync-bucket",
    value: config?.bucket ?? "",
  });
  const [keyRow, objectKey] = syncField({
    label: "オブジェクトキー",
    name: "sync-object-key",
    value: config?.objectKey ?? DEFAULT_OBJECT_KEY,
  });
  const [accessKeyRow, accessKey] = syncField({
    label: "アクセスキーID",
    name: "sync-access-key-id",
    value: config?.accessKeyId ?? "",
  });
  const [secretRow, secret] = syncField({
    label: "シークレットアクセスキー",
    name: "sync-secret",
    value: config?.secretAccessKey ?? "",
    type: "password",
  });
  const form = el(
    "div",
    "sync-form mb-3 grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2",
  );
  form.append(accountRow, bucketRow, keyRow, accessKeyRow, secretRow);
  return { form, inputs: { account, bucket, objectKey, accessKey, secret } };
}

function readSyncConfig(inputs: SyncInputs): SyncConfig {
  const objectKey = inputs.objectKey.value.trim();
  return {
    accountId: inputs.account.value.trim(),
    bucket: inputs.bucket.value.trim(),
    objectKey: objectKey === "" ? DEFAULT_OBJECT_KEY : objectKey,
    accessKeyId: inputs.accessKey.value.trim(),
    secretAccessKey: inputs.secret.value.trim(),
  };
}

function showSyncStatus(ctx: RenderContext, message: string): void {
  ctx.state.syncStatus = message;
  ctx.draw();
}

async function saveSyncConfig(ctx: RenderContext, inputs: SyncInputs): Promise<void> {
  const message = await ctx.handlers.onSaveSyncConfig(readSyncConfig(inputs));
  showSyncStatus(ctx, message);
}

async function runSyncNow(ctx: RenderContext): Promise<void> {
  showSyncStatus(ctx, await ctx.handlers.onSyncNow());
}

function syncButtons(ctx: RenderContext, inputs: SyncInputs): HTMLElement {
  const save = el("button", `save-config ${BTN_SECONDARY} px-4 py-1.5`, "設定を保存");
  save.addEventListener("click", () => {
    void saveSyncConfig(ctx, inputs);
  });
  const syncNow = el("button", `sync-now ${BTN_PRIMARY}`, "今すぐ同期");
  syncNow.addEventListener("click", () => {
    ctx.state.syncStatus = "同期中…";
    ctx.draw();
    void runSyncNow(ctx);
  });
  const buttons = el("div", "sync-buttons flex gap-2.5");
  buttons.append(save, syncNow);
  return buttons;
}

function appendConfigExport(node: HTMLElement, config: SyncConfig | null): void {
  if (config === null) {
    return;
  }
  const exportLink = document.createElement("a");
  exportLink.className = `export-config mt-3 inline-block text-sm ${LINK}`;
  exportLink.download = "aozora-history-sync-config.json";
  exportLink.textContent = "同期設定をエクスポート";
  exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(config))}`;
  node.append(exportLink);
}

function parseConfigFile(ctx: RenderContext, text: string): SyncConfig | null {
  try {
    return parseSyncConfigJson(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showSyncStatus(ctx, `読み込みに失敗しました: ${message}`);
    return null;
  }
}

async function importConfigFile(ctx: RenderContext, file: File): Promise<void> {
  const text = await file.text();
  const config = parseConfigFile(ctx, text);
  if (config === null) {
    return;
  }
  showSyncStatus(ctx, await ctx.handlers.onSaveSyncConfig(config));
}

function importConfigRow(ctx: RenderContext): HTMLElement {
  const row = el("label", "import-config-row mt-3 flex flex-wrap items-center gap-2.5 text-sm");
  row.append(el("span", undefined, "設定JSONをインポート:"));
  const input = document.createElement("input");
  input.type = "file";
  input.name = "import-config-file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    void importConfigFile(ctx, file);
  });
  row.append(input);
  return row;
}

function syncSection(ctx: RenderContext): HTMLElement {
  const node = section("sync", "同期 (Cloudflare R2)");
  const { form, inputs } = syncForm(ctx.data.syncConfig);
  node.append(form, syncButtons(ctx, inputs));
  appendConfigExport(node, ctx.data.syncConfig);
  node.append(importConfigRow(ctx));
  node.append(
    el(
      "p",
      `note ${FINE_PRINT}`,
      "エクスポートした設定ファイルにはシークレットアクセスキーが平文で含まれる。他端末に取り込んだら削除すること。",
    ),
  );
  node.append(el("p", `sync-status min-h-[1.2em] ${MUTED}`, ctx.state.syncStatus));
  return node;
}

function jsonExportLink(data: DashboardData): HTMLAnchorElement {
  const exportLink = document.createElement("a");
  exportLink.className = `export mb-3 inline-block text-sm ${LINK}`;
  exportLink.download = "aozora-history.json";
  exportLink.textContent = "JSONをエクスポート";
  const ledger = {
    snapshots: data.snapshots,
    transfers: data.transfers,
    comments: data.comments,
    deletions: data.deletions,
  };
  exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(ledger))}`;
  return exportLink;
}

function csvExportLink(data: DashboardData): HTMLAnchorElement {
  const csvLink = document.createElement("a");
  csvLink.className = `export-csv mb-3 inline-block text-sm ${LINK}`;
  csvLink.download = "aozora-history.csv";
  csvLink.textContent = "振替履歴をCSVでエクスポート";
  csvLink.href = `data:text/csv;charset=utf-8,${encodeURIComponent(transfersCsv(data.transfers, data.comments))}`;
  return csvLink;
}

async function importLedgerFile(ctx: RenderContext, file: File): Promise<void> {
  const text = await file.text();
  ctx.state.importStatus = await ctx.handlers.onImportFile(text);
  ctx.draw();
}

function importRow(ctx: RenderContext): HTMLElement {
  const row = el("label", "import-row flex flex-wrap items-center gap-2.5 text-sm");
  row.append(el("span", undefined, "JSONをインポート(現在の記録とマージ):"));
  const input = document.createElement("input");
  input.type = "file";
  input.name = "import-file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    ctx.state.importStatus = "読み込み中…";
    ctx.draw();
    void importLedgerFile(ctx, file);
  });
  row.append(input);
  return row;
}

function importExportSection(ctx: RenderContext): HTMLElement {
  const node = section("import-export", "インポート / エクスポート");
  const exportRow = el("div", "export-row flex flex-wrap gap-x-6");
  exportRow.append(jsonExportLink(ctx.data), csvExportLink(ctx.data));
  node.append(exportRow, importRow(ctx));
  node.append(
    el(
      "p",
      `note ${FINE_PRINT}`,
      "R2上のオブジェクトやエクスポートしたファイルと同じ形式のJSONを読み込めます。",
    ),
  );
  node.append(el("p", `import-status min-h-[1.2em] ${MUTED}`, ctx.state.importStatus));
  return node;
}

export function settingsView(ctx: RenderContext): HTMLElement {
  const node = el("div", "settings-view mx-auto max-w-[760px] px-4 py-4 sm:px-6");
  const back = el("button", `back-button ${LINK_BUTTON}`, "← ダッシュボードに戻る");
  back.addEventListener("click", () => {
    ctx.state.view = "dashboard";
    ctx.draw();
  });
  node.append(back, syncSection(ctx), importExportSection(ctx));
  return node;
}
