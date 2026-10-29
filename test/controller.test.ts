import { describe, expect, it, vi } from "vitest";
import { createController, type ControllerPorts, type PanelDriver } from "../src/panel/controller.js";
import type { Message } from "../src/shared/protocol.js";

const SITE = "https://a.example";
const VALUES = { locales: { en: { value: "Deploy now" } } };
const USAGES = [{ key: "hero.title", source: "runtime" as const, url: `${SITE}/pricing`, count: 1, lastSeen: "2026-01-01T00:00:00.000Z" }];
const ITEMS = [{ id: "a1:aria-label", attribute: "aria-label", key: "icon.close", value: "Close" }];

function setup(reply: (message: Message) => unknown = () => undefined) {
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  const driver: PanelDriver = {
    open: record("open"),
    setValues: record("setValues"),
    setUsage: record("setUsage"),
    setConfig: record("setConfig"),
    setHidden: record("setHidden"),
    setSignIn: record("setSignIn"),
  };
  const sent: Message[] = [];
  const opened: string[] = [];
  const ports: ControllerPorts = {
    send: (message) => {
      sent.push(message);
      return reply(message);
    },
    openTab: (url) => void opened.push(url),
  };
  const controller = createController(ports);
  controller.bind(driver);
  const push = (kind: string, payload: unknown, extra: Record<string, unknown> = {}) => controller.handle({ to: "panel", kind, payload, ...extra });
  return { controller, calls, sent, opened, push };
}

describe("controller: inbound messages", () => {
  it("CT1 the Selection push opens that key, Locale and value", () => {
    const { calls, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "Deploy now" });
    expect(calls).toEqual([["open", "hero.title", "en", "Deploy now"]]);
  });

  it("reports a handled message as handled", () => {
    expect(setup().push("selection-opened", { key: "hero.title", locale: "en", value: "Deploy now" })).toBe(true);
  });

  it("CT2 values-loaded sets values with the error flag", () => {
    const { calls, push } = setup();
    push("values-loaded", { key: "hero.title", values: VALUES, error: true });
    expect(calls).toEqual([["setValues", "hero.title", VALUES, true]]);
  });

  it("CT3 values-loaded with no values gives an empty envelope", () => {
    const { calls, push } = setup();
    push("values-loaded", { key: "hero.title" });
    expect(calls).toEqual([["setValues", "hero.title", { locales: {} }, false]]);
  });

  it("CT4 usage-loaded sets those usages", () => {
    const { calls, push } = setup();
    push("usage-loaded", { key: "hero.title", usages: USAGES, error: false });
    expect(calls).toEqual([["setUsage", "hero.title", USAGES, false]]);
  });

  it("CT5 usage-loaded with no usages gives an empty list", () => {
    const { calls, push } = setup();
    push("usage-loaded", { key: "hero.title", error: true });
    expect(calls).toEqual([["setUsage", "hero.title", [], true]]);
  });

  it("CT6 config-loaded sets those Locales", () => {
    const { calls, push } = setup();
    push("config-loaded", { config: { languages: ["en", "da"], schema: { valueField: { type: "textarea" } }, sourceLocale: "en" } });
    expect(calls).toEqual([["setConfig", { locales: ["en", "da"], schema: { valueField: { type: "textarea" } }, sourceLocale: "en" }]]);
  });

  it("an explicit no-Schema reaches the driver as no Schema", () => {
    const { calls, push } = setup();
    push("config-loaded", { config: { languages: ["en"], schema: null } });
    expect(calls).toEqual([["setConfig", { locales: ["en"], schema: undefined, sourceLocale: undefined }]]);
  });

  it("CT7 config-loaded with no configuration gives an empty Locale list", () => {
    const { calls, push } = setup();
    push("config-loaded", {});
    expect(calls).toEqual([["setConfig", { locales: [], schema: undefined, sourceLocale: undefined }]]);
  });

  it("CT8 hidden-changed sets those items", () => {
    const { calls, push } = setup();
    push("hidden-changed", { items: ITEMS });
    expect(calls).toEqual([["setHidden", ITEMS]]);
  });

  it("CT9 hidden-changed with no items gives an empty list", () => {
    const { calls, push } = setup();
    push("hidden-changed", {});
    expect(calls).toEqual([["setHidden", []]]);
  });

  it("CT10 a message of unknown kind is reported as not handled", () => {
    expect(setup().push("explode", {})).toBe(false);
  });

  it("CT11 a message of unknown kind makes no driver call", () => {
    const { calls, push } = setup();
    push("explode", {});
    expect(calls).toEqual([]);
  });

  it("CT12 a selection-opened addressed to the Worker makes no driver call", () => {
    const { controller, calls } = setup();
    controller.handle({ to: "worker", kind: "selection-opened", payload: { key: "hero.title", locale: "en", value: "Deploy now" } });
    expect(calls).toEqual([]);
  });

  it("a malformed payload makes no driver call", () => {
    const { calls, push } = setup();
    push("values-loaded", { key: 7 });
    expect(calls).toEqual([]);
  });

  it("a message before a driver is bound is not handled", () => {
    const controller = createController({ send: () => undefined, openTab: () => undefined });
    expect(controller.handle({ to: "panel", kind: "hidden-changed", payload: { items: [] } })).toBe(false);
  });
});

