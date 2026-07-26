import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FINE_PRINT,
  INK_DECOR,
  INK_SOFT,
  INK_WEAK,
  INPUT,
  LINK,
  MUTED,
  SUCCESS,
  el,
  section,
} from "./dom.ts";
import { DEFAULT_OBJECT_KEY, parseSyncConfigJson } from "../infrastructure/r2sync.ts";
import type { RenderContext } from "./context.ts";
import type { SyncConfig } from "../infrastructure/r2sync.ts";
import { formatShortDateTime } from "./format.ts";
import { icon } from "./icons.ts";
import { latestRecordAt } from "../domain/ledger.ts";

/**
 * 同期の設定。設定画面を開く理由のほとんどは「つながっているか」の確認なので、
 * 状態と主要な操作を前に出し、接続情報は普段触らないので畳んでおく
 */

const STATUS_ICON_SIZE = 13;

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

function syncNowButton(ctx: RenderContext): HTMLElement {
  const syncNow = el("button", `sync-now ${BTN_PRIMARY} flex items-center gap-2`);
  syncNow.append(icon("refresh-cw", STATUS_ICON_SIZE), "今すぐ同期");
  syncNow.addEventListener("click", () => {
    ctx.state.syncStatus = "同期中…";
    ctx.draw();
    void runSyncNow(ctx);
  });
  return syncNow;
}

function syncButtons(ctx: RenderContext, inputs: SyncInputs): HTMLElement {
  const save = el("button", `save-config ${BTN_SECONDARY} mt-3`, "保存して接続を確認");
  save.addEventListener("click", () => {
    void saveSyncConfig(ctx, inputs);
  });
  const buttons = el("div", "sync-buttons flex gap-2.5");
  buttons.append(save);
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

/** 接続の状態。設定画面を開く理由のほとんどはこれの確認なので、いちばん上に出す */
function syncStatusRow(ctx: RenderContext): HTMLElement {
  const row = el("div", `sync-state flex items-center gap-1.5 text-[12.5px] ${INK_SOFT}`);
  if (ctx.data.syncConfig === null) {
    row.append("未接続 · この端末だけに保存しています");
    return row;
  }
  const mark = el("span", `shrink-0 ${SUCCESS}`);
  mark.append(icon("circle-check", STATUS_ICON_SIZE));
  row.append(mark, "接続済み · Cloudflare R2");
  return row;
}

/** 記録と同期の時刻。独立したカードにするほどの分量ではないので1行に畳む */
function recordStateRow(ctx: RenderContext): HTMLElement {
  const latest = latestRecordAt(ctx.data.snapshots, ctx.data.transfers);
  const row = el("div", `record-state text-[11.5px] ${INK_WEAK}`);
  row.append(
    latest === null ? "まだ記録がありません" : `最終記録 ${formatShortDateTime(latest)}`,
    " · ",
    ctx.data.lastSyncedAt === null
      ? "未同期"
      : `最終同期 ${formatShortDateTime(ctx.data.lastSyncedAt)}`,
  );
  return row;
}

/**
 * 接続設定。接続済みなら4つの入力は普段一度も触らないため、既定では
 * 行1本に畳む。開かないと見えないが、開く手がかりは残す
 */
function connectionSummary(): HTMLElement {
  const summary = document.createElement("summary");
  summary.className = `flex cursor-pointer list-none items-center justify-between gap-2 text-[12.5px] ${INK_SOFT}`;
  summary.append("接続設定を編集(アカウントID・バケット・アクセスキー・オブジェクトキー)");
  const chevron = el("span", `shrink-0 ${INK_DECOR}`);
  chevron.append(icon("chevron-down", STATUS_ICON_SIZE));
  summary.append(chevron);
  return summary;
}

function connectionDetails(ctx: RenderContext): HTMLElement {
  const details = document.createElement("details");
  details.className =
    "sync-connection mt-3.5 border-t border-[#f1f3f7] pt-3.5 dark:border-[#1a222c]";
  const { form, inputs } = syncForm(ctx.data.syncConfig);
  details.append(connectionSummary(), form, syncButtons(ctx, inputs));
  appendConfigExport(details, ctx.data.syncConfig);
  details.append(
    importConfigRow(ctx),
    el(
      "p",
      `note ${FINE_PRINT}`,
      "エクスポートした設定ファイルにはシークレットアクセスキーが平文で含まれる。他端末に取り込んだら削除すること。",
    ),
  );
  return details;
}

export function syncSection(ctx: RenderContext): HTMLElement {
  const node = section("sync", "同期");
  const head = el("div", "flex flex-wrap items-start justify-between gap-3");
  const state = el("div", "flex flex-col gap-1");
  state.append(syncStatusRow(ctx), recordStateRow(ctx));
  head.append(state, syncNowButton(ctx));
  node.append(head, connectionDetails(ctx));
  node.append(el("p", `sync-status min-h-[1.2em] ${MUTED}`, ctx.state.syncStatus));
  return node;
}
