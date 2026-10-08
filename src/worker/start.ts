import { siteOf } from "../shared/site.js";
import { STORAGE, type KeyValueStore } from "../shared/storage.js";
import { PAGE_HOST_FILE, REGISTRATION_ID, createReconciler, type Registration } from "./reconcile.js";
import { classifySender, createRelay } from "./relay.js";

/** The parts of the browser's extension API the Worker uses. */
export type WorkerApi = Pick<typeof chrome, "runtime" | "storage" | "permissions" | "scripting" | "tabs" | "sidePanel">;

const store = (area: chrome.storage.StorageArea): KeyValueStore => ({
  get: async (key) => (await area.get(key))[key],
  set: (key, value) => area.set({ [key]: value }),
});

/**
 * Wires the browser to the Worker's two modules: the relay and reconciliation.
 * Everything here is registered synchronously, at the top of the Worker's
 * script, so an event that wakes a stopped Worker finds its listener.
 */
export function startWorker(api: WorkerApi): void {
  const extensionOrigin = api.runtime.getURL("").replace(/\/$/, "");

  const relay = createRelay({
    pushToPanel: (message) => api.runtime.sendMessage(message),
    sendToTab: (tab, message) => api.tabs.sendMessage(tab, message),
    openPanel: (tab) => api.sidePanel.open({ tabId: tab }),
    durable: store(api.storage.local),
    session: store(api.storage.session),
  });

  const reconcile = createReconciler({
    readSites: async () => (await api.storage.sync.get(STORAGE.sites))[STORAGE.sites],
    isGranted: (pattern) => api.permissions.contains({ origins: [pattern] }),
    getRegistration: async () => (await api.scripting.getRegisteredContentScripts({ ids: [REGISTRATION_ID] }))[0] as Registration | undefined,
    register: (registration) => api.scripting.registerContentScripts([registration]),
    update: (registration) => api.scripting.updateContentScripts([registration]),
    unregister: () => api.scripting.unregisterContentScripts({ ids: [REGISTRATION_ID] }),
    listTabs: () => api.tabs.query({}),
    inject: async (tabId) => void (await api.scripting.executeScript({ target: { tabId }, files: [PAGE_HOST_FILE] })),
    logError: (text) => console.error(text),
  });

  api.runtime.onMessage.addListener((message: unknown, sender, respond) => relay.handle(message, classifySender(sender, extensionOrigin), respond));

  api.runtime.onInstalled.addListener(() => void reconcile());
  api.runtime.onStartup.addListener(() => void reconcile());
  api.permissions.onAdded.addListener(() => void reconcile());
  api.permissions.onRemoved.addListener(() => void reconcile());
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && STORAGE.sites in changes) void reconcile();
  });

  api.tabs.onRemoved.addListener((tabId) => relay.tabClosed(tabId));
  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "loading") relay.tabNavigated(tabId, siteOf(tab.url));
  });
}
