import { isHttpUrl } from "@intl-tms/core/tools";
import type { HiddenItem, LocaleWrite } from "@intl-tms/core/tools";
import type { SchemaDef, Usage, ValuesEnvelope } from "@intl-tms/core";
import type { SignInStatus } from "./sign-in.js";

/**
 * The message protocol, defined once and imported by every context. The shapes
 * are independent of how they travel: the same messages ride the Worker relay
 * or any other transport.
 */

/** The context a message is for. A context acts only on what is addressed to it. */
export type Destination = "worker" | "page" | "panel";

/** The parts of the served configuration the Side Panel needs. `schema` is `null` when the website declares none. */
export interface ConfigSlice {
  languages: string[];
  schema: SchemaDef | null;
  sourceLocale?: string;
}

/** The translation the Editor is editing, as stashed by the Worker and as the reply to panel-ready. */
export interface Selection {
  key: string;
  /** The Current Locale when it was clicked. */
  locale: string;
  /** The on-page value, Markers stripped. */
  value: string;
  /** Attached once loaded. */
  values?: ValuesEnvelope;
  /** Attached once loaded. */
  usages?: Usage[];
}

/** Why edit mode is, or is not, working on a page. Reported by the Page Host whenever it changes. */
export interface PageStatus {
  site: string;
  gate: "on" | "off";
  toggle: "set" | "blocked" | "pending-reload" | "not-kept";
  /** Whether the last scan found Markers. Absent until a scan completed. */
  marked?: boolean;
  config: "loaded" | "loading" | "failed" | "none";
  /** Why the configuration failed, in words. */
  configReason?: string;
  protocol: "compatible" | "website-newer" | "website-older" | "unknown";
  /** How many translations the last scan found. */
  found?: { text: number; hidden: number };
  /** Whether the website lets the Editor in. Absent until the website answered. */
  signIn?: SignInStatus;
}

/** The reply to panel-ready: the stashed Selection with the tab and Site it belongs to, or nothing. */
export interface PanelSeed {
  tab: number;
  site?: string;
  selection: Selection;
}

/** Every message kind and its payload. Optional members have defaults at the receiver. */
export interface Payloads {
  /** A translation was clicked or opened from the Hidden list. Also the Worker's cue to open the panel. */
  "selection-opened": { key: string; locale: string; value: string };
  /** The open key's stored values arrived, or failed. `values` defaults to an empty envelope. */
  "values-loaded": { key: string; values?: ValuesEnvelope; error?: boolean };
  /** The open key's usages arrived, or failed. `usages` defaults to an empty list. */
  "usage-loaded": { key: string; usages?: Usage[]; error?: boolean };
  /** The panel's slice of a configuration that loaded. `languages` defaults to an empty list. */
  "config-loaded": { config?: Partial<ConfigSlice> };
  /** The page's Hidden list changed. `items` defaults to an empty list. */
  "hidden-changed": { items?: HiddenItem[] };
  /** The page's status changed. Stashed by the Worker; nothing displays it yet. */
  "status-changed": { status: PageStatus };
  /** The Side Panel loaded. Replied to with a {@link PanelSeed} or `null`. */
  "panel-ready": Record<string, never>;
  /** Save a key's writes per Locale. Replied to with a save result. `values` defaults to no writes. */
  save: { key: string; values?: Record<string, LocaleWrite> };
  /** Send the page to an address. */
  navigate: { url: string };
  /** Flash a Hidden item on the page, by its stable identity. */
  flash: { id: string };
  /** Open a Hidden item for editing, by its stable identity. */
  "open-hidden": { id: string };
}

/** A message kind. */
export type Kind = keyof Payloads;

/** One message: a kind, a payload of plain data, and who it is for. */
export interface Message<K extends Kind = Kind> {
  to: Destination;
  kind: K;
  payload: Payloads[K];
  /** The tab this concerns. Stamped by the Worker on what it relays; named by the panel on commands. */
  tab?: number;
  /** The Site of that tab. Stamped by the Worker. */
  site?: string;
  /** New for every opening, even of the same key, so late answers can be matched to their selection. */
  selection?: string;
}

