import { PROTOCOL_VERSION, TOGGLE_COOKIE_NAME, TOGGLE_ON_VALUE, normalizeUrl, strip, type ResolvedConfig } from "@intl-tms/core";
import {
  DEFAULT_TIME_LIMIT_MS,
  aggregateUsage,
  createClient,
  createSession,
  isHelpText,
  isHttpUrl,
  readSignInDescriptor,
  resolveLocale,
  type Found,
  type RequestFn,
} from "@intl-tms/core/tools";
import { dispatch, failedSave, message, parseFor, type ConfigSlice, type Kind, type Message, type PageStatus, type Payloads } from "../shared/protocol.js";
import type { SignInStatus } from "../shared/sign-in.js";
import { readSettings } from "../shared/storage.js";
import { CONFIG_REASONS, CONSOLE } from "../shared/strings.js";

/** How long the Toggle lives, in seconds. Renewed on every page load while edit mode is on. */
export const TOGGLE_LIFETIME_S = 12 * 60 * 60;

/** The longest error text carried from the page to the panel. */
export const ERROR_TEXT_LIMIT = 500;

const RELOAD_GUARD = "intl-tms:reloaded-for-toggle";

/** Sends messages towards the Extension. Sending is fire and forget; the Page Host swallows every failure. */
export interface Messenger {
  /** May throw, or return a promise that rejects, when nobody is listening or the Extension was torn down. */
  send(message: Message): unknown;
}

/** The page's cookies. Injectable because a site can drop writes, which a test must be able to simulate. */
export interface CookiePort {
  /** Every cookie visible to the page, as `name=value` pairs joined by `; `. */
  read(): string;
  /** Writes one cookie string. A site with cookies blocked drops it silently. */
  write(cookie: string): void;
}

/** A small string store that lasts for the tab's session and survives a reload. */
export interface TabSessionPort {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** What {@link createPageHost} is built from. Every external effect is injected; each has a real default. */
export interface PageHostOptions {
  messenger: Messenger;
  /** The page's document. */
  document?: Document;
  /** Page navigation: reload, and go to an address. */
  navigation?: { reload(): void; assign(url: string): void };
  /** Requests made from inside the page, so the website's own session authorizes them. */
  request?: RequestFn;
  /** The page's own origin: what the Gate compares against the Listed Sites. */
  origin?: string;
  /** The time limit of every request, the configuration fetch included. */
  timeoutMs?: number;
  cookies?: CookiePort | undefined;
  tabSession?: TabSessionPort;
  /** Where reasons a developer will look for are written. */
  console?: Pick<Console, "warn" | "error">;
  timers?: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

/** The Page Host: a Host of the Core's editing session inside an enabled website. */
export interface PageHost {
  /**
   * Applies the stored settings, read together as one object. Evaluates the
   * Gate and switches the page on or off to match. Safe to overlap: if settings
   * change again while an earlier application is waiting for the
   * configuration, the earlier one yields.
   */
  applySettings(stored: unknown): Promise<void>;
  /** Switches edit mode off on this page. Does nothing when it was never on. */
  switchOff(): void;
  /**
   * Handles one inbound message. Returns whether a reply is pending: true only
   * for a valid save, which is then answered exactly once.
   */
  handleMessage(raw: unknown, reply: (result: unknown) => void): boolean;
}

type ConfigLoad = { ok: true; config: ResolvedConfig; editor?: string } | { ok: false; reason: string; protocol?: PageStatus["protocol"] };

const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, ERROR_TEXT_LIMIT);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a parsed response has the shape of a served configuration. */
function isConfiguration(value: unknown): value is ResolvedConfig {
  return (
    isObject(value) &&
    Array.isArray(value.locales) &&
    value.locales.every((locale) => typeof locale === "string") &&
    isObject(value.endpoints) &&
    typeof value.endpoints.values === "string" &&
    (value.schema === undefined || isObject(value.schema)) &&
    (value.sourceLocale === undefined || typeof value.sourceLocale === "string")
  );
}

function tabSessionOf(document: Document): TabSessionPort {
  const storage = () => document.defaultView?.sessionStorage;
  const safely = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  return {
    get: (key) => safely(() => storage()?.getItem(key) ?? null, null),
    set: (key, value) => safely(() => storage()?.setItem(key, value), undefined),
    remove: (key) => safely(() => storage()?.removeItem(key), undefined),
  };
}

/**
 * Creates the Page Host. Nothing happens at construction: it is inert until
 * settings are applied and the Gate passes.
 *
 * It contains no editing logic. Scanning, outlining, the click flow, reading,
 * saving and writing back into the page are the Core session's; this module
 * supplies only what an extension knows: the Gate, the Toggle, the
 * configuration, the messages, and what to do when the page cannot show what
 * was just saved.
 */
export function createPageHost(options: PageHostOptions): PageHost {
  const document = options.document ?? globalThis.document;
  const origin = options.origin ?? document.location.origin;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIME_LIMIT_MS;
  const website: RequestFn = options.request ?? ((url, init) => fetch(url, init));
  const console = options.console ?? globalThis.console;
  const navigation = options.navigation ?? {
    reload: () => document.location.reload(),
    assign: (url) => document.location.assign(url),
  };
  const cookies: CookiePort = options.cookies ?? {
    read: () => document.cookie,
    write: (cookie) => {
      document.cookie = cookie;
    },
  };
  const tabSession = options.tabSession ?? tabSessionOf(document);
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number): unknown => setTimeout(callback, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };

