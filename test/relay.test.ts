import { describe, expect, it } from "vitest";
import type { PanelSeed } from "../src/shared/protocol.js";
import { STORAGE } from "../src/shared/storage.js";
import { classifySender } from "../src/worker/relay.js";
import { SITE_A, SITE_B, memoryStore, noUnhandledRejections, page, panel, world } from "./support/relay.js";

const VALUES = { locales: { en: { value: "Deploy now" } } };
const USAGES = [{ key: "hero.title", source: "runtime" as const, url: `${SITE_A}/pricing`, count: 1, lastSeen: "2026-01-01T00:00:00.000Z" }];
const ITEMS = [{ id: "a1:aria-label", attribute: "aria-label", key: "icon.close", value: "Close" }];
const seed = (reply: unknown) => reply as PanelSeed | null;

describe("relay: a selection is opened", () => {
  it("RL1 pushes the Selection to the panel", async () => {
    const w = world();
    await w.select(7);
    expect(w.pushedOf("selection-opened")[0]?.payload).toEqual({ key: "hero.title", locale: "en", value: "Deploy now" });
  });

  it("addresses the push to the panel and names the tab and Site", async () => {
    const w = world();
    await w.select(7);
    expect(w.pushedOf("selection-opened").map(({ to, tab, site }) => ({ to, tab, site }))).toEqual([{ to: "panel", tab: 7, site: SITE_A }]);
  });

  it("RL2 opens the panel for that tab", async () => {
    const w = world();
    await w.select(7);
    expect(w.opened).toEqual([7]);
  });

  it("RL3 pushes before it opens", async () => {
    const w = world();
    await w.select(7);
    expect(w.events).toEqual(["push:selection-opened", "open"]);
  });

  it("RL4 attempts no open when the sender has no tab", async () => {
    const w = world();
    await w.deliver("selection-opened", { key: "k", locale: "en", value: "v" }, page(undefined));
    expect(w.opened).toEqual([]);
  });

  it("still pushes when the sender has no tab", async () => {
    const w = world();
    await w.deliver("selection-opened", { key: "k", locale: "en", value: "v" }, page(undefined));
    expect(w.pushedOf("selection-opened")).toHaveLength(1);
  });

  it("leaves no reply pending", async () => {
    expect((await world().select(7)).pending).toBe(false);
  });

  it("RL5 does not throw when opening throws synchronously", async () => {
    const w = world({
      ports: {
        openPanel: () => {
          throw new Error("no gesture");
        },
      },
    });
    await expect(w.select(7)).resolves.toBeDefined();
  });

  it("RL6 leaves no unhandled rejection when opening rejects", async () => {
    const w = world({ ports: { openPanel: () => Promise.reject(new Error("sidePanel.open() may only be called in response to a user gesture")) } });
    expect(await noUnhandledRejections(() => w.select(7))).toBe(true);
  });

  it("RL7 does not throw when no panel is listening", async () => {
    const w = world({
      ports: {
        pushToPanel: () => {
          throw new Error("Receiving end does not exist.");
        },
      },
    });
    await expect(w.select(7)).resolves.toBeDefined();
  });

  it("leaves no unhandled rejection when the push rejects", async () => {
    const w = world({ ports: { pushToPanel: () => Promise.reject(new Error("Receiving end does not exist.")) } });
    expect(await noUnhandledRejections(() => w.select(7))).toBe(true);
  });

  it("still opens the panel when the push throws", async () => {
    const opened: number[] = [];
    const w = world({
      ports: {
        pushToPanel: () => {
          throw new Error("Receiving end does not exist.");
        },
        openPanel: (tab) => void opened.push(tab),
      },
    });
    await w.select(7);
    expect(opened).toEqual([7]);
  });

  it("RL8 a second selection drops the values attached to the first", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7));
    await w.select(7, "hero.title");
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.values).toBeUndefined();
  });

  it("RL42 writes the Selection to the session store", async () => {
    const w = world();
    await w.select(7);
    expect(w.session.data.get(STORAGE.stash)).toMatchObject({ selectionTab: 7, tabs: { 7: { selection: { key: "hero.title" } } } });
  });
});

