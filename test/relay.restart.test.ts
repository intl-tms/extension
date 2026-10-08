import { describe, expect, it } from "vitest";
import type { PanelSeed } from "../src/shared/protocol.js";
import { STORAGE } from "../src/shared/storage.js";
import { SITE_A, memoryStore, page, panel, settle, world } from "./support/relay.js";

const VALUES = { locales: { en: { value: "Deploy now" } } };
const ITEMS = [{ id: "a1:aria-label", attribute: "aria-label", key: "icon.close", value: "Close" }];
const seed = (reply: unknown) => reply as PanelSeed | null;

/** A session store written by a previous Worker: a Selection in tab 7 with values, and a Hidden list from tab 7. */
async function previous() {
  const before = world();
  await before.select(7);
  await before.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7));
  await before.deliver("hidden-changed", { items: ITEMS }, page(7));
  return before.session;
}

async function restarted() {
  const w = world({ session: await previous() });
  w.tabReplies.set(7, { ok: true, results: {} });
  return w;
}

describe("a fresh relay over a previous Worker's session store", () => {
  it("RS1 forwards a save to tab 7", async () => {
    const w = await restarted();
    await w.deliver("save", { key: "hero.title", values: {} }, panel);
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([7]);
  });

  it("RS2 answers panel-ready with the stored Selection", async () => {
    const w = await restarted();
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.key).toBe("hero.title");
  });

  it("RS3 the reply includes the stored values", async () => {
    const w = await restarted();
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.values).toEqual(VALUES);
  });

  it("RS4 reports a reply pending for panel-ready", async () => {
    const w = await restarted();
    expect((await w.deliver("panel-ready", {}, panel)).pending).toBe(true);
  });

  it("RS5 pushes the stored Hidden list on panel-ready", async () => {
    const w = await restarted();
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("hidden-changed")[0]?.payload).toEqual({ items: ITEMS });
  });

  it("RS6 forwards navigate to tab 7", async () => {
    const w = await restarted();
    await w.deliver("navigate", { url: `${SITE_A}/pricing` }, panel);
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([7]);
  });

  it("RS7 forwards flash to tab 7", async () => {
    const w = await restarted();
    await w.deliver("flash", { id: "a1:aria-label" }, panel);
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([7]);
  });

  it("RS8 forwards open-hidden to tab 7", async () => {
    const w = await restarted();
    await w.deliver("open-hidden", { id: "a1:aria-label" }, panel);
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([7]);
  });

  it("reads the session store once", async () => {
    const session = await previous();
    let reads = 0;
    const get = session.get.bind(session);
    session.get = (key) => {
      reads++;
      return get(key);
    };
    const w = world({ session });
    await w.deliver("panel-ready", {}, panel);
    await w.deliver("save", { key: "hero.title" }, panel);
    expect(reads).toBe(1);
  });
});

describe("messages that arrive before the read finishes", () => {
  async function slow() {
    const session = await previous();
    session.hold();
    const w = world({ session });
    w.tabReplies.set(7, { ok: true, results: {} });
    w.tabReplies.set(9, { ok: true, results: {} });
    return w;
  }

  it("a save is not forwarded while the read is unfinished", async () => {
    const w = await slow();
    await w.deliver("save", { key: "hero.title", values: {} }, panel);
    expect(w.toTabs).toEqual([]);
  });

  it("RS9 a save is forwarded to tab 7 once the read has finished", async () => {
    const w = await slow();
    await w.deliver("save", { key: "hero.title", values: {} }, panel);
    w.session.release();
    await settle();
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([7]);
  });

  it("RS10 selection-opened opens the panel without waiting", async () => {
    const w = await slow();
    w.relay.handle({ to: "worker", kind: "selection-opened", payload: { key: "new.key", locale: "en", value: "New" } }, page(9), () => undefined);
    expect(w.opened).toEqual([9]);
  });

  it("RS11 the Selection is the new one after the read finishes", async () => {
    const w = await slow();
    await w.select(9, "new.key");
    w.session.release();
    expect((await w.deliver("panel-ready", {}, panel)).reply).toMatchObject({ tab: 9, selection: { key: "new.key" } });
  });

  it("a new Selection in the same tab is not given the stored one's values", async () => {
    const w = await slow();
    await w.select(7, "new.key");
    w.session.release();
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection).toEqual({ key: "new.key", locale: "en", value: "Deploy now" });
  });

  it("RS12 the Hidden list is the new one after the read finishes", async () => {
    const w = await slow();
    const fresh = [{ id: "a2:title", attribute: "title", key: "tip", value: "Tip" }];
    await w.deliver("hidden-changed", { items: fresh }, page(9));
    w.session.release();
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("hidden-changed").at(-1)).toMatchObject({ tab: 9, payload: { items: fresh } });
  });

  it("what a previous Worker stored for other tabs is kept after the read finishes", async () => {
    const w = await slow();
    await w.select(9, "new.key");
    w.session.release();
    await settle();
    expect(w.session.data.get(STORAGE.stash)).toMatchObject({ selectionTab: 9, tabs: { 7: { selection: { key: "hero.title" } }, 9: { selection: { key: "new.key" } } } });
  });

  it("a tab closed before the read finishes does not come back with it", async () => {
    const w = await slow();
    w.relay.tabClosed(7);
    w.session.release();
    expect((await w.deliver("panel-ready", {}, panel)).reply).toBeNull();
  });
});

describe("a session store that cannot be read", () => {
  const broken = () => {
    const session = memoryStore();
    session.failReads = true;
    return world({ session });
  };

  it("RS13 panel-ready is still answered", async () => {
    expect((await broken().deliver("panel-ready", {}, panel)).replies).toEqual([null]);
  });

  it("RS14 save answers no-selection", async () => {
    expect((await broken().deliver("save", { key: "hero.title" }, panel)).reply).toMatchObject({ ok: false, error: "no-selection" });
  });

  it("a session store holding something else is treated as empty", async () => {
    const w = world({ session: memoryStore({ [STORAGE.stash]: "corrupt" }) });
    expect((await w.deliver("panel-ready", {}, panel)).replies).toEqual([null]);
  });

  it("a durable store that cannot be read still lets panel-ready answer", async () => {
    const durable = memoryStore();
    durable.failReads = true;
    expect((await world({ durable }).deliver("panel-ready", {}, panel)).replies).toEqual([null]);
  });
});
