import { SETTINGS_KEYS } from "../shared/storage.js";
import { createPageHost, type PageHost, type PageHostOptions } from "./page-host.js";

/** The part of the browser's extension API the Page Host bootstrap uses. */
export interface PageEnvironment {
  /** The script's own isolated scope, where the started flag lives. */
  scope: Record<string, unknown>;
  runtime: {
    sendMessage(message: unknown): unknown;
    onMessage: { addListener(listener: (message: unknown, sender: unknown, respond: (result: unknown) => void) => boolean): void };
  };
  storage: {
    sync: { get(keys: string[]): Promise<Record<string, unknown>> };
    onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void };
  };
}

const STARTED = "__intlTmsPageHostStarted";

/**
 * Starts the Page Host in a page, at most once: a tab can receive both the
 * registered script and an injected one, and the second copy must do nothing.
 *
 * Wires the browser to the Page Host's three operations and decides nothing
 * itself: the Gate is the Page Host's.
 */
export function startPageHost(env: PageEnvironment, create: (options: PageHostOptions) => PageHost = createPageHost): void {
  if (env.scope[STARTED] === true) return;
  env.scope[STARTED] = true;

  const host = create({ messenger: { send: (message) => env.runtime.sendMessage(message) } });
  env.runtime.onMessage.addListener((message, _sender, respond) => host.handleMessage(message, respond));

  // The Sites and the address are read together and applied as one.
  const apply = () =>
    env.storage.sync
      .get([...SETTINGS_KEYS])
      .then((stored) => host.applySettings(stored))
      .catch(() => undefined);

  env.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && SETTINGS_KEYS.some((key) => key in changes)) void apply();
  });
  void apply();
}
