import type { HiddenItem } from "@intl-tms/core/tools";
import {
  dispatch,
  failedSave,
  message,
  parseFor,
  type ConfigSlice,
  type Kind,
  type Message,
  type PageStatus,
  type PanelSeed,
  type Selection,
} from "../shared/protocol.js";
import { siteOf } from "../shared/site.js";
import { STORAGE, type KeyValueStore } from "../shared/storage.js";

/** The most one tab's stash may hold, in characters of JSON. Attached values beyond it are dropped and re-read on demand. */
export const STASH_BOUND = 256 * 1024;

/** Who sent a message, as far as the Worker can tell. */
export interface Sender {
  /** True for one of the Extension's own pages (the Side Panel, the Popup); false for a page script. */
  extension: boolean;
  /** The sender's tab. Absent for an extension page that is not in a tab. */
  tab?: number;
  /** The Site of the sender's page. */
  site?: string;
}

/**
 * Tells one of the Extension's own pages from a page script. The Page Host is
 * the least trusted context: only an extension page may issue a command.
 */
export function classifySender(sender: { tab?: { id?: number | undefined } | undefined; url?: string | undefined }, extensionOrigin: string): Sender {
  if (sender.url !== undefined && sender.url.startsWith(`${extensionOrigin}/`)) return { extension: true };
  const site = siteOf(sender.url);
  return {
    extension: false,
    ...(sender.tab?.id === undefined ? {} : { tab: sender.tab.id }),
    ...(site === undefined ? {} : { site }),
  };
}

/** What the relay needs from the browser. */
export interface RelayPorts {
  /** Pushes a message to the Side Panel. May throw or reject when no panel is listening, which is the normal case before the first click; the relay swallows both. */
  pushToPanel(message: Message): unknown;
  /** Sends a message to a tab's Page Host and resolves with its reply. Rejects when the tab cannot be reached. */
  sendToTab(tab: number, message: Message): Promise<unknown>;
  /** Opens the Side Panel for a tab. Only works inside a user gesture; may throw or reject, and the relay swallows both. */
  openPanel(tab: number): unknown;
  /** Survives a browser restart. */
  durable: KeyValueStore;
  /** Survives a Worker restart; cleared when the browser closes. */
  session: KeyValueStore;
}

/** The relay: the Worker's message handling. The only thing that knows both ends. */
export interface Relay {
  /**
   * Handles one message. Returns whether a reply is pending: true only for
   * panel-ready and save, each of which is then answered exactly once.
   */
  handle(raw: unknown, sender: Sender, reply: (result: unknown) => void): boolean;
  /** A tab closed: its stash is dropped. */
  tabClosed(tab: number): void;
  /** A tab started loading a page on `site` (nothing when not disclosed): its stash is dropped if that is another Site. */
  tabNavigated(tab: number, site: string | undefined): void;
}

interface TabStash {
  site?: string;
  selection?: Selection;
  /** The identifier of the opening the Selection came from. */
  selectionId?: string;
  hidden?: HiddenItem[];
  status?: PageStatus;
}

interface Stash {
  tabs: Record<string, TabStash>;
  /** The tab of the most recent Selection. */
  selectionTab: number | null;
  /** The tab that most recently produced a Hidden list. */
  hiddenTab: number | null;
}