describe("controller: seeding from the panel-ready reply", () => {
  const selection = { key: "hero.title", locale: "en", value: "Deploy now" };

  it("CT13 seeding with nothing makes no driver call", () => {
    const { controller, calls } = setup();
    controller.seed(null);
    expect(calls).toEqual([]);
  });

  it("seeding with something that is not a seed makes no driver call", () => {
    const { controller, calls } = setup();
    controller.seed({ tab: "7", selection: { key: 1 } });
    expect(calls).toEqual([]);
  });

  it("CT14 seeding with a Selection opens it", () => {
    const { controller, calls } = setup();
    controller.seed({ tab: 7, selection });
    expect(calls).toEqual([["open", "hero.title", "en", "Deploy now"]]);
  });

  it("CT15 values are set after it is opened", () => {
    const { controller, calls } = setup();
    controller.seed({ tab: 7, selection: { ...selection, values: VALUES } });
    expect(calls).toEqual([
      ["open", "hero.title", "en", "Deploy now"],
      ["setValues", "hero.title", VALUES, false],
    ]);
  });

  it("CT16 usages are set", () => {
    const { controller, calls } = setup();
    controller.seed({ tab: 7, selection: { ...selection, usages: USAGES } });
    expect(calls.at(-1)).toEqual(["setUsage", "hero.title", USAGES, false]);
  });

  it("CT17 set-values is not called for a Selection with no values", () => {
    const { controller, calls } = setup();
    controller.seed({ tab: 7, selection: { ...selection, usages: USAGES } });
    expect(calls.map(([name]) => name)).toEqual(["open", "setUsage"]);
  });
});