  /** The configuration last fetched, and the address it came from. */
  let config: ResolvedConfig | undefined;
  let configSource: string | undefined;
  let loading: { source: string; result: Promise<ConfigLoad> } | undefined;
  /** The Gate passed and the Toggle is present: edit mode is on for this page. */
  let active = false;
  let started = false;
  /** Bumped on every application of settings, so an overtaken one can tell. */
  let generation = 0;
  let selection: string | undefined;
  let selections = 0;
  const pageId = Math.random().toString(36).slice(2, 8);
  let status: PageStatus | undefined;
  let lastStatus = "";

  // Fire and forget, and never throws: a closed panel, a starting Worker and
  // an Extension torn down mid-send are all normal.
  function send<K extends Kind>(kind: K, payload: Payloads[K], withSelection = false): void {
    try {
      const outcome = options.messenger.send(message("worker", kind, payload, withSelection ? { selection } : {}));
      if (outcome instanceof Promise) outcome.catch(() => undefined);
    } catch {
      // Nobody listening.
    }
  }

  function report(change: Partial<PageStatus>): void {
    status = { site: origin, gate: "on", toggle: "set", config: "none", protocol: "unknown", ...status, ...change };
    const serialised = JSON.stringify(status);
    if (serialised === lastStatus) return;
    lastStatus = serialised;
    send("status-changed", { status });
  }

  /** What the website last said about letting the Editor in. */
  let signIn: SignInStatus | undefined;
  /** The website's session cookie travels to another origin: requests include credentials for the rest of this page load. */
  let withCredentials = false;
  /** The configuration must be fetched again on the next application of settings, even from the same address. */
  let refetch = false;
  let lastStored: unknown;

  function setSignIn(next: SignInStatus): void {
    const previous = signIn;
    signIn = next;
    report({ signIn: next });
    // The website marks a page only for a signed-in Editor, so a page loaded
    // while signed out has nothing to edit, and no draft to lose. A page with
    // Markers lost its session mid-edit and keeps its draft instead.
    if (previous?.state === "not-signed-in" && next.state === "accepted" && status?.marked !== true) navigation.reload();
  }

  /** What a response says about signing in. The body is read from a copy, so the caller still reads it. */
  async function observe(response: Response): Promise<void> {
    if (response.ok) {
      setSignIn(signIn?.state === "accepted" ? signIn : { state: "accepted" });
      return;
    }
    if (response.status !== 401 && response.status !== 403) return;
    let body: unknown;
    try {
      body = JSON.parse(await response.clone().text());
    } catch {
      body = undefined;
    }
    if (response.status === 401) {
      const descriptor = readSignInDescriptor(body);
      setSignIn(descriptor === undefined ? { state: "not-signed-in" } : { state: "not-signed-in", descriptor });
      return;
    }
    // A 403 for a foreign origin is about the request, not about the Editor.
    if (!isObject(body) || body.code !== "forbidden") return;
    setSignIn({ state: "not-permitted" });
  }

  /**
   * Every request to the website, the configuration included, goes through
   * here: made from inside the page so the website's own session authorizes
   * it, and watched for what the answer says about signing in.
   */
  const request: RequestFn = async (url, init) => {
    const attempt = () => website(url, withCredentials ? { ...init, credentials: "include" } : init);
    let response = await attempt();
    if (response.status === 401 && !withCredentials) {
      let body: unknown;
      try {
        body = JSON.parse(await response.clone().text());
      } catch {
        body = undefined;
      }
      if (readSignInDescriptor(body)?.credentials === true) {
        withCredentials = true;
        response = await attempt();
      }
    }
    await observe(response);
    return response;
  };

  /** After a "not signed in", coming back to the page asks the website again: the Editor may have signed in in another tab. */
  function onVisibility(): void {
    if (document.visibilityState !== "visible" || !active || signIn?.state !== "not-signed-in") return;
    refetch = true;
    void applySettings(lastStored);
  }

  const client = createClient({ getConfig: () => config, request, timeoutMs, ...(options.timers ? { timers: options.timers } : {}) });