interface Slices {
  sites: Record<string, ConfigSlice>;
  /** The Site whose slice was stored last. */
  last: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function readStash(stored: unknown): Stash {
  if (!isObject(stored) || !isObject(stored.tabs)) return { tabs: {}, selectionTab: null, hiddenTab: null };
  return {
    tabs: stored.tabs as Record<string, TabStash>,
    selectionTab: typeof stored.selectionTab === "number" ? stored.selectionTab : null,
    hiddenTab: typeof stored.hiddenTab === "number" ? stored.hiddenTab : null,
  };
}

function readSlices(stored: unknown): Slices {
  if (!isObject(stored) || !isObject(stored.sites)) return { sites: {}, last: null };
  return { sites: stored.sites as Record<string, ConfigSlice>, last: typeof stored.last === "string" ? stored.last : null };
}

/**
 * Creates the relay.
 *
 * It keeps a stash, per tab, for two reasons only: to seed a Side Panel that
 * loads after the fact, and to route a command to the tab it belongs to. The
 * Worker is stopped while the Editor types, so the stash is written to the
 * session store every time it changes and read back once by a starting Worker.
 */
export function createRelay(ports: RelayPorts): Relay {
  const stash: Stash = { tabs: {}, selectionTab: null, hiddenTab: null };
  /** Tabs dropped by this Worker before the restore finished: the restore must not bring them back. */
  const dropped = new Set<number>();
  let slices: Slices = { sites: {}, last: null };

  // The restore never fails: a Worker that cannot read its storage starts empty.
  const restored: Promise<void> = ports.session
    .get(STORAGE.stash)
    .then(readStash, () => readStash(undefined))
    .then((previous) => {
      // What this Worker heard itself is newer than what a previous one stored.
      for (const [tab, stored] of Object.entries(previous.tabs)) {
        if (dropped.has(Number(tab)) || !isObject(stored)) continue;
        const heard = stash.tabs[tab];
        stash.tabs[tab] =
          heard === undefined
            ? stored
            : { ...stored, ...heard, ...(heard.selection === undefined ? {} : { selection: heard.selection, selectionId: heard.selectionId }) };
        if (heard?.selection !== undefined && heard.selectionId === undefined) delete stash.tabs[tab]?.selectionId;
      }
      if (stash.selectionTab === null && previous.selectionTab !== null && !dropped.has(previous.selectionTab)) stash.selectionTab = previous.selectionTab;
      if (stash.hiddenTab === null && previous.hiddenTab !== null && !dropped.has(previous.hiddenTab)) stash.hiddenTab = previous.hiddenTab;
    })
    .catch(() => undefined);

  const slicesReady: Promise<void> = ports.durable
    .get(STORAGE.configSlices)
    .then((stored) => {
      const previous = readSlices(stored);
      slices = { sites: { ...previous.sites, ...slices.sites }, last: slices.last ?? previous.last };
    })
    .catch(() => undefined);

  function persist(): void {
    // After the restore, so a partial stash is never written over what a previous Worker stored.
    void restored.then(() => ports.session.set(STORAGE.stash, stash)).catch(() => undefined);
  }

  function push(outgoing: Message): void {
    try {
      const outcome = ports.pushToPanel(outgoing);
      if (outcome instanceof Promise) outcome.catch(() => undefined);
    } catch {
      // No panel is listening.
    }
  }

  function open(tab: number): void {
    try {
      const outcome = ports.openPanel(tab);
      if (outcome instanceof Promise) outcome.catch(() => undefined);
    } catch {
      // No fresh user gesture.
    }
  }

  function tabStash(sender: Sender): TabStash | undefined {
    if (sender.tab === undefined) return undefined;
    const entry = (stash.tabs[sender.tab] ??= {});
    if (sender.site !== undefined) entry.site = sender.site;
    return entry;
  }

  function relay<K extends Kind>(incoming: Message<K>, sender: Sender, payload = incoming.payload): void {
    push(message("panel", incoming.kind, payload, { tab: sender.tab, site: sender.site, selection: incoming.selection }));
  }

  /** Attaches loaded data to the tab's Selection, if it is for that Selection. */
  function attach(sender: Sender, incoming: Message<"values-loaded"> | Message<"usage-loaded">, set: (selection: Selection) => void): void {
    const entry = sender.tab === undefined ? undefined : stash.tabs[sender.tab];
    const selection = entry?.selection;
    if (entry === undefined || selection === undefined || selection.key !== incoming.payload.key) return;
    if (incoming.selection !== undefined && entry.selectionId !== undefined && incoming.selection !== entry.selectionId) return;
    if (incoming.payload.error === true) return;
    set(selection);
    if (JSON.stringify(entry).length > STASH_BOUND) {
      delete selection.values;
      delete selection.usages;
    }
    persist();
  }

  function drop(tab: number): void {
    dropped.add(tab);
    delete stash.tabs[tab];
    if (stash.selectionTab === tab) stash.selectionTab = null;
    if (stash.hiddenTab === tab) stash.hiddenTab = null;
    persist();
  }

  function forward(tab: number | null, outgoing: Message): void {
    if (tab === null || stash.tabs[tab] === undefined) return;
    // An unreachable tab is a normal event.
    void ports.sendToTab(tab, outgoing).catch(() => undefined);
  }

  /** Runs after the restore and never lets a failure escape. */
  function afterRestore(run: () => void | Promise<void>, onFailure: (error: unknown) => void = () => undefined): void {
    void restored.then(run).catch(onFailure);
  }

  function handle(raw: unknown, sender: Sender, reply: (result: unknown) => void): boolean {
    let incoming;
    try {
      incoming = parseFor("worker", raw);
    } catch {
      return false;
    }
    if (incoming === undefined) return false;
    const isCommand = incoming.kind === "save" || incoming.kind === "navigate" || incoming.kind === "flash" || incoming.kind === "open-hidden" || incoming.kind === "panel-ready";
    // A Page Host can never issue a command, and an extension page never announces.
    if (isCommand !== sender.extension) return false;

    let replied = false;
    const answer = (result: unknown) => {
      if (replied) return;
      replied = true;
      try {
        reply(result);
      } catch {
        // The channel closed.
      }
    };

    try {
      return dispatch<"worker", boolean>(
        {
          "selection-opened": (opened) => {
            const entry = tabStash(sender);
            if (entry !== undefined && sender.tab !== undefined) {
              // Replaces the Selection: values and usages attached to the previous one are dropped.
              entry.selection = { ...opened.payload };
              if (opened.selection === undefined) delete entry.selectionId;
              else entry.selectionId = opened.selection;
              stash.selectionTab = sender.tab;
              persist();
            }
            // Push first, then open. An open with no fresh gesture fails (a row picked in the
            // Hidden list), and pushing second would strand the new Selection.
            relay(opened, sender);
            // Nothing is awaited before this: the click's gesture does not survive a wait.
            if (sender.tab !== undefined) open(sender.tab);
            return false;
          },
          "values-loaded": (loaded) => {
            attach(sender, loaded, (selection) => {
              selection.values = loaded.payload.values ?? { locales: {} };
            });
            relay(loaded, sender);
            return false;
          },
          "usage-loaded": (loaded) => {
            attach(sender, loaded, (selection) => {
              selection.usages = loaded.payload.usages ?? [];
            });
            relay(loaded, sender);
            return false;
          },
          "config-loaded": (loaded) => {
            const config = loaded.payload.config ?? {};
            const slice: ConfigSlice = {
              languages: config.languages ?? [],
              schema: config.schema ?? null,
              ...(config.sourceLocale === undefined ? {} : { sourceLocale: config.sourceLocale }),
            };
            if (sender.site !== undefined) {
              slices.sites[sender.site] = slice;
              slices.last = sender.site;
              void slicesReady.then(() => ports.durable.set(STORAGE.configSlices, slices)).catch(() => undefined);
            }
            relay(loaded, sender);
            return false;
          },
          "hidden-changed": (changed) => {
            const items = changed.payload.items ?? [];
            const entry = tabStash(sender);
            if (entry !== undefined && sender.tab !== undefined) {
              entry.hidden = items;
              stash.hiddenTab = sender.tab;
              persist();
            }
            relay(changed, sender, { items });
            return false;
          },
          "status-changed": (changed) => {
            const entry = tabStash(sender);
            if (entry !== undefined) {
              const before = JSON.stringify(entry.status?.signIn);
              entry.status = changed.payload.status;
              persist();
              // The panel shows only the sign-in part, so only its changes are relayed.
              const signIn = changed.payload.status.signIn;
              if (JSON.stringify(signIn) !== before) push(message("panel", "sign-in-changed", signIn === undefined ? {} : { status: signIn }, { tab: sender.tab, site: sender.site }));
            }
            return false;
          },
          "panel-ready": () => {
            afterRestore(
              async () => {
                await slicesReady;
                const tab = stash.selectionTab;
                const entry = tab === null ? undefined : stash.tabs[tab];
                const hiddenEntry = stash.hiddenTab === null ? undefined : stash.tabs[stash.hiddenTab];
                const site = entry?.site ?? hiddenEntry?.site ?? slices.last ?? undefined;
                const slice = site === undefined ? undefined : slices.sites[site];
                if (slice !== undefined) push(message("panel", "config-loaded", { config: slice }, { site }));
                const signInTab = tab ?? stash.hiddenTab;
                const signIn = signInTab === null ? undefined : stash.tabs[signInTab]?.status?.signIn;
                if (signInTab !== null && signIn !== undefined) push(message("panel", "sign-in-changed", { status: signIn }, { tab: signInTab, site: stash.tabs[signInTab]?.site }));
                if (stash.hiddenTab !== null && hiddenEntry?.hidden !== undefined && hiddenEntry.hidden.length > 0) {
                  push(message("panel", "hidden-changed", { items: hiddenEntry.hidden }, { tab: stash.hiddenTab, site: hiddenEntry.site }));
                }
                const seed: PanelSeed | null =
                  tab === null || entry?.selection === undefined
                    ? null
                    : { tab, ...(entry.site === undefined ? {} : { site: entry.site }), selection: entry.selection };
                answer(seed);
              },
              () => answer(null),
            );
            return true;
          },
          save: (save) => {
            afterRestore(
              async () => {
                // Commands name their tab; one that does not means the latest Selection's.
                const tab = save.tab ?? stash.selectionTab;
                if (tab === null || stash.tabs[tab]?.selection === undefined) {
                  answer(failedSave("no-selection"));
                  return;
                }
                // The key the panel sent, not the stashed one: the page's stale-selection
                // check must compare against what the Editor is looking at.
                answer(await ports.sendToTab(tab, message("page", "save", save.payload)));
              },
              (error) => answer(failedSave(textOf(error))),
            );
            return true;
          },
          navigate: (navigate) => {
            afterRestore(() => forward(navigate.tab ?? stash.selectionTab, message("page", "navigate", navigate.payload)));
            return false;
          },
          flash: (flash) => {
            // To the tab that produced the Hidden list, which need not be the Selection's.
            afterRestore(() => {
              const tab = flash.tab ?? stash.hiddenTab;
              if (tab !== null && stash.tabs[tab]?.hidden !== undefined) forward(tab, message("page", "flash", flash.payload));
            });
            return false;
          },
          "open-hidden": (openHidden) => {
            afterRestore(() => {
              const tab = openHidden.tab ?? stash.hiddenTab;
              if (tab !== null && stash.tabs[tab]?.hidden !== undefined) forward(tab, message("page", "open-hidden", openHidden.payload));
            });
            return false;
          },
        },
        incoming,
      );
    } catch {
      return false;
    }
  }

  return {
    handle,
    tabClosed: drop,
    tabNavigated(tab, site) {
      const entry = stash.tabs[tab];
      if (entry !== undefined && entry.site !== site) drop(tab);
    },
  };
}