describe("controller: commands", () => {
  const writes = { da: { value: "Udrul nu", expected: { value: "Deploy nu" } } };

  it("CT18 the save message names the key the panel shows", async () => {
    const { controller, sent } = setup();
    await controller.callbacks.save("hero.title", writes);
    expect(sent[0]).toMatchObject({ to: "worker", kind: "save", payload: { key: "hero.title" } });
  });

  it("CT19 the save message carries the changed Locales' writes", async () => {
    const { controller, sent } = setup();
    await controller.callbacks.save("hero.title", writes);
    expect(sent[0]?.payload).toEqual({ key: "hero.title", values: writes });
  });

  it("the save names the tab the Selection was clicked in", async () => {
    const { controller, sent, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "Deploy now" }, { tab: 7 });
    await controller.callbacks.save("hero.title", writes);
    expect(sent[0]?.tab).toBe(7);
  });

  it("a seeded Selection's tab is named too", async () => {
    const { controller, sent } = setup();
    controller.seed({ tab: 9, selection: { key: "hero.title", locale: "en", value: "Deploy now" } });
    await controller.callbacks.save("hero.title", writes);
    expect(sent[0]?.tab).toBe(9);
  });

  it("a save resolves with the page's result", async () => {
    const result = { ok: true, results: { da: { ok: true, status: 200 } } };
    const { controller } = setup(() => Promise.resolve(result));
    expect(await controller.callbacks.save("hero.title", writes)).toEqual(result);
  });

  it("CT20 a save that gets no reply resolves with nothing", async () => {
    const { controller } = setup(() => Promise.resolve(undefined));
    expect(await controller.callbacks.save("hero.title", writes)).toBeUndefined();
  });

  it("a save whose send rejects resolves with nothing", async () => {
    const { controller } = setup(() => Promise.reject(new Error("Could not establish connection. Receiving end does not exist.")));
    expect(await controller.callbacks.save("hero.title", writes)).toBeUndefined();
  });

  it("a save whose send throws resolves with nothing", async () => {
    const { controller } = setup(() => {
      throw new Error("Extension context invalidated.");
    });
    expect(await controller.callbacks.save("hero.title", writes)).toBeUndefined();
  });

  it("a reply that is not a save result resolves with nothing", async () => {
    const { controller } = setup(() => Promise.resolve("ok"));
    expect(await controller.callbacks.save("hero.title", writes)).toBeUndefined();
  });

  it("navigate is sent for the Selection's tab", () => {
    const { controller, sent, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "x" }, { tab: 7, site: SITE });
    controller.callbacks.navigate(`${SITE}/pricing`);
    expect(sent).toEqual([{ to: "worker", kind: "navigate", payload: { url: `${SITE}/pricing` }, tab: 7 }]);
  });

  it("XN2 an address on another origin is opened in a new tab", () => {
    const { controller, opened, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "x" }, { tab: 7, site: SITE });
    controller.callbacks.navigate("https://elsewhere.example/pricing");
    expect(opened).toEqual(["https://elsewhere.example/pricing"]);
  });

  it("an address on another origin is not sent to the page", () => {
    const { controller, sent, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "x" }, { tab: 7, site: SITE });
    controller.callbacks.navigate("https://elsewhere.example/pricing");
    expect(sent).toEqual([]);
  });

  it("an address that is not a web address opens nothing", () => {
    const { controller, opened, sent, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "x" }, { tab: 7, site: SITE });
    controller.callbacks.navigate("javascript:alert(1)");
    expect([opened, sent]).toEqual([[], []]);
  });

  it("flash is sent for the tab that produced the Hidden list", () => {
    const { controller, sent, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "x" }, { tab: 7 });
    push("hidden-changed", { items: ITEMS }, { tab: 8 });
    controller.callbacks.flash("a1:aria-label");
    expect(sent).toEqual([{ to: "worker", kind: "flash", payload: { id: "a1:aria-label" }, tab: 8 }]);
  });

  it("open-hidden is sent for the tab that produced the Hidden list", () => {
    const { controller, sent, push } = setup();
    push("hidden-changed", { items: ITEMS }, { tab: 8 });
    controller.callbacks.openHidden("a1:aria-label");
    expect(sent).toEqual([{ to: "worker", kind: "open-hidden", payload: { id: "a1:aria-label" }, tab: 8 }]);
  });

  it("CTL-12 a rejected fire-and-forget send leaves no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { controller } = setup(() => Promise.reject(new Error("nobody listening")));
    controller.callbacks.flash("a1:aria-label");
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("knows the Site of the Selection it shows", () => {
    const { controller, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "x" }, { tab: 7, site: SITE });
    expect(controller.site()).toBe(SITE);
  });
});

describe("controller: signing in", () => {
  it("passes the sign-in state of the Selection's tab to the view", () => {
    const { calls, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "Deploy now" }, { tab: 7, site: SITE });
    push("sign-in-changed", { status: { state: "not-signed-in" } }, { tab: 7 });
    expect(calls.at(-1)).toEqual(["setSignIn", { state: "not-signed-in" }]);
  });

  it("ignores another tab's state once a Selection is shown", () => {
    const { calls, push } = setup();
    push("selection-opened", { key: "hero.title", locale: "en", value: "Deploy now" }, { tab: 7, site: SITE });
    push("sign-in-changed", { status: { state: "not-signed-in" } }, { tab: 8 });
    expect(calls.some(([name]) => name === "setSignIn")).toBe(false);
  });

  it("validates the state: a pairing address that is not a web address is dropped", () => {
    const { calls, push } = setup();
    push("sign-in-changed", { status: { state: "not-signed-in", descriptor: { pair: { address: "javascript:x" } } } }, { tab: 7 });
    expect(calls.at(-1)).toEqual(["setSignIn", { state: "not-signed-in", descriptor: {} }]);
  });
});
