// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE, boot, cleanup, mark, outlined, rescan, settle } from "./support/page.js";

const TEXT = `<p id="p">${mark("Hej", "greeting")}</p>`;
const USAGE = { endpoints: { usageReport: `${SITE}/api/tms/usage`, usageRead: `${SITE}/api/tms/usage/{key}` } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const body = (page: ReturnType<typeof boot>, index = -1) => page.usageReports().at(index)?.body as { url: string; title?: string; keys: { key: string; count: number }[] };

describe("usage reporting", () => {
  it("UN1 sends a usage report when the first scan completes", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    expect(page.usageReports()).toHaveLength(1);
  });

  it("UN2 the report carries the normalised address", async () => {
    window.history.replaceState(null, "", "/pricing?utm_source=x#plans");
    const page = boot({ html: TEXT });
    await page.on();
    expect(body(page).url).toBe(`${SITE}/pricing`);
  });

  it("UN3 the reported title carries no Marker", async () => {
    const page = boot({ html: TEXT, title: mark("Priser", "page.title") });
    await page.on();
    expect(body(page).title).toBe("Priser");
  });

  it("UN4 a key rendered three times is counted three times", async () => {
    const page = boot({ html: TEXT.repeat(3).replaceAll('id="p"', "") });
    await page.on();
    expect(body(page).keys).toEqual([{ key: "greeting", count: 3 }]);
  });

  it("UN5 a key added after edit mode came on is reported", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", `<p>${mark("Ny", "later")}</p>`);
    await rescan();
    expect(body(page).keys.map((entry) => entry.key)).toEqual(["greeting", "later"]);
  });

  it("UN6 a client-side route change is reported under the new address", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    window.history.pushState(null, "", "/pricing");
    document.body.insertAdjacentHTML("beforeend", "<p>plain</p>");
    await rescan();
    expect(body(page).url).toBe(`${SITE}/pricing`);
  });

  it("UN7 a change that touches no translation sends no second report", async () => {
    const page = boot({ html: TEXT });
    await page.on();
    document.body.insertAdjacentHTML("beforeend", "<p>plain</p>");
    await rescan();
    expect(page.usageReports()).toHaveLength(1);
  });

  it("UN8 marked text is still outlined when the report endpoint fails", async () => {
    const page = boot({ html: TEXT });
    page.overrides.push({ match: (url) => url.endsWith("/usage"), answer: () => Promise.reject(new TypeError("Failed to fetch")) });
    await page.on();
    expect(outlined()).toBe(1);
  });

  it("UN9 makes no report request when no report endpoint is configured", async () => {
    const page = boot({ html: TEXT, config: { basePath: undefined, endpoints: { values: `${SITE}/api/tms/keys/{key}` } } });
    await page.on();
    expect(page.usageReports()).toEqual([]);
  });

  it("reports to the configured endpoint", async () => {
    const page = boot({ html: TEXT, config: USAGE });
    await page.on();
    expect(page.usageReports()[0]?.url).toBe(`${SITE}/api/tms/usage`);
  });
});

describe("navigating", () => {
  const ready = async (options: Parameters<typeof boot>[0] = {}) => {
    const page = boot({ html: TEXT, ...options });
    await page.on();
    page.events.length = 0;
    return page;
  };
  const reportedAgain = async (page: ReturnType<typeof boot>) => {
    const before = page.usageReports().length;
    document.body.insertAdjacentHTML("beforeend", "<p>plain</p>");
    await rescan();
    return page.usageReports().length > before;
  };

  it("UN10 sends the page to an address on its own Site", async () => {
    const page = await ready({ origin: "https://app.example.com" });
    page.command("navigate", { url: "https://app.example.com/pricing" });
    expect(page.assigned).toEqual(["https://app.example.com/pricing"]);
  });

  it("UN11 sends the page to an http: address", async () => {
    const page = await ready();
    page.command("navigate", { url: `${SITE}/pricing` });
    expect(page.assigned).toEqual([`${SITE}/pricing`]);
  });

  it("UN12 resets usage memory before navigating", async () => {
    const page = await ready();
    page.command("navigate", { url: `${SITE}/pricing` });
    expect(await reportedAgain(page)).toBe(true);
  });

  it.each([
    ["UN13", "javascript:alert(1)"],
    ["UN14", "data:text/html,x"],
    ["UN15", "/pricing"],
    ["UN16", 42],
  ])("%s does not navigate to %j", async (_id, url) => {
    const page = await ready();
    page.command("navigate", { url });
    expect(page.assigned).toEqual([]);
  });

  it("UN17 an invalid navigate does not reset usage memory", async () => {
    const page = await ready();
    page.command("navigate", { url: "javascript:alert(1)" });
    expect(await reportedAgain(page)).toBe(false);
  });

  it("XN1 an address on another origin is not followed in place", async () => {
    const page = await ready();
    page.command("navigate", { url: "https://elsewhere.example/pricing" });
    expect(page.assigned).toEqual([]);
  });

  it("an address on another origin does not reset usage memory", async () => {
    const page = await ready();
    page.command("navigate", { url: "https://elsewhere.example/pricing" });
    expect(await reportedAgain(page)).toBe(false);
  });

  it("XN3 an address on the same Site is followed in place", async () => {
    const page = await ready();
    page.command("navigate", { url: `${SITE}/docs?tab=1` });
    await settle();
    expect(page.events).toEqual(["assign"]);
  });
});