describe("relay: values and usages", () => {
  it("RL9 relays values-loaded for the selected key", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7));
    expect(w.pushedOf("values-loaded")[0]?.payload).toEqual({ key: "hero.title", values: VALUES });
  });

  it("RL10 panel-ready's reply then includes the values", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7));
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.values).toEqual(VALUES);
  });

  it("RL11 values for another key are not attached", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "another", values: VALUES }, page(7));
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.values).toBeUndefined();
  });

  it("RL12 values for another key are still relayed", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "another", values: VALUES }, page(7));
    expect(w.pushedOf("values-loaded")).toHaveLength(1);
  });

  it("RL13 relays values-loaded with its error flag", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: { locales: {} }, error: true }, page(7));
    expect(w.pushedOf("values-loaded")[0]?.payload.error).toBe(true);
  });

  it("values from an earlier opening of the same key are not attached", async () => {
    const w = world();
    await w.deliver("selection-opened", { key: "hero.title", locale: "en", value: "x" }, page(7), { selection: "s-2" });
    await w.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7), { selection: "s-1" });
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.values).toBeUndefined();
  });

  it("RL14 relays usage-loaded for the selected key", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("usage-loaded", { key: "hero.title", usages: USAGES }, page(7));
    expect(w.pushedOf("usage-loaded")[0]?.payload).toEqual({ key: "hero.title", usages: USAGES });
  });

  it("RL15 panel-ready's reply then includes the usages", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("usage-loaded", { key: "hero.title", usages: USAGES }, page(7));
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.usages).toEqual(USAGES);
  });

  it("RL44 the session store's Selection includes attached values", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7));
    expect(w.session.data.get(STORAGE.stash)).toMatchObject({ tabs: { 7: { selection: { values: VALUES } } } });
  });

  it("drops attached values that would take a tab's stash over its bound", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: { locales: { en: { value: "x".repeat(300_000) } } } }, page(7));
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.values).toBeUndefined();
  });
});

describe("relay: configuration and the Hidden list", () => {
  const slice = { languages: ["en", "da"], schema: null, sourceLocale: "en" };

  it("RL16 writes the slice to the durable store", async () => {
    const w = world();
    await w.deliver("config-loaded", { config: slice }, page(7));
    expect(w.durable.data.get(STORAGE.configSlices)).toEqual({ last: SITE_A, sites: { [SITE_A]: slice } });
  });

  it("RL17 relays config-loaded", async () => {
    const w = world();
    await w.deliver("config-loaded", { config: slice }, page(7));
    expect(w.pushedOf("config-loaded")[0]?.payload).toEqual({ config: slice });
  });

  it("RL18 relays hidden-changed with its items", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: ITEMS }, page(7));
    expect(w.pushedOf("hidden-changed")[0]?.payload).toEqual({ items: ITEMS });
  });

  it("RL19 relays hidden-changed with no items member as an empty list", async () => {
    const w = world();
    await w.deliver("hidden-changed", {}, page(7));
    expect(w.pushedOf("hidden-changed")[0]?.payload).toEqual({ items: [] });
  });

  it("names the tab that produced the Hidden list", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: ITEMS }, page(9));
    expect(w.pushedOf("hidden-changed")[0]?.tab).toBe(9);
  });

  it("RL43 writes the Hidden list to the session store", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: ITEMS }, page(7));
    expect(w.session.data.get(STORAGE.stash)).toMatchObject({ hiddenTab: 7, tabs: { 7: { hidden: ITEMS } } });
  });

  it("stashes a page's status without relaying it", async () => {
    const w = world();
    await w.deliver("status-changed", { status: { site: SITE_A, gate: "on", toggle: "set", config: "loaded", protocol: "compatible" } }, page(7));
    expect([w.pushed, w.session.data.get(STORAGE.stash)]).toMatchObject([[], { tabs: { 7: { status: { gate: "on" } } } }]);
  });
});

describe("relay: panel-ready", () => {
  const slice = { languages: ["en"], schema: null };

  it("RL20 replies with the Selection when something is selected", async () => {
    const w = world();
    await w.select(7);
    expect((await w.deliver("panel-ready", {}, panel)).reply).toEqual({ tab: 7, site: SITE_A, selection: { key: "hero.title", locale: "en", value: "Deploy now" } });
  });

  it("RL21 replies with nothing when nothing is selected", async () => {
    expect((await world().deliver("panel-ready", {}, panel)).replies).toEqual([null]);
  });

  it("RL22 pushes a stored slice", async () => {
    const w = world();
    await w.deliver("config-loaded", { config: slice }, page(7));
    w.pushed.length = 0;
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("config-loaded")[0]?.payload).toEqual({ config: slice });
  });

  it("pushes a slice a previous Worker stored", async () => {
    const w = world({ durable: memoryStore({ [STORAGE.configSlices]: { last: SITE_A, sites: { [SITE_A]: slice } } }) });
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("config-loaded")[0]?.payload).toEqual({ config: slice });
  });

  it("RL23 pushes no configuration when no slice is stored", async () => {
    const w = world();
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("config-loaded")).toEqual([]);
  });

  it("RL24 pushes a non-empty Hidden list", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: ITEMS }, page(7));
    w.pushed.length = 0;
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("hidden-changed")[0]?.payload).toEqual({ items: ITEMS });
  });

  it("RL25 pushes nothing for an empty Hidden list", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: [] }, page(7));
    w.pushed.length = 0;
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("hidden-changed")).toEqual([]);
  });

  it("RL26 reports a reply pending", async () => {
    expect((await world().deliver("panel-ready", {}, panel)).pending).toBe(true);
  });

  it("answers exactly once", async () => {
    const w = world();
    await w.select(7);
    expect((await w.deliver("panel-ready", {}, panel)).replies).toHaveLength(1);
  });

  it("XT5 pushes the slice of the Site the Selection belongs to", async () => {
    const w = world();
    await w.deliver("config-loaded", { config: { languages: ["en"], schema: null } }, page(7, SITE_A));
    await w.select(7);
    await w.deliver("config-loaded", { config: { languages: ["fr"], schema: null } }, page(8, SITE_B));
    w.pushed.length = 0;
    await w.deliver("panel-ready", {}, panel);
    expect(w.pushedOf("config-loaded")[0]?.payload.config?.languages).toEqual(["en"]);
  });
});

