import { SETTINGS_KEYS, STORAGE } from "../shared/storage.js";
import { mountPopup } from "./view.js";

/** The parts of the browser's extension API the Popup uses. There is no messaging here on purpose. */
export type PopupApi = Pick<typeof chrome, "tabs" | "storage" | "permissions">;

/** Wires the browser to the Popup view. */
export function startPopup(api: PopupApi, container: HTMLElement): Promise<void> {
  const activeTab = async () => (await api.tabs.query({ active: true, currentWindow: true }))[0];
  // The Worker's stash, in the session area, holds each tab's page status.
  const statusIn = (stash: unknown, tab: number | undefined) => {
    const tabs = (stash as { tabs?: Record<string, { status?: unknown }> } | undefined)?.tabs;
    return tab === undefined || typeof tabs !== "object" || tabs === null ? undefined : tabs[String(tab)]?.status;
  };
  return mountPopup({
    container,
    ports: {
      activeTabUrl: async () => (await activeTab())?.url,
      readSettings: () => api.storage.sync.get([...SETTINGS_KEYS]),
      writeSettings: (values) => api.storage.sync.set(values),
      isGranted: (pattern) => api.permissions.contains({ origins: [pattern] }),
      requestAccess: (pattern) => api.permissions.request({ origins: [pattern] }),
      tabStatus: async () => statusIn((await api.storage.session.get(STORAGE.stash))[STORAGE.stash], (await activeTab())?.id),
      onTabStatus: (listener) =>
        api.storage.onChanged.addListener((changes, area) => {
          if (area !== "session" || !(STORAGE.stash in changes)) return;
          void activeTab().then((tab) => listener(statusIn(changes[STORAGE.stash]?.newValue, tab?.id)), () => undefined);
        }),
      openTab: (url) => void api.tabs.create({ url }),
    },
  });
}
