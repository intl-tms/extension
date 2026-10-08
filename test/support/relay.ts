import { vi } from "vitest";
import type { Kind, Message, Payloads } from "../../src/shared/protocol.js";
import type { KeyValueStore } from "../../src/shared/storage.js";
import { createRelay, type RelayPorts, type Sender } from "../../src/worker/relay.js";

export const SITE_A = "https://a.example";
export const SITE_B = "https://b.example";
export const page = (tab: number | undefined, site = SITE_A): Sender => ({ extension: false, ...(tab === undefined ? {} : { tab }), site });
export const panel: Sender = { extension: true };

/** A key-value store whose reads can be held back or made to fail. */
export function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  let gate: Promise<void> = Promise.resolve();
  let open = () => undefined as void;
  const store: KeyValueStore & { data: Map<string, unknown>; hold(): void; release(): void; failReads: boolean } = {
    data,
    failReads: false,
    hold() {
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    release: () => open(),
    async get(key) {
      await gate;
      if (store.failReads) throw new Error("storage unavailable");
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
  return store;
}

export const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

export interface World {
  durable?: ReturnType<typeof memoryStore>;
  session?: ReturnType<typeof memoryStore>;
  ports?: Partial<RelayPorts>;
}

export function world(options: World = {}) {
  const durable = options.durable ?? memoryStore();
  const session = options.session ?? memoryStore();
  const events: string[] = [];
  const pushed: Message[] = [];
  const toTabs: { tab: number; message: Message }[] = [];
  const opened: number[] = [];
  /** What tabs answer. A missing tab is unreachable. */
  const tabReplies = new Map<number, unknown>();
  const ports: RelayPorts = {
    pushToPanel: (message) => {
      pushed.push(message);
      events.push(`push:${message.kind}`);
    },
    sendToTab: async (tab, message) => {
      toTabs.push({ tab, message });
      if (!tabReplies.has(tab)) throw new Error("Could not establish connection. Receiving end does not exist.");
      return tabReplies.get(tab);
    },
    openPanel: (tab) => {
      opened.push(tab);
      events.push("open");
    },
    durable,
    session,
    ...options.ports,
  };
  const relay = createRelay(ports);

  /** Delivers one message and waits for everything it started. */
  async function deliver<K extends Kind>(kind: K, payload: Payloads[K], sender: Sender, ids: { tab?: number; selection?: string } = {}) {
    const replies: unknown[] = [];
    const pending = relay.handle({ to: "worker", kind, payload, ...ids }, sender, (result) => void replies.push(result));
    await settle();
    return { pending, replies, reply: replies[0] };
  }
  const select = (tab: number, key = "hero.title", site = SITE_A) => deliver("selection-opened", { key, locale: "en", value: "Deploy now" }, page(tab, site));
  const pushedOf = <K extends Kind>(kind: K) => pushed.filter((message): message is Message<K> => message.kind === kind);

  return { relay, ports, durable, session, events, pushed, pushedOf, toTabs, opened, tabReplies, deliver, select };
}

export const noUnhandledRejections = async (run: () => Promise<unknown>) => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  await run();
  await settle();
  process.off("unhandledRejection", unhandled);
  return unhandled.mock.calls.length === 0;
};
