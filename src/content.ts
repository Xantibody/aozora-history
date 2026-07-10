import { setupContentScript } from "./content-script.ts";
import { HistoryStore } from "./infrastructure/storage.ts";

setupContentScript(document, new HistoryStore(browser.storage.local), Date.now);
