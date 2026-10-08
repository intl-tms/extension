import { describe, expect, it, vi } from "vitest";
import { STORAGE } from "../src/shared/storage.js";
import { startWorker, type WorkerApi } from "../src/worker/start.js";

type Listener = (...args: never[]) => unknown;

function event() {
  const listeners: Listener[] = [];
  return { addListener: (listener: Listener) => void listeners.push(listener), fire: (...args: unknown[]) => listeners.map((listener) => (listener as (...a: unknown[]) => unknown)(...args)) };
}

function api() {
  const events = {
    message: event(),
    installed: event(),
    startup: event(),
    storage: event(),
    added: event(),
    removed: event(),
    tabRemoved: event(),
    tabUpdated: event(),
  };
  const sync: Record<string, unknown> = { [STORAGE.sites]: ["https://a.example"] };
  const registered: unknown[] = [];
  const opened: unknown[] = [];
  const area = () => {
    const data: Record<string, unknown> = {};
    return { get: async (key: string) => ({ [key]: data[key] }), set: async (values: Record<string, unknown>) => void Object.assign(data, values) };
  };
  const fake = {
    runtime: {
      id: "abcdefgh",
      getURL: (path: string) => `chrome-extension://abcdefgh/${path}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: events.message,
      onInstalled: events.installed,
      onStartup: events.startup,
    },
    storage: { sync: { get: async () => sync }, local: area(), session: area(), onChanged: events.storage },
    permissions: { contains: async () => true, onAdded: events.added, onRemoved: events.removed },
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (scripts: unknown[]) => void registered.push(...scripts),
      updateContentScripts: async () => undefined,
      unregisterContentScripts: async () => void (registered.length = 0),
      executeScript: vi.fn(async () => []),
    },
    tabs: { query: async () => [], sendMessage: vi.fn(async () => ({ ok: true, results: {} })), onRemoved: events.tabRemoved, onUpdated: events.tabUpdated },
    sidePanel: { open: vi.fn(async (options: unknown) => void opened.push(options)) },
  };
  return { fake, events, registered, opened, api: fake as unknown as WorkerApi };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};
const selection = { to: "worker", kind: "selection-opened", payload: { key: "k", locale: "en", value: "v" } };
const fromPage = { tab: { id: 7 }, url: "https://a.example/pricing" };
const fromPanel = { url: "chrome-extension://abcdefgh/panel.html" };

describe("the Worker bootstrap", () => {
  it.each(["installed", "startup", "added", "removed"] as const)("reconciles on %s", async (name) => {
    const { api: worker, events, registered } = api();
    startWorker(worker);
    events[name].fire();
    await settle();
    expect(registered).toHaveLength(1);
  });

  it("reconciles when the Listed Sites change", async () => {
    const { api: worker, events, registered } = api();
    startWorker(worker);
    events.storage.fire({ [STORAGE.sites]: { newValue: [] } }, "sync");
    await settle();
    expect(registered).toHaveLength(1);
  });

  it("does not reconcile when another stored value changes", async () => {
    const { api: worker, events, registered } = api();
    startWorker(worker);
    events.storage.fire({ [STORAGE.stash]: {} }, "session");
    events.storage.fire({ [STORAGE.configUrl]: {} }, "sync");
    await settle();
    expect(registered).toEqual([]);
  });

  it("opens the Side Panel for the tab a click came from, before the listener returns", () => {
    const { api: worker, events, opened } = api();
    startWorker(worker);
    events.message.fire(selection, fromPage, () => undefined);
    expect(opened).toEqual([{ tabId: 7 }]);
  });

  it("tells the platform a reply is pending only when one is", () => {
    const { api: worker, events } = api();
    startWorker(worker);
    const pending = [events.message.fire(selection, fromPage, () => undefined), events.message.fire({ to: "worker", kind: "panel-ready" }, fromPanel, () => undefined)];
    expect(pending).toEqual([[false], [true]]);
  });

  it("routes a save from the panel to the tab that was clicked", async () => {
    const { api: worker, events, fake } = api();
    startWorker(worker);
    events.message.fire(selection, fromPage, () => undefined);
    events.message.fire({ to: "worker", kind: "save", payload: { key: "k", values: {} } }, fromPanel, () => undefined);
    await settle();
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(7, { to: "page", kind: "save", payload: { key: "k", values: {} } });
  });

  it("drops a closed tab's stash", async () => {
    const { api: worker, events } = api();
    startWorker(worker);
    events.message.fire(selection, fromPage, () => undefined);
    events.tabRemoved.fire(7);
    const replies: unknown[] = [];
    events.message.fire({ to: "worker", kind: "panel-ready" }, fromPanel, (reply: unknown) => void replies.push(reply));
    await settle();
    expect(replies).toEqual([null]);
  });

  it("drops a tab's stash when it starts loading another Site", async () => {
    const { api: worker, events } = api();
    startWorker(worker);
    events.message.fire(selection, fromPage, () => undefined);
    events.tabUpdated.fire(7, { status: "loading" }, { url: "https://b.example/" });
    const replies: unknown[] = [];
    events.message.fire({ to: "worker", kind: "panel-ready" }, fromPanel, (reply: unknown) => void replies.push(reply));
    await settle();
    expect(replies).toEqual([null]);
  });

  it("keeps a tab's stash when something other than a load is reported", async () => {
    const { api: worker, events } = api();
    startWorker(worker);
    events.message.fire(selection, fromPage, () => undefined);
    events.tabUpdated.fire(7, { title: "New title" }, {});
    const replies: unknown[] = [];
    events.message.fire({ to: "worker", kind: "panel-ready" }, fromPanel, (reply: unknown) => void replies.push(reply));
    await settle();
    expect(replies).toMatchObject([{ tab: 7 }]);
  });
});