/** The kinds each context receives. Adding a kind here without handling it at its receiver fails the type check. */
export const RECEIVES = {
  worker: [
    "selection-opened",
    "values-loaded",
    "usage-loaded",
    "config-loaded",
    "hidden-changed",
    "status-changed",
    "panel-ready",
    "save",
    "navigate",
    "flash",
    "open-hidden",
  ],
  panel: ["selection-opened", "values-loaded", "usage-loaded", "config-loaded", "hidden-changed"],
  page: ["save", "navigate", "flash", "open-hidden"],
} as const satisfies Record<Destination, readonly Kind[]>;

/** The kinds a context receives. */
export type KindFor<D extends Destination> = (typeof RECEIVES)[D][number];

/** A validated message addressed to a context. */
export type MessageFor<D extends Destination> = { [K in KindFor<D>]: Message<K> & { to: D } }[KindFor<D>];

/** One handler per kind a context receives: exhaustive by construction. */
export type Handlers<D extends Destination, R> = { [K in KindFor<D>]: (message: Message<K>) => R };

/** Runs the handler for a validated message. */
export function dispatch<D extends Destination, R>(handlers: Handlers<D, R>, incoming: MessageFor<D>): R {
  const handler = handlers[incoming.kind as KindFor<D>] as (message: Message) => R;
  return handler(incoming);
}

/** Builds a message. */
export function message<K extends Kind>(
  to: Destination,
  kind: K,
  payload: Payloads[K],
  ids: { tab?: number | undefined; site?: string | undefined; selection?: string | undefined } = {},
): Message<K> {
  return {
    to,
    kind,
    payload,
    ...(ids.tab === undefined ? {} : { tab: ids.tab }),
    ...(ids.site === undefined ? {} : { site: ids.site }),
    ...(ids.selection === undefined ? {} : { selection: ids.selection }),
  };
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);
const optional = (value: unknown, test: (present: unknown) => boolean) => value === undefined || test(value);
const isEnvelope = (value: unknown) => isObject(value) && isObject(value.locales);
const hasKey = (payload: Loose) => typeof payload.key === "string";
const hasId = (payload: Loose) => typeof payload.id === "string";

/** The runtime check of each payload, kept beside the one definition of its shape. */
const VALID: { [K in Kind]: (payload: Loose) => boolean } = {
  "selection-opened": (p) => hasKey(p) && typeof p.locale === "string" && typeof p.value === "string",
  "values-loaded": (p) => hasKey(p) && optional(p.values, isEnvelope),
  "usage-loaded": (p) => hasKey(p) && optional(p.usages, Array.isArray),
  "config-loaded": (p) => optional(p.config, isObject),
  "hidden-changed": (p) => optional(p.items, Array.isArray),
  "status-changed": (p) => isObject(p.status),
  "panel-ready": () => true,
  save: (p) => hasKey(p) && optional(p.values, isObject),
  // The address ends in a navigation of the page, where a script-scheme address would run code.
  navigate: (p) => typeof p.url === "string" && isHttpUrl(p.url),
  flash: hasId,
  "open-hidden": hasId,
};

/**
 * Narrows an untrusted value to a message addressed to `to`, or to nothing. A
 * message is untrusted until its destination, its kind and its payload's shape
 * are known; anything else is ignored by its receiver without a reply.
 */
export function parseFor<D extends Destination>(to: D, raw: unknown): MessageFor<D> | undefined {
  if (!isObject(raw) || raw.to !== to || typeof raw.kind !== "string") return undefined;
  const kind = raw.kind as Kind;
  if (!(RECEIVES[to] as readonly string[]).includes(kind)) return undefined;
  const payload = raw.payload === undefined ? {} : raw.payload;
  if (!isObject(payload) || !VALID[kind](payload)) return undefined;
  return message(to, kind, payload as never, {
    tab: typeof raw.tab === "number" ? raw.tab : undefined,
    site: typeof raw.site === "string" ? raw.site : undefined,
    selection: typeof raw.selection === "string" ? raw.selection : undefined,
  }) as MessageFor<D>;
}

/** A save that failed as a whole: no Locale was written. */
export function failedSave(error: string): { ok: false; error: string; results: Record<string, never> } {
  return { ok: false, error, results: {} };
}
