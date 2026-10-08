import { isSite } from "./site.js";

/**
 * The names of every stored value, defined once. Which storage area each lives
 * in is part of its meaning: synchronised values travel with the Editor's
 * browser profile and arrive from other devices, the durable area survives a
 * browser restart, and the session area survives only a Worker restart.
 */
export const STORAGE = {
  /** Synchronised. The Listed Sites: an array of origin strings. Written only by the Popup. */
  sites: "sites",
  /** Synchronised. The typed configuration address, trimmed. Written only by the Popup. */
  configUrl: "configUrl",
  /** Durable. The panel's slice of each Site's last configuration, by origin. Written only by the Worker. */
  configSlices: "configSlices",
  /** Session. The Worker's per-tab stash. Written only by the Worker. */
  stash: "stash",
} as const;

/** The synchronised names the Page Host and the Worker react to. */
export const SETTINGS_KEYS: readonly string[] = [STORAGE.sites, STORAGE.configUrl];

/** The Editor's settings after validation. */
export interface Settings {
  /** The Listed Sites. Listed is the Editor's intent; whether the browser Granted access is a separate fact. */
  sites: string[];
  /** The configuration address, trimmed; empty when there is none. */
  configUrl: string;
}

/**
 * Narrows what synchronised storage returned to settings. The store is
 * untrusted: it can be written from another device or by anything running as
 * the Extension. Anything that is not a list is no Sites, an entry is kept only
 * if it is a string equal to its own origin, and an address that is not a
 * string is no address.
 */
export function readSettings(stored: unknown): Settings {
  const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const rawSites = record[STORAGE.sites];
  const sites = Array.isArray(rawSites) ? [...new Set(rawSites.filter(isSite))] : [];
  const rawUrl = record[STORAGE.configUrl];
  return { sites, configUrl: typeof rawUrl === "string" ? rawUrl.trim() : "" };
}

/** A key-value store port over one extension storage area. */
export interface KeyValueStore {
  /** Reads one value; resolves with nothing when it was never written. May reject: callers treat that as empty. */
  get(key: string): Promise<unknown>;
  /** Writes one value. May reject: callers swallow it, since the in-memory copy is still correct. */
  set(key: string, value: unknown): Promise<void>;
}
