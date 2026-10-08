// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PageHost } from "../src/page/page-host.js";
import { startPageHost, type PageEnvironment } from "../src/page/start.js";
import { STORAGE } from "../src/shared/storage.js";

function environment(stored: Record<string, unknown> = { [STORAGE.sites]: ["https://a.example"], [STORAGE.configUrl]: "https://a.example/config" }) {
  const messageListeners: ((message: unknown, sender: unknown, respond: (result: unknown) => void) => boolean)[] = [];
  const changeListeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
  const reads: string[][] = [];
  const sent: unknown[] = [];
  const env: PageEnvironment = {
    scope: {},
    runtime: {
      sendMessage: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
      onMessage: { addListener: (listener) => void messageListeners.push(listener) },
    },
    storage: {
      sync: {
        get: async (keys) => {
          reads.push(keys);
          return stored;
        },
      },
      onChanged: { addListener: (listener) => void changeListeners.push(listener) },
    },
  };
  const host: PageHost = { applySettings: vi.fn(async () => undefined), switchOff: vi.fn(), handleMessage: vi.fn(() => true) };
  const create = vi.fn(() => host);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { env, host, create, messageListeners, changeListeners, reads, sent, stored, flush };
}

describe("the Page Host bootstrap", () => {
  it("SA26 run twice in one page, one message listener exists", () => {
    const { env, create, messageListeners } = environment();
    startPageHost(env, create);
    startPageHost(env, create);
    expect(messageListeners).toHaveLength(1);
  });

  it("run twice in one page, one Page Host is created", () => {
    const { env, create } = environment();
    startPageHost(env, create);
    startPageHost(env, create);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("applies the stored settings at start", async () => {
    const { env, create, host, stored, flush } = environment();
    startPageHost(env, create);
    await flush();
    expect(host.applySettings).toHaveBeenCalledWith(stored);
  });

  it("PH24 reads the Sites and the address in one read", async () => {
    const { env, create, reads, flush } = environment();
    startPageHost(env, create);
    await flush();
    expect(reads).toEqual([[STORAGE.sites, STORAGE.configUrl]]);
  });

  it("PH21 applies settings again when the Listed Sites change in storage", async () => {
    const { env, create, host, changeListeners, flush } = environment();
    startPageHost(env, create);
    await flush();
    changeListeners[0]?.({ [STORAGE.sites]: { newValue: [] } }, "sync");
    await flush();
    expect(host.applySettings).toHaveBeenCalledTimes(2);
  });

  it("PH22 applies settings again when the address changes in storage", async () => {
    const { env, create, host, changeListeners, flush } = environment();
    startPageHost(env, create);
    await flush();
    changeListeners[0]?.({ [STORAGE.configUrl]: { newValue: "https://x/config" } }, "sync");
    await flush();
    expect(host.applySettings).toHaveBeenCalledTimes(2);
  });

  it("PH23 does not apply settings again when an unrelated stored value changes", async () => {
    const { env, create, host, changeListeners, flush } = environment();
    startPageHost(env, create);
    await flush();
    changeListeners[0]?.({ [STORAGE.stash]: { newValue: {} } }, "session");
    changeListeners[0]?.({ somethingElse: { newValue: 1 } }, "sync");
    await flush();
    expect(host.applySettings).toHaveBeenCalledTimes(1);
  });

  it("hands inbound messages to the Page Host and reports whether a reply is pending", () => {
    const { env, create, messageListeners } = environment();
    startPageHost(env, create);
    expect(messageListeners[0]?.({ to: "page", kind: "save", payload: { key: "k" } }, {}, () => undefined)).toBe(true);
  });

  it("builds a messenger that sends through the runtime", () => {
    const { env, create, sent } = environment();
    startPageHost(env, create);
    const [options] = create.mock.calls[0] as unknown as [{ messenger: { send(message: unknown): unknown } }];
    options.messenger.send({ to: "worker", kind: "hidden-changed", payload: { items: [] } });
    expect(sent).toEqual([{ to: "worker", kind: "hidden-changed", payload: { items: [] } }]);
  });

  it("survives settings that cannot be read", async () => {
    const { env, create, host, flush } = environment();
    env.storage.sync.get = () => Promise.reject(new Error("Extension context invalidated."));
    startPageHost(env, create);
    await flush();
    expect(host.applySettings).not.toHaveBeenCalled();
  });
});