  function locale(): string {
    const declared = document.documentElement.getAttribute("lang")?.trim() ?? "";
    // A guess, but at a Locale that exists.
    if (declared === "") return config?.sourceLocale ?? config?.locales[0] ?? "";
    return resolveLocale(declared, config?.locales ?? []);
  }

  function onScan(found: readonly Found[]): void {
    const hidden = found.filter((item) => item.kind === "attribute").length;
    report({ marked: found.length > 0, found: { text: found.length - hidden, hidden } });
    try {
      const title = strip(document.title);
      // Nothing waits on a report, and a failure never affects highlighting.
      void client
        .reportUsage({ url: normalizeUrl(document.location.href), ...(title === "" ? {} : { title }), keys: aggregateUsage(found) })
        .catch(() => undefined);
    } catch {
      // A report must never block highlighting.
    }
  }

  const session = createSession({
    client,
    getConfig: () => config,
    getLocale: locale,
    onScan,
    sink: {
      open(key, openedIn, value) {
        selection = `s-${pageId}-${++selections}`;
        send("selection-opened", { key, locale: openedIn, value }, true);
      },
      setValues: (key, values, error) => send("values-loaded", { key, values, error }, true),
      setUsage: (key, usages, error) => send("usage-loaded", { key, usages, error }, true),
      setHidden: (items) => send("hidden-changed", { items }),
    },
  });

  const toggleCookie = () => `${TOGGLE_COOKIE_NAME}=${TOGGLE_ON_VALUE}; Path=/; SameSite=Lax; Max-Age=${TOGGLE_LIFETIME_S}${origin.startsWith("https:") ? "; Secure" : ""}`;

  // Recognised exactly: that name with that value. Another cookie can end with its name.
  function hasToggle(): boolean {
    return cookies
      .read()
      .split(";")
      .some((pair) => pair.trim() === `${TOGGLE_COOKIE_NAME}=${TOGGLE_ON_VALUE}`);
  }

