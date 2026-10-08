// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, byId, cleanup, click, mark, rescan, settle } from "./support/page.js";

const TEXT = `<p id="p">${mark("Hej", "greeting")}</p>`;
const HIDDEN = `<button id="b" aria-label="${mark("Luk", "a.close")}">x</button>`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("hosting the session", () => {
  it("PH1 a Page Host just constructed has sent nothing", () => {
    expect(boot({ html: TEXT }).sent).toEqual([]);
  });

  it("PH2 a Page Host just constructed has fetched nothing", () => {
    expect(boot({ html: TEXT }).requests).toEqual([]);
  });

  it("PH3 outlines the element of marked text", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    expect(byId("p").hasAttribute("data-tms-hl")).toBe(true);
  });

  it("PH4 hidden-changed carries a marked aria-label", async () => {
    const page = boot({ html: HIDDEN });
    await page.on();
    expect(page.last("hidden-changed")?.payload.items?.map(({ attribute, key, value }) => ({ attribute, key, value }))).toEqual([
      { attribute: "aria-label", key: "a.close", value: "Luk" },
    ]);
  });

  it("PH5 sends no second hidden-changed for a rescan that did not change the list", async () => {
    const page = boot({ html: HIDDEN });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", TEXT);
    await rescan();
    expect(page.of("hidden-changed")).toHaveLength(1);
  });

  it("PH6 selection-opened carries the clicked element's key", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    expect(page.last("selection-opened")?.payload.key).toBe("greeting");
  });

  it("PH7 it carries the on-page value without its Marker", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    expect(page.last("selection-opened")?.payload.value).toBe("Hej");
  });

  it("PH8 it carries the Current Locale", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    expect(page.last("selection-opened")?.payload.locale).toBe("da");
  });

  it("is exactly one message with the sink's arguments and nothing added", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    expect(page.of("selection-opened").map((message) => message.payload)).toEqual([{ key: "greeting", locale: "da", value: "Hej" }]);
  });

  it("is addressed to the Worker", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    expect(page.last("selection-opened")?.to).toBe("worker");
  });

  it("each opening has a new selection identifier, even of the same key", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    click(byId("p"));
    const [first, second] = page.of("selection-opened").map((message) => message.selection);
    expect(first !== undefined && second !== undefined && first !== second).toBe(true);
  });

  it("PH9 values-loaded is sent for the opened key", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    await settle();
    expect(page.last("values-loaded")?.payload).toEqual({ key: "greeting", values: { locales: { da: { value: "Hej" } } }, error: false });
  });

  it("values-loaded carries the identifier of the selection it belongs to", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    await settle();
    expect(page.last("values-loaded")?.selection).toBe(page.last("selection-opened")?.selection);
  });

  it("PH10 usage-loaded is sent for the opened key", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    click(byId("p"));
    await settle();
    expect(page.last("usage-loaded")?.payload.key).toBe("greeting");
  });

  it("PH11 values-loaded carries the error flag when the read fails", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    page.overrides.push({ match: (url) => url.includes("/keys/"), answer: async () => new Response("down", { status: 500 }) });
    click(byId("p"));
    await settle();
    expect(page.last("values-loaded")?.payload.error).toBe(true);
  });

  it("PH12 an element with two translations sends no selection-opened until the picker is answered", async () => {
    const page = boot({ html: `<button id="two" title="${mark("Luk", "a.close")}">${mark("Hej", "greeting")}</button>`, lang: "da" });
    await page.on();
    click(byId("two"));
    expect(page.of("selection-opened")).toEqual([]);
  });

  it("PH13 nothing escapes when the messenger throws synchronously", async () => {
    const page = boot({
      html: TEXT,
      host: {
        messenger: {
          send: () => {
            throw new Error("Extension context invalidated.");
          },
        },
      },
    });
    await expect(page.on()).resolves.toBeUndefined();
  });

  it("PH14 there is no unhandled rejection when the messenger's promise rejects", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const page = boot({ html: TEXT, host: { messenger: { send: () => Promise.reject(new Error("Could not establish connection.")) } } });
    await page.on();
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("PH15 hidden-changed includes a marked attribute added after edit mode came on", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", HIDDEN);
    await rescan();
    expect(page.last("hidden-changed")?.payload.items?.map((item) => item.key)).toEqual(["a.close"]);
  });

  it("PH16 hidden-changed is empty when the last Hidden translation leaves the page", async () => {
    const page = boot({ html: HIDDEN });
    await page.on();
    byId("b").remove();
    await rescan();
    expect(page.last("hidden-changed")?.payload.items).toEqual([]);
  });

  it("PH17 a change that touches no translation sends no hidden-changed", async () => {
    const page = boot({ html: HIDDEN });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", "<p>plain</p>");
    await rescan();
    expect(page.of("hidden-changed")).toHaveLength(1);
  });

  it("PH18 open-hidden with a listed item's reference opens that item", async () => {
    const page = boot({ html: HIDDEN, lang: "da" });
    await page.on();
    page.command("open-hidden", { id: page.last("hidden-changed")!.payload.items![0]!.id });
    expect(page.last("selection-opened")?.payload.key).toBe("a.close");
  });

  it("PH19 open-hidden works for an item added after edit mode came on", async () => {
    const page = boot({ html: TEXT, lang: "da" });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", HIDDEN);
    await rescan();
    page.command("open-hidden", { id: page.last("hidden-changed")!.payload.items![0]!.id });
    expect(page.last("selection-opened")?.payload.key).toBe("a.close");
  });

  it("PH20 flash with a listed item's reference flashes that element", async () => {
    const page = boot({ html: HIDDEN });
    await page.on();
    page.command("flash", { id: page.last("hidden-changed")!.payload.items![0]!.id });
    expect(byId("b").hasAttribute("data-tms-hl-flash")).toBe(true);
  });

  it("open-hidden with a stale reference does nothing", async () => {
    const page = boot({ html: HIDDEN });
    await page.on();
    page.command("open-hidden", { id: "a999:aria-label" });
    expect(page.of("selection-opened")).toEqual([]);
  });
});
