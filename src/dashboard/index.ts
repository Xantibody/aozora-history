import { HistoryStore } from "../infrastructure/storage.ts";
import { renderDashboard } from "./render.ts";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;

  const store = new HistoryStore(browser.storage.local);
  const [snapshots, transfers] = await Promise.all([store.loadSnapshots(), store.loadTransfers()]);
  renderDashboard(root, snapshots, transfers);
}

void main();
