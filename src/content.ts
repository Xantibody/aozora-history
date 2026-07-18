import { HistoryStore } from "./infrastructure/storage.ts";
import { setupContentScript } from "./content-script.ts";

void setupContentScript(document, new HistoryStore(browser.storage.local), Date.now);
