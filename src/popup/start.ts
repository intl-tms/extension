import { SETTINGS_KEYS } from "../shared/storage.js";
import { mountPopup } from "./view.js";

/** The parts of the browser's extension API the Popup uses. There is no messaging here on purpose. */
export type PopupApi = Pick<typeof chrome, "tabs" | "storage" | "permissions">;

/** Wires the browser to the Popup view. */
export function startPopup(api: PopupApi, container: HTMLElement): Promise<void> {
  return mountPopup({
    container,
    ports: {
      activeTabUrl: async () => (await api.tabs.query({ active: true, currentWindow: true }))[0]?.url,
      readSettings: () => api.storage.sync.get([...SETTINGS_KEYS]),
      writeSettings: (values) => api.storage.sync.set(values),
      isGranted: (pattern) => api.permissions.contains({ origins: [pattern] }),
      requestAccess: (pattern) => api.permissions.request({ origins: [pattern] }),
    },
  });
}
