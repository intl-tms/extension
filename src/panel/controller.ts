import { isHttpUrl } from "@intl-tms/core/tools";
import type { HiddenItem, PanelConfig, PanelWrite, PersistOutcome } from "@intl-tms/core/tools";
import type { Usage, ValuesEnvelope } from "@intl-tms/core";
import { dispatch, message, parseFor, type Kind, type Message, type Payloads } from "../shared/protocol.js";
import { readSignInStatus, type SignInStatus } from "../shared/sign-in.js";

/** The panel view's inbound calls, which mirror the Core panel store's one to one. */
export interface PanelDriver {
  open(key: string, locale: string, onPageValue: string): void;
  setValues(key: string, values: ValuesEnvelope, error: boolean): void;
  setUsage(key: string, usages: Usage[], error: boolean): void;
  setConfig(config: PanelConfig): void;
  setHidden(items: HiddenItem[]): void;
  /** What the website last said about letting the Editor in, validated. */
  setSignIn(status: SignInStatus | undefined): void;
}

/** What the panel view calls when the Editor acts. */
export interface PanelCallbacks {
  /** Saves a key's writes. Resolves with the result, or with nothing when there was no answer at all. Never rejects. */
  save(key: string, writes: Record<string, PanelWrite>): Promise<PersistOutcome | undefined>;
  /** Goes to a "Used on" address. */
  navigate(url: string): void;
  /** Flashes a Hidden item on the page. */
  flash(id: string): void;
  /** Opens a Hidden item for editing, as if it had been clicked on the page. */
  openHidden(id: string): void;
  /** Opens the website's sign-in address in a new tab. */
  signIn(url: string): void;
}

/** What the controller needs from the browser. */
export interface ControllerPorts {
  /** Sends a message to the Worker. Resolves with its reply, if any; may throw or reject when nobody is listening. */
  send(message: Message): unknown;
  /** Opens an address in a new tab. */
  openTab(url: string): void;
}

/** The Side Panel's half of the protocol: a mapping between messages and the panel view's driver. */
export interface Controller {
  /** Connects the view's driver. Messages before this are not handled. */
  bind(driver: PanelDriver): void;
  /** Maps one inbound message onto one driver call. Returns whether it handled the message. */
  handle(raw: unknown): boolean;
  /** Seeds the view from the panel-ready reply: open, then values if any, then usages if any. */
  seed(reply: unknown): void;
  callbacks: PanelCallbacks;
  /** The Site of the Selection the panel shows, when known. */
  site(): string | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Creates the controller. */
export function createController(ports: ControllerPorts): Controller {
  let driver: PanelDriver | undefined;
  /** The tab the shown Selection was clicked in: where its save and navigation go. */
  let selectionTab: number | undefined;
  let selectionSite: string | undefined;
  /** The tab that produced the shown Hidden list: where flash and open go. */
  let hiddenTab: number | undefined;

  function send<K extends Kind>(kind: K, payload: Payloads[K], tab: number | undefined): Promise<unknown> {
    try {
      return Promise.resolve(ports.send(message("worker", kind, payload, { tab })));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Sent without waiting for anything; nobody listening is a normal event. */
  function fire<K extends Kind>(kind: K, payload: Payloads[K], tab: number | undefined): void {
    void send(kind, payload, tab).catch(() => undefined);
  }

  return {
    bind(bound) {
      driver = bound;
    },

    handle(raw) {
      const target = driver;
      const incoming = parseFor("panel", raw);
      if (target === undefined || incoming === undefined) return false;
      dispatch<"panel", void>(
        {
          "selection-opened": ({ payload, tab, site }) => {
            selectionTab = tab;
            selectionSite = site;
            target.open(payload.key, payload.locale, payload.value);
          },
          "values-loaded": ({ payload }) => target.setValues(payload.key, payload.values ?? { locales: {} }, payload.error === true),
          "usage-loaded": ({ payload }) => target.setUsage(payload.key, payload.usages ?? [], payload.error === true),
          "config-loaded": ({ payload }) =>
            target.setConfig({
              locales: payload.config?.languages ?? [],
              schema: payload.config?.schema ?? undefined,
              sourceLocale: payload.config?.sourceLocale,
            }),
          "hidden-changed": ({ payload, tab }) => {
            hiddenTab = tab;
            target.setHidden(payload.items ?? []);
          },
          "sign-in-changed": ({ payload, tab }) => {
            // The panel speaks for the tab whose translation it shows.
            if (selectionTab !== undefined && tab !== selectionTab) return;
            target.setSignIn(readSignInStatus(payload.status));
          },
        },
        incoming,
      );
      return true;
    },

    seed(reply) {
      if (driver === undefined || !isObject(reply) || typeof reply.tab !== "number" || !isObject(reply.selection)) return;
      const { key, locale, value, values, usages } = reply.selection;
      if (typeof key !== "string" || typeof locale !== "string" || typeof value !== "string") return;
      selectionTab = reply.tab;
      selectionSite = typeof reply.site === "string" ? reply.site : undefined;
      driver.open(key, locale, value);
      if (isObject(values) && isObject(values.locales)) driver.setValues(key, values as unknown as ValuesEnvelope, false);
      if (Array.isArray(usages)) driver.setUsage(key, usages as Usage[], false);
    },

    callbacks: {
      // The panel is the only party that knows what the Editor is looking at, so it names the key.
      async save(key, writes) {
        let reply: unknown;
        try {
          reply = await send("save", { key, values: writes }, selectionTab);
        } catch {
          // Worker gone, or nobody listening: "no answer", which the store reports as a connection error.
          return undefined;
        }
        if (!isObject(reply) || typeof reply.ok !== "boolean" || !isObject(reply.results)) return undefined;
        return reply as unknown as PersistOutcome;
      },
      navigate(url) {
        if (!isHttpUrl(url)) return;
        // A store row must not move the Editor's tab to another website: another origin opens beside it.
        if (selectionSite !== undefined && new URL(url).origin !== selectionSite) ports.openTab(url);
        else fire("navigate", { url }, selectionTab);
      },
      flash: (id) => fire("flash", { id }, hiddenTab),
      openHidden: (id) => fire("open-hidden", { id }, hiddenTab),
      signIn(url) {
        // Checked immediately before opening. The Extension never fetches it; the browser opens it beside the page, which keeps its draft.
        if (isHttpUrl(url)) ports.openTab(url);
      },
    },

    site: () => selectionSite,
  };
}