  async function fetchConfig(source: string): Promise<ConfigLoad> {
    const controller = new AbortController();
    let timer: unknown;
    const limit = new Promise<ConfigLoad>((resolve) => {
      timer = timers.setTimeout(() => {
        controller.abort();
        resolve({ ok: false, reason: CONFIG_REASONS.timedOut(timeoutMs) });
      }, timeoutMs);
    });
    const attempt = async (): Promise<ConfigLoad> => {
      // The source is used verbatim: nothing is appended, nothing is defaulted.
      const response = await request(source, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) return { ok: false, reason: CONFIG_REASONS.status(response.status) };
      const type = response.headers.get("content-type") ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        return { ok: false, reason: CONFIG_REASONS.notConfiguration(type.includes("html") ? "an HTML page" : "something that is not JSON") };
      }
      if (!isConfiguration(parsed)) return { ok: false, reason: CONFIG_REASONS.notConfiguration("JSON of another shape") };
      const served = (parsed as { protocol?: unknown }).protocol;
      if (typeof served === "number" && served > PROTOCOL_VERSION) return { ok: false, reason: CONFIG_REASONS.websiteNewer, protocol: "website-newer" };
      if (typeof served === "number" && served < PROTOCOL_VERSION) return { ok: false, reason: CONFIG_REASONS.websiteOlder, protocol: "website-older" };
      // Who the website says the Editor is, shown only: one short line of text or nothing.
      const access = (parsed as { access?: unknown }).access;
      const editor = isObject(access) && isHelpText(access.name) ? access.name : undefined;
      return editor === undefined ? { ok: true, config: parsed } : { ok: true, config: parsed, editor };
    };
    try {
      return await Promise.race([attempt(), limit]);
    } catch (error) {
      return { ok: false, reason: textOf(error) };
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /** Loads the configuration from `source`, sharing one request between overlapping applications. */
  function loadConfig(source: string): Promise<ConfigLoad> {
    if (loading?.source === source) return loading.result;
    const result = fetchConfig(source).finally(() => {
      if (loading?.result === result) loading = undefined;
    });
    loading = { source, result };
    return result;
  }

  function slice(served: ResolvedConfig): ConfigSlice {
    return {
      languages: [...served.locales],
      schema: served.schema ?? null,
      ...(served.sourceLocale === undefined ? {} : { sourceLocale: served.sourceLocale }),
    };
  }

  function stopSession(): void {
    if (!started) return;
    started = false;
    session.stop();
  }

  function switchOff(): void {
    generation++;
    if (!active) return;
    active = false;
    document.removeEventListener("visibilitychange", onVisibility);
    cookies.write(`${TOGGLE_COOKIE_NAME}=; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    tabSession.remove(RELOAD_GUARD);
    stopSession();
    client.resetUsage();
    // The session stops silently, and the panel is still open beside a page that now has nothing to edit.
    send("hidden-changed", { items: [] });
    report({ gate: "off" });
  }

  async function applySettings(stored: unknown): Promise<void> {
    const run = ++generation;
    lastStored = stored;
    const settings = readSettings(stored);
    if (settings.configUrl === "" || !settings.sites.includes(origin)) {
      switchOff();
      return;
    }

    if (!hasToggle()) {
      if (tabSession.get(RELOAD_GUARD) !== null) {
        // Already reloaded for the Toggle and it is not here: reloading again would loop.
        tabSession.remove(RELOAD_GUARD);
        console.warn(CONSOLE.cookieNotKept(TOGGLE_COOKIE_NAME));
        report({ gate: "on", toggle: "not-kept" });
        return;
      }
      cookies.write(toggleCookie());
      if (!hasToggle()) {
        // The write was dropped. Reloading would loop, once per page load.
        console.warn(CONSOLE.cookieDropped(TOGGLE_COOKIE_NAME));
        report({ gate: "on", toggle: "blocked" });
        return;
      }
      tabSession.set(RELOAD_GUARD, "1");
      report({ gate: "on", toggle: "pending-reload" });
      navigation.reload();
      return;
    }

    if (!active) {
      active = true;
      document.addEventListener("visibilitychange", onVisibility);
      tabSession.remove(RELOAD_GUARD);
      // Renewed while edit mode is in use, so a Toggle nobody can clear any more expires on its own.
      cookies.write(toggleCookie());
    }
    report({ gate: "on", toggle: "set" });

    if (config === undefined || configSource !== settings.configUrl || refetch) {
      refetch = false;
      report({ config: "loading" });
      const loaded = await loadConfig(settings.configUrl);
      // Settings changed again while this waited: the later application decides.
      if (run !== generation) return;
      if (loaded.ok) {
        config = loaded.config;
        configSource = settings.configUrl;
        report({ config: "loaded", protocol: "compatible", configReason: undefined });
        if (loaded.editor !== undefined && signIn?.state === "accepted") setSignIn({ state: "accepted", editor: loaded.editor });
        send("config-loaded", { config: slice(config) });
      } else {
        // The previous configuration, or none, stays in place.
        console.error(CONSOLE.configFailed(loaded.reason));
        report({ config: "failed", configReason: loaded.reason, protocol: loaded.protocol ?? "unknown" });
        if (loaded.protocol !== undefined) {
          // An incompatible website must not start half-working.
          stopSession();
          return;
        }
      }
    }

    // A failed configuration does not stop highlighting: the Editor sees a
    // page that responds and a panel that says what is wrong.
    if (!started) {
      started = true;
      session.start(document);
    }
  }

  async function save(key: string, writes: Payloads["save"]["values"], reply: (result: unknown) => void): Promise<void> {
    // Every path ends in exactly one reply, and a reply channel that has closed is not a failure.
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
      // The key the panel named: the session refuses one that is not the active translation.
      const outcome = await session.save(key, writes ?? {});
      // Answer first. A reload unloads the page and with it the pending reply,
      // which would turn a save that succeeded into "the page did not answer".
      answer(outcome);
      if (outcome.page === "stale") {
        // Only the website's formatter can render it, and the website reads translations per request.
        try {
          navigation.reload();
        } catch (error) {
          console.error(CONSOLE.reloadFailed(textOf(error)));
        }
      }
    } catch (error) {
      // The panel is another page: without this the cause is visible only in this page's console.
      answer(failedSave(`internal: ${textOf(error)}`));
    }
  }

  function navigate(url: string): void {
    // Checked immediately before navigating, whatever was checked earlier.
    if (!active || !isHttpUrl(url)) return;
    // A usage row comes from the store and must not move the Editor's tab to another website silently.
    if (new URL(url).origin !== origin) return;
    // The destination is a different page and must be reported even if its keys happen to match.
    client.resetUsage();
    navigation.assign(url);
  }

  function handleMessage(raw: unknown, reply: (result: unknown) => void): boolean {
    try {
      const incoming = parseFor("page", raw);
      if (incoming === undefined) return false;
      return dispatch<"page", boolean>(
        {
          save: ({ payload }) => {
            void save(payload.key, payload.values, reply);
            return true;
          },
          navigate: ({ payload }) => {
            navigate(payload.url);
            return false;
          },
          flash: ({ payload }) => {
            if (active) session.flashHidden(payload.id);
            return false;
          },
          "open-hidden": ({ payload }) => {
            if (active) session.openHidden(payload.id);
            return false;
          },
        },
        incoming,
      );
    } catch {
      return false;
    }
  }

  return { applySettings, switchOff, handleMessage };
}