describe("relay: save", () => {
  const writes = { da: { value: "Udrul nu" } };

  it("RL27 replies no-selection when nothing is selected", async () => {
    expect((await world().deliver("save", { key: "hero.title", values: writes }, panel)).reply).toEqual({ ok: false, error: "no-selection", results: {} });
  });

  it("RL28 contacts no tab when nothing is selected", async () => {
    const w = world();
    await w.deliver("save", { key: "hero.title", values: writes }, panel);
    expect(w.toTabs).toEqual([]);
  });

  it("RL29 forwards the save to the Selection's tab", async () => {
    const w = world();
    w.tabReplies.set(7, { ok: true, results: {} });
    await w.select(7);
    await w.deliver("save", { key: "hero.title", values: writes }, panel);
    expect(w.toTabs).toEqual([{ tab: 7, message: { to: "page", kind: "save", payload: { key: "hero.title", values: writes } } }]);
  });

  it("RL30 forwards the key the panel sent, not the stashed one", async () => {
    const w = world();
    w.tabReplies.set(7, { ok: false, error: "stale-selection", results: {} });
    await w.select(7, "hero.title");
    await w.deliver("save", { key: "footer.note", values: writes }, panel);
    expect(w.toTabs[0]?.message.payload).toMatchObject({ key: "footer.note" });
  });

  it("RL31 reports a reply pending", async () => {
    expect((await world().deliver("save", { key: "hero.title" }, panel)).pending).toBe(true);
  });

  it("RL32 relays the tab's reply unchanged", async () => {
    const w = world();
    const result = { ok: true, results: { da: { ok: true, status: 200 } }, page: "updated" };
    w.tabReplies.set(7, result);
    await w.select(7);
    expect((await w.deliver("save", { key: "hero.title", values: writes }, panel)).replies).toEqual([result]);
  });

  it("RL33 replies with the failure as text when the tab cannot be reached", async () => {
    const w = world();
    await w.select(7);
    expect((await w.deliver("save", { key: "hero.title", values: writes }, panel)).reply).toEqual({
      ok: false,
      error: "Could not establish connection. Receiving end does not exist.",
      results: {},
    });
  });

  it("XT1 a save from tab A's panel goes to A after a later Selection in tab B", async () => {
    const w = world();
    w.tabReplies.set(7, { ok: true, results: {} });
    await w.select(7);
    await w.select(8, "other.key", SITE_B);
    await w.deliver("save", { key: "hero.title", values: writes }, panel, { tab: 7 });
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([7]);
  });

  it("a save naming a tab with no Selection replies no-selection", async () => {
    const w = world();
    await w.select(7);
    expect((await w.deliver("save", { key: "hero.title", values: writes }, panel, { tab: 99 })).reply).toMatchObject({ error: "no-selection" });
  });

  it("XT2 a click in tab B leaves tab A's Selection as it was", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("values-loaded", { key: "hero.title", values: VALUES }, page(7));
    await w.select(8, "other.key", SITE_B);
    expect(w.session.data.get(STORAGE.stash)).toMatchObject({ tabs: { 7: { selection: { key: "hero.title", values: VALUES } } } });
  });
});

