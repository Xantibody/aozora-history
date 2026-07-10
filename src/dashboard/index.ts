import { HistoryStore } from "../infrastructure/storage.ts";
import { renderDashboard } from "./render.ts";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;

  const store = new HistoryStore(browser.storage.local);
  const [snapshots, transfers, comments] = await Promise.all([
    store.loadSnapshots(),
    store.loadTransfers(),
    store.loadComments(),
  ]);

  const data = { snapshots, transfers, comments };
  renderDashboard(root, data, {
    onCommentChange: (key, text) => {
      // 再描画時に最新のコメントが出るようローカルにも反映する
      const trimmed = text.trim();
      if (trimmed === "") {
        delete data.comments[key];
      } else {
        data.comments[key] = trimmed;
      }
      void store.setComment(key, text);
    },
  });
}

void main();
