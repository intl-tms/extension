import { createHandler, createMemoryAdapter, encode, resolveConfig, TOGGLE_COOKIE_NAME, type Authorize, type ConfigInput } from "@intl-tms/core";
import type { RequestFn } from "@intl-tms/core/tools";
import { vi } from "vitest";
import { createPageHost, type PageHostOptions } from "../../src/page/page-host.js";
import type { Kind, Message } from "../../src/shared/protocol.js";
import { STORAGE } from "../../src/shared/storage.js";

/** The simulated page's Site (the simulated DOM's default address). */
export const SITE = "http://localhost:3000";
export const BASE = `${SITE}/api/tms`;
export const CONFIG_URL = `${BASE}/config`;
export const TOGGLE = TOGGLE_COOKIE_NAME;

export const mark = (text: string, key: string) => encode(text, key);
export const byId = (id: string) => document.getElementById(id)!;
export const click = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));

/** Lets promise chains and immediates run. Timers are faked, so nothing sleeps. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Runs the highlighter's debounced rescan after a mutation. */
export async function rescan(): Promise<void> {
  await vi.advanceTimersByTimeAsync(600);
  await settle();
}

/** A cookie store standing in for the page's, which can be made to drop writes. */
export function cookieJar(initial: string[] = [], blocked = false) {
  const stored = new Map<string, string>(initial.map((pair) => pair.split("=") as [string, string]));
  const writes: string[] = [];
  return {
    writes,
    stored,
    read: () => [...stored].map(([name, value]) => `${name}=${value}`).join("; "),
    write(cookie: string) {
      writes.push(cookie);
      if (blocked) return;
      const [pair = "", ...attributes] = cookie.split(";").map((part) => part.trim());
      const [name = "", value = ""] = pair.split("=");
      if (attributes.some((attribute) => /^expires=Thu, 01 Jan 1970/i.test(attribute))) stored.delete(name);
      else stored.set(name, value);
    },
  };
}

const hosts: { switchOff(): void }[] = [];

/** Switches off every Page Host a test created, so none keeps following the shared simulated document. */
export function cleanup(): void {
  for (const host of hosts.splice(0)) host.switchOff();
  document.body.innerHTML = "";
}

export interface BootOptions {
  html?: string;
  lang?: string;
  title?: string;
  /** Cookies present when the page loads. Defaults to the Toggle. */
  cookies?: string[];
  cookiesBlocked?: boolean;
  config?: Partial<ConfigInput> | false;
  /** Replaces the website entirely. */
  request?: RequestFn;
  /** The website's authorization check. Defaults to allowing everyone. */
  authorize?: Authorize;
  origin?: string;
  host?: Partial<PageHostOptions>;
  /** A reload of an earlier page: the tab's session storage and cookies carry over. */
  reloadOf?: { jar: ReturnType<typeof cookieJar> };
}

/** A Page Host over a simulated page and a real Core server behind a fake request function. */
export function boot(options: BootOptions = {}) {
  document.head.innerHTML = "";
  document.body.innerHTML = options.html ?? "";
  document.title = options.title ?? "";
  if (options.lang === undefined) document.documentElement.removeAttribute("lang");
  else document.documentElement.lang = options.lang;
  if (!options.reloadOf) window.sessionStorage.clear();

  const config = resolveConfig({ locales: ["en", "da"], basePath: BASE, sourceLocale: "en", ...(options.config || {}) } as ConfigInput);
  const adapter = createMemoryAdapter();
  const handler = createHandler({ config, adapter, authorize: options.authorize ?? (() => true), onError: () => undefined });
  const requests: { url: string; method: string; body?: unknown; credentials?: RequestCredentials }[] = [];
  /** Per-path overrides: a function answering instead of the website. */
  const overrides: { match: (url: string, method: string) => boolean; answer: RequestFn }[] = [];
  const request: RequestFn = async (url, init) => {
    const method = init?.method ?? "GET";
    requests.push({ url, method, ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}), ...(init?.credentials === undefined ? {} : { credentials: init.credentials }) });
    const override = overrides.find((candidate) => candidate.match(url, method));
    if (override) return override.answer(url, init);
    if (options.request) return options.request(url, init);
    if (options.config === false && url === CONFIG_URL) return new Response("nope", { status: 500 });
    return handler(new Request(url, init));
  };

  const sent: Message[] = [];
  const events: string[] = [];
  const reloads = { count: 0 };
  const assigned: string[] = [];
  const jar = options.reloadOf?.jar ?? cookieJar(options.cookies ?? [`${TOGGLE}=1`], options.cookiesBlocked);
  const consoleLines: string[] = [];
  const log = (...parts: unknown[]) => void consoleLines.push(parts.join(" "));

  const host = createPageHost({
    messenger: {
      send: (message) => {
        sent.push(message);
        events.push(`send:${message.kind}`);
      },
    },
    navigation: {
      reload: () => {
        reloads.count++;
        events.push("reload");
      },
      assign: (url) => {
        assigned.push(url);
        events.push("assign");
      },
    },
    request,
    origin: options.origin ?? SITE,
    cookies: jar,
    console: { warn: log, error: log },
    ...options.host,
  });

  hosts.push(host);

  const settings = (sites: unknown = [options.origin ?? SITE], configUrl: unknown = CONFIG_URL) => ({ [STORAGE.sites]: sites, [STORAGE.configUrl]: configUrl });
  const of = <K extends Kind>(kind: K) => sent.filter((message): message is Message<K> => message.kind === kind);
  const last = <K extends Kind>(kind: K) => of(kind).at(-1);
  /** Sends a command and collects its replies. */
  const command = (kind: Kind, payload: unknown) => {
    const replies: unknown[] = [];
    const pending = host.handleMessage({ to: "page", kind, payload }, (result) => {
      replies.push(result);
      events.push("reply");
    });
    return { pending, replies };
  };
  const usageReports = () => requests.filter((entry) => entry.method === "POST" && entry.url.endsWith("/usage"));

  return {
    options,
    host,
    config,
    adapter,
    requests,
    overrides,
    sent,
    events,
    reloads,
    assigned,
    jar,
    consoleLines,
    settings,
    of,
    last,
    command,
    usageReports,
    /** Switches edit mode on for this page and waits for it to settle. */
    on: async () => {
      await host.applySettings(settings());
      await settle();
    },
  };
}

/** The same page after a reload: a new Page Host over the same tab session and cookies. */
export const reload = (page: ReturnType<typeof boot>) => boot({ ...page.options, reloadOf: { jar: page.jar } });

export const outlined = () => document.querySelectorAll("[data-tms-hl]").length;
