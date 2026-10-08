// @vitest-environment jsdom
import type { PersistOutcome } from "@intl-tms/core/tools";
import { describe, expect, it } from "vitest";
import { DIAGNOSTICS } from "../src/shared/strings.js";
import { CONFIG, STATUS, opened, panel, settle } from "./support/view.js";

type Answer = PersistOutcome | undefined | Error;

async function saved(answer?: Answer, view = opened(answer === undefined && arguments.length === 0 ? {} : { answer: () => answer })) {
  view.type(view.control("da"), "Udrul straks");
  await view.press("save");
  return view;
}

describe("Diagnostics: the pane", () => {
  it("is titled Diagnostics", () => {
    expect(panel().diagnostics().querySelector("summary")?.textContent).toBe(DIAGNOSTICS.title);
  });

  it("LG13 is collapsed in a fresh panel", () => {
    expect(panel().diagnostics().open).toBe(false);
  });

  it("LG10 shows the invitation sentence while the log is empty", () => {
    expect(panel({ config: false }).role("log")?.textContent).toBe(DIAGNOSTICS.empty);
  });

  it("is shown with nothing selected", () => {
    const view = panel();
    expect(view.shown(view.diagnostics())).toBe(true);
  });

  it("LG14 logs a configuration's Locales", () => {
    expect(panel().role("log")?.textContent).toBe("09:05:03  config  languages: en, da; source: en; schema: no");
  });

  it("logs an empty configuration in words", () => {
    expect(panel({ config: {} }).log.entries()[0]?.text).toBe("languages: (none); source: (unset); schema: no");
  });

  it("logs that a configuration has a Schema", () => {
    expect(panel({ config: { ...CONFIG, schema: { fields: [STATUS] } } }).log.entries()[0]?.text).toContain("schema: yes");
  });

  it("LG15 logs an opened translation's key and Locale, with the on-page value as detail", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    expect(view.log.entries().at(-1)).toMatchObject({ channel: "open", text: "hero.title (en)", detail: "Deploy now" });
  });

  it("LG16 logs the Locales that have stored rows when values arrive", () => {
    expect(opened().log.entries().at(-1)).toMatchObject({ channel: "values", text: "hero.title -> en, da" });
  });

  it("logs that there are no stored rows", () => {
    expect(opened({}, {}).log.entries().at(-1)?.text).toBe("hero.title -> (no stored rows)");
  });

  it("logs values that fail to load", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    view.driver.setValues("hero.title", { locales: {} }, true);
    expect(view.log.entries().at(-1)?.text).toBe("hero.title READ FAILED -- the panel is showing the on-page value only");
  });

  it("LG17 the pane opens when values fail to load", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    view.driver.setValues("hero.title", { locales: {} }, true);
    expect(view.diagnostics().open).toBe(true);
  });

  it("LG18 logs a sent save's writes", async () => {
    const entry = (await saved()).log.entries().find((candidate) => candidate.text === "PUT hero.title");
    expect(JSON.parse(entry?.detail ?? "null")).toEqual({ da: { value: "Udrul straks", expected: { value: "Udrul nu" } } });
  });

  it("logs that a save succeeded, with the result as detail", async () => {
    const entry = (await saved()).log.entries().at(-1);
    expect([entry?.channel, entry?.text, JSON.parse(entry?.detail ?? "null").ok]).toEqual(["save", "saved", true]);
  });

  it("LG19 the pane stays collapsed when a save succeeds", async () => {
    expect((await saved()).diagnostics().open).toBe(false);
  });

  it("LG20 the pane opens when a save fails", async () => {
    expect((await saved({ ok: false, results: { da: { ok: false, status: 500 } } })).diagnostics().open).toBe(true);
  });

  it("logs a failed save on the save channel, then why", async () => {
    const view = await saved({ ok: false, results: { da: { ok: false, status: 500 } } });
    expect(view.log.entries().slice(-2).map((entry) => `${entry.channel}:${entry.text}`)).toEqual(["save:FAILED", "why:da: 500"]);
  });

  it("LG21 a Locale refused with status 400 has its status in the log", async () => {
    expect((await saved({ ok: false, results: { da: { ok: false, status: 400 } } })).log.text()).toContain("why  da: 400");
  });

  it("LG22 the website's reason is in the log", async () => {
    const view = await saved({ ok: false, results: { da: { ok: false, status: 400, message: "value is too long" } } });
    expect(view.log.text()).toContain("why  da: 400 value is too long");
  });

  it("LG23 a save with no reply at all says the page did not answer", async () => {
    expect((await saved(undefined, opened({ answer: () => undefined }))).log.text()).toContain("why  The page did not answer.");
  });

  it("LG24 config-not-loaded says there is no configuration to save to", async () => {
    expect((await saved({ ok: false, error: "config-not-loaded", results: {} })).log.text()).toContain("The configuration never loaded, so there is no endpoint to save to.");
  });

  it("LG25 no-selection says to click a translation first", async () => {
    expect((await saved({ ok: false, error: "no-selection", results: {} })).log.text()).toContain("Click a highlighted translation first.");
  });

  it("LG26 stale-selection says to click the text again", async () => {
    expect((await saved({ ok: false, error: "stale-selection", results: {} })).log.text()).toContain("Click the text again.");
  });

  it("a named internal error is logged as it is", async () => {
    expect((await saved({ ok: false, error: "internal: boom", results: {} })).log.text()).toContain("why  internal: boom");
  });

  it("LG27 a Locale that never reached the website says so, with the thrown text", async () => {
    const view = await saved({ ok: false, results: { da: { ok: false, message: "Failed to fetch" } } });
    expect(view.log.text()).toContain("why  da: the request never reached the server (Failed to fetch)");
  });

  it("LG28 a callback that throws is logged", async () => {
    expect((await saved(new Error("port closed"))).log.entries().at(-1)).toMatchObject({ channel: "save", text: "THREW", detail: "port closed" });
  });

  it("the pane opens when the callback throws", async () => {
    expect((await saved(new Error("port closed"))).diagnostics().open).toBe(true);
  });

  it("the panel is still usable after the callback throws", async () => {
    let calls = 0;
    const view = opened({ answer: () => (calls++ === 0 ? new Error("port closed") : { ok: true, results: { da: { ok: true } } }) });
    await saved(undefined, view);
    await view.press("save");
    expect(view.status().textContent).toBe("da ✓");
  });

  it("LG29 a pane opened by a failure is still open after a save succeeds", async () => {
    let calls = 0;
    const view = opened({ answer: () => (calls++ === 0 ? undefined : { ok: true, results: { da: { ok: true } } }) });
    await saved(undefined, view);
    await view.press("save");
    expect(view.diagnostics().open).toBe(true);
  });

  it("LG30 Clear empties the log", async () => {
    const view = await saved();
    await view.press("clear");
    expect([view.log.entries(), view.role("log")?.textContent]).toEqual([[], DIAGNOSTICS.empty]);
  });

  it("LG31 Copy says it copied", async () => {
    const copied: string[] = [];
    const view = opened({ view: { clipboard: { writeText: async (text) => void copied.push(text) } } });
    await view.press("copy");
    expect([view.button("copy").textContent, copied]).toEqual([DIAGNOSTICS.copied, [view.log.text()]]);
  });

  it("LG32 Copy says it could not when the clipboard refuses", async () => {
    const view = opened({ view: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } } });
    await view.press("copy");
    expect(view.button("copy").textContent).toBe(DIAGNOSTICS.copyFailed);
  });

  it("Copy says it could not when there is no clipboard", async () => {
    const view = opened({ view: { clipboard: undefined as never } });
    await view.press("copy");
    expect(view.button("copy").textContent).toBe(DIAGNOSTICS.copyFailed);
  });

  it("LG33 a logged reason containing markup is shown literally", async () => {
    const view = await saved({ ok: false, results: { da: { ok: false, status: 400, message: "<img src=x onerror=alert(1)>" } } });
    expect([view.role("log")?.querySelector("img"), view.role("log")?.textContent?.includes("<img src=x onerror=alert(1)>")]).toEqual([null, true]);
  });

  it("LG34 the pane is scrolled to an entry added when it is full", () => {
    const view = panel();
    const pane = view.role("log")!;
    Object.defineProperty(pane, "scrollHeight", { configurable: true, get: () => 4000 });
    view.log.add("save", "newest");
    expect(pane.scrollTop).toBe(4000);
  });

  it("the log is preformatted text", () => {
    expect(panel().role("log")?.tagName).toBe("PRE");
  });

  it("settles without an unhandled rejection when the callback throws", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", listener);
    await saved(new Error("port closed"));
    await settle();
    process.off("unhandledRejection", listener);
    expect(unhandled).toEqual([]);
  });
});
