// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE, boot, byId, cleanup, mark, rescan, settle } from "./support/page.js";

const TEXT = `<p id="p">${mark("Hej", "greeting")}</p>`;
const HIDDEN = `<button id="b" aria-label="${mark("Luk", "a.close")}">x</button>`;

/** jsdom has no scrolling, so the page cannot bring anything into view by itself. */
let scrolled: Element[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  scrolled = [];
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: function scrollIntoView(this: Element) {
      scrolled.push(this);
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

const items = (page: ReturnType<typeof boot>) => page.last("page-markers")?.payload.items ?? [];

describe("the page's inventory", () => {
  it("carries every Marker, in document order, with the attribute only on the one that has it", async () => {
    const page = boot({ html: `${HIDDEN}${TEXT}` });
    await page.on();
    expect(items(page).map(({ key, value, attribute }) => ({ key, value, attribute }))).toEqual([
      { key: "a.close", value: "Luk", attribute: "aria-label" },
      { key: "greeting", value: "Hej", attribute: undefined },
    ]);
  });

  it("names the address the Markers were found on", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    expect(page.last("page-markers")?.payload.url).toContain(SITE);
  });

  it("gives every row the Marker identity the commands use", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    expect(items(page)[0]?.id).toMatch(/^t\d+$/);
  });

  it("sends nothing a second time for a rescan that changed nothing", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    byId("p").setAttribute("data-unrelated", "1");
    await rescan();
    expect(page.of("page-markers")).toHaveLength(1);
  });

  it("picks up a translation added after edit mode came on", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", HIDDEN);
    await rescan();
    expect(items(page).map((item) => item.key)).toEqual(["greeting", "a.close"]);
  });

  it("is emptied when edit mode is switched off", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    page.host.switchOff();
    expect(items(page)).toEqual([]);
  });

  it("is sent for a page with nothing marked at all", async () => {
    const page = boot({ html: "<p>plain</p>" });
    await page.on();
    expect(items(page)).toEqual([]);
  });
});

describe("finding and opening a Marker", () => {
  const idOf = async (html: string, key: string) => {
    const page = boot({ html, lang: "da" });
    await page.on();
    const id = items(page).find((item) => item.key === key)?.id;
    return { page, id: id ?? "" };
  };

  it("flash brings a visible translation into view", async () => {
    const { page, id } = await idOf(TEXT, "greeting");
    page.command("flash", { id });
    // Already outlined by the Core: being brought into view is all that is left.
    expect([scrolled, byId("p").hasAttribute("data-tms-hl-flash")]).toEqual([[byId("p")], false]);
  });

  it("flash outlines a translation that has no visible text", async () => {
    const { page, id } = await idOf(HIDDEN, "a.close");
    page.command("flash", { id });
    expect(byId("b").hasAttribute("data-tms-hl-flash")).toBe(true);
  });

  it("open-marker opens a visible translation, as a click on it would", async () => {
    const { page, id } = await idOf(TEXT, "greeting");
    page.command("open-marker", { id });
    await settle();
    const opened = page.last("selection-opened")?.payload;
    expect([opened?.key, opened?.locale, opened?.value]).toEqual(["greeting", "da", "Hej"]);
  });

  it("open-marker on a visible translation whose element has left the page does nothing", async () => {
    const { page, id } = await idOf(TEXT, "greeting");
    byId("p").remove();
    page.command("open-marker", { id });
    await settle();
    expect(page.of("selection-opened")).toEqual([]);
  });

  it("flash with a reference from no scan does nothing", async () => {
    const { page } = await idOf(TEXT, "greeting");
    page.command("flash", { id: "t999" });
    expect(scrolled).toEqual([]);
  });

  it("a command is refused once edit mode is off", async () => {
    const { page, id } = await idOf(TEXT, "greeting");
    page.host.switchOff();
    page.command("open-marker", { id });
    await settle();
    expect(page.of("selection-opened")).toEqual([]);
  });
});