describe("relay: navigate, flash and open-hidden", () => {
  it("RL34 forwards navigate to the Selection's tab", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("navigate", { url: `${SITE_A}/pricing` }, panel);
    expect(w.toTabs).toEqual([{ tab: 7, message: { to: "page", kind: "navigate", payload: { url: `${SITE_A}/pricing` } } }]);
  });

  it("RL35 drops navigate when nothing is selected", async () => {
    const w = world();
    await w.deliver("navigate", { url: `${SITE_A}/pricing` }, panel);
    expect(w.toTabs).toEqual([]);
  });

  it("RL36 forwards flash to the tab that produced the Hidden list", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: ITEMS }, page(7));
    await w.deliver("flash", { id: "a1:aria-label" }, panel);
    expect(w.toTabs).toEqual([{ tab: 7, message: { to: "page", kind: "flash", payload: { id: "a1:aria-label" } } }]);
  });

  it("RL37 forwards open-hidden to the tab that produced the Hidden list", async () => {
    const w = world();
    await w.deliver("hidden-changed", { items: ITEMS }, page(7));
    await w.deliver("open-hidden", { id: "a1:aria-label" }, panel);
    expect(w.toTabs).toEqual([{ tab: 7, message: { to: "page", kind: "open-hidden", payload: { id: "a1:aria-label" } } }]);
  });

  it("RL38 flash goes to the Hidden list's tab, not the Selection's", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("hidden-changed", { items: ITEMS }, page(8, SITE_B));
    await w.deliver("flash", { id: "a1:aria-label" }, panel);
    expect(w.toTabs.map((sent) => sent.tab)).toEqual([8]);
  });

  it("drops flash when there is no Hidden list", async () => {
    const w = world();
    await w.select(7);
    await w.deliver("flash", { id: "a1:aria-label" }, panel);
    expect(w.toTabs).toEqual([]);
  });

  it("RL39 leaves no unhandled rejection when navigate's tab is unreachable", async () => {
    const w = world();
    await w.select(7);
    expect(await noUnhandledRejections(() => w.deliver("navigate", { url: `${SITE_A}/pricing` }, panel))).toBe(true);
  });

  it("leaves no reply pending for navigate", async () => {
    const w = world();
    await w.select(7);
    expect((await w.deliver("navigate", { url: `${SITE_A}/pricing` }, panel)).pending).toBe(false);
  });
});

describe("relay: what it ignores", () => {
  it("RL40 a message of unknown kind leaves no reply pending", async () => {
    expect((await world().deliver("explode" as never, {} as never, panel)).pending).toBe(false);
  });

  it("RL41 a null message leaves no reply pending", () => {
    expect(world().relay.handle(null, panel, () => undefined)).toBe(false);
  });

  it("a message addressed to the panel is not handled", () => {
    const w = world();
    w.relay.handle({ to: "panel", kind: "hidden-changed", payload: { items: ITEMS } }, page(7), () => undefined);
    expect(w.pushed).toEqual([]);
  });

  it("XT7 a command sent by a page script is ignored", async () => {
    const w = world();
    w.tabReplies.set(7, { ok: true, results: {} });
    await w.select(7);
    const { pending } = await w.deliver("save", { key: "hero.title", values: {} }, page(8, SITE_B));
    expect([pending, w.toTabs]).toEqual([false, []]);
  });

  it("an announcement from one of the Extension's own pages is ignored", async () => {
    const w = world();
    await w.deliver("selection-opened", { key: "k", locale: "en", value: "v" }, panel);
    expect(w.pushed).toEqual([]);
  });
});

describe("relay: tabs that go away", () => {
  it("XT3 a closed tab's stash is gone", async () => {
    const w = world();
    await w.select(7);
    w.relay.tabClosed(7);
    expect((await w.deliver("panel-ready", {}, panel)).reply).toBeNull();
  });

  it("a closed tab's stash is removed from the session store", async () => {
    const w = world();
    await w.select(7);
    w.relay.tabClosed(7);
    await w.deliver("panel-ready", {}, panel);
    expect(w.session.data.get(STORAGE.stash)).toEqual({ tabs: {}, selectionTab: null, hiddenTab: null });
  });

  it("XT4 a tab that navigates to another Site loses its stash", async () => {
    const w = world();
    await w.select(7);
    w.relay.tabNavigated(7, SITE_B);
    expect((await w.deliver("panel-ready", {}, panel)).reply).toBeNull();
  });

  it("a tab that reloads on its own Site keeps its stash", async () => {
    const w = world();
    await w.select(7);
    w.relay.tabNavigated(7, SITE_A);
    expect(seed((await w.deliver("panel-ready", {}, panel)).reply)?.selection.key).toBe("hero.title");
  });
});

describe("classifying a sender", () => {
  const EXTENSION = "chrome-extension://abcdefgh";

  it("a page script is a page with its tab and Site", () => {
    expect(classifySender({ tab: { id: 7 }, url: "https://a.example/pricing?x=1" }, EXTENSION)).toEqual({ extension: false, tab: 7, site: SITE_A });
  });

  it("the Side Panel is one of the Extension's own pages", () => {
    expect(classifySender({ url: `${EXTENSION}/panel.html` }, EXTENSION)).toEqual({ extension: true });
  });

  it("the panel document loaded in a tab is still one of the Extension's own pages", () => {
    expect(classifySender({ tab: { id: 3 }, url: `${EXTENSION}/panel.html` }, EXTENSION).extension).toBe(true);
  });

  it("another extension's page is not one of ours", () => {
    expect(classifySender({ url: "chrome-extension://zzzz/panel.html" }, EXTENSION).extension).toBe(false);
  });
});
