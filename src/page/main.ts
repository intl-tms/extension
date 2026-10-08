import { startPageHost, type PageEnvironment } from "./start.js";

startPageHost({ scope: globalThis as unknown as Record<string, unknown>, runtime: chrome.runtime, storage: chrome.storage } as PageEnvironment);
