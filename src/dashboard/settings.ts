import { BTN_SECONDARY, FINE_PRINT, INK, INK_DECOR, INK_SOFT, MUTED, el, section } from "./dom.ts";
import type { DashboardData, RenderContext } from "./context.ts";
import { statementsCsv, transfersCsv } from "./csv.ts";
import { debugSection } from "./debug-section.ts";
import { icon } from "./icons.ts";
import { primaryStatements } from "../domain/statement.ts";
import { syncSection } from "./sync-section.ts";

const EXPORT_ICON_SIZE = 13;
const DROP_ICON_SIZE = 18;
const BACK_ICON_SIZE = 18;

/** 書き出しは押せるものとして並べる。リンクの列だと操作だと気づきにくい */
function exportButton(marker: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = `${marker} ${BTN_SECONDARY} inline-flex items-center gap-2 no-underline ${INK}`;
  link.append(icon("download", EXPORT_ICON_SIZE), label);
  return link;
}

function jsonExportLink(data: DashboardData): HTMLAnchorElement {
  const exportLink = exportButton("export", "JSON(全記録)");
  exportLink.download = "aozora-history.json";
  const ledger = {
    snapshots: data.snapshots,
    transfers: data.transfers,
    statements: data.statements,
    comments: data.comments,
    deletions: data.deletions,
  };
  exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(ledger))}`;
  return exportLink;
}

function csvExportLink(data: DashboardData): HTMLAnchorElement {
  const csvLink = exportButton("export-csv", "振替CSV");
  csvLink.download = "aozora-history.csv";
  csvLink.href = `data:text/csv;charset=utf-8,${encodeURIComponent(transfersCsv(data.transfers, data.comments))}`;
  return csvLink;
}

function statementCsvExportLink(data: DashboardData): HTMLAnchorElement {
  const csvLink = exportButton("export-statement-csv", "明細CSV");
  csvLink.download = "aozora-statements.csv";
  csvLink.href = `data:text/csv;charset=utf-8,${encodeURIComponent(statementsCsv(primaryStatements(data.statements), data.comments))}`;
  return csvLink;
}

async function importLedgerFile(ctx: RenderContext, file: File): Promise<void> {
  const text = await file.text();
  ctx.state.importStatus = await ctx.handlers.onImportFile(text);
  ctx.draw();
}

/**
 * 読み込みは面で受ける。生のファイル入力はボタンの見た目が環境ごとに違い、
 * ここが操作できる場所だと伝わりにくい
 */
function importFileInput(ctx: RenderContext): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.name = "import-file";
  input.accept = ".json,application/json";
  input.className = "sr-only";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    ctx.state.importStatus = "読み込み中…";
    ctx.draw();
    void importLedgerFile(ctx, file);
  });
  return input;
}

function importRow(ctx: RenderContext): HTMLElement {
  const row = el(
    "label",
    "import-row mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-[11px] " +
      "border border-dashed border-[#dfe4ea] bg-[#fbfcfd] p-[18px] text-center text-[12.5px] " +
      `dark:border-[#243040] dark:bg-[#0f1620] ${INK_SOFT}`,
  );
  const mark = el("span", INK_DECOR);
  mark.append(icon("upload", DROP_ICON_SIZE));
  row.append(
    mark,
    el("span", undefined, "JSONをドロップ、またはクリックして選択(現在の記録とマージ)"),
    importFileInput(ctx),
  );
  return row;
}

/** 書き出す前に量が分かると安心できる。ledgerから数えるだけ */
function recordCounts(ctx: RenderContext): HTMLElement {
  const { transfers, statements, snapshots } = ctx.data;
  return el(
    "p",
    `record-counts mt-3 ${FINE_PRINT}`,
    `保存されている記録 / 振替 ${transfers.length}件 · 明細 ${statements.length}件 · ` +
      `スナップショット ${snapshots.length}件`,
  );
}

function importExportSection(ctx: RenderContext): HTMLElement {
  const node = section("import-export", "データ");
  node.append(el("div", `text-[12.5px] ${INK_SOFT}`, "書き出す"));
  const exportRow = el("div", "export-row mt-2 flex flex-wrap gap-2");
  exportRow.append(
    jsonExportLink(ctx.data),
    csvExportLink(ctx.data),
    statementCsvExportLink(ctx.data),
  );
  node.append(exportRow, importRow(ctx), recordCounts(ctx));
  node.append(el("p", `import-status min-h-[1.2em] ${MUTED}`, ctx.state.importStatus));
  return node;
}

/** 設定は並べて見比べる画面ではないので、1カラムで上から順に読ませる */
export function settingsView(ctx: RenderContext): HTMLElement {
  const node = el("div", "settings-view mx-auto max-w-[620px] px-4 py-4 sm:px-6");
  const head = el("div", "flex items-center gap-2");
  const back = el("button", `back-button flex cursor-pointer items-center ${INK_SOFT}`);
  back.append(icon("chevron-left", BACK_ICON_SIZE));
  back.title = "ダッシュボードに戻る";
  back.setAttribute("aria-label", back.title);
  back.addEventListener("click", () => {
    ctx.state.view = "dashboard";
    ctx.draw();
  });
  head.append(back, el("h1", `text-[15px] font-bold ${INK}`, "設定"));
  node.append(head, syncSection(ctx), importExportSection(ctx), debugSection(ctx));
  return node;
}
