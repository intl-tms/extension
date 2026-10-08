// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strip } from "@intl-tms/core";
import { CONFIG_URL, SITE, boot, byId, cleanup, click, mark, outlined, settle } from "./support/page.js";

const PAGE = `<p id="p">${mark("Hej", "greeting")}</p>`;
const never = () => new Promise<Response>(() => undefined);
const json = (body: unknown) => async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const isConfig = (url: string) => url.endsWith("/config");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("loading the configuration", () => {
  it("CL1 fetches exactly the configured address", async () => {
    const page = boot({ html: PAGE });
    await page.host.applySettings(page.settings([SITE], `${SITE}/api/tms/config`));
    expect(page.requests[0]?.url).toBe(`${SITE}/api/tms/config`);
  });

  it("CL2 sends config-loaded with the Locales", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    expect(page.last("config-loaded")?.payload.config?.languages).toEqual(["en", "da"]);
  });

  it("CL3 the slice carries the Source Locale", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    expect(page.last("config-loaded")?.payload.config?.sourceLocale).toBe("en");
  });

  it("CL4 the slice carries an explicit no-Schema", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    expect(page.last("config-loaded")?.payload.config?.schema).toBeNull();
  });

  it("the slice carries the Schema when there is one", async () => {
    const page = boot({ html: PAGE, config: { schema: { valueField: { type: "textarea" } } } });
    await page.on();
    expect(page.last("config-loaded")?.payload.config?.schema).toEqual({ valueField: { type: "textarea" } });
  });

  it("CL5 gives up on a fetch that never answers after the time limit", async () => {
    const page = boot({ html: PAGE, request: never });
    let settled = false;
    void page.host.applySettings(page.settings()).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(true);
  });

  it("does not give up before the time limit", async () => {
    const page = boot({ html: PAGE, request: never });
    let settled = false;
    void page.host.applySettings(page.settings()).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
  });

  it("CL6 logs the reason", async () => {
    const page = boot({ html: PAGE, request: never });
    void page.host.applySettings(page.settings());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.consoleLines).toEqual(["[intl-tms] failed to fetch the editing configuration: the website did not answer within 10 seconds"]);
  });

  it("CL7 counts status 500 as a failure", async () => {
    const page = boot({ html: PAGE, config: false });
    await page.on();
    expect(page.consoleLines).toEqual(["[intl-tms] failed to fetch the editing configuration: the website answered with status 500"]);
  });

  it("sends no config-loaded after a failure", async () => {
    const page = boot({ html: PAGE, config: false });
    await page.on();
    expect(page.of("config-loaded")).toEqual([]);
  });

  it("counts a request that throws as a failure, with its text", async () => {
    const page = boot({ html: PAGE });
    page.overrides.push({ match: isConfig, answer: () => Promise.reject(new TypeError("Failed to fetch")) });
    await page.on();
    expect(page.consoleLines).toEqual(["[intl-tms] failed to fetch the editing configuration: Failed to fetch"]);
  });

  it("CL8 keeps using the earlier configuration after a failure", async () => {
    const page = boot({ html: PAGE, lang: "da" });
    await page.on();
    page.overrides.push({ match: (url) => url === `${SITE}/other/config`, answer: async () => new Response("down", { status: 503 }) });
    await page.host.applySettings(page.settings([SITE], `${SITE}/other/config`));
    click(byId("p"));
    await settle();
    expect(page.last("values-loaded")?.payload.error).toBe(false);
  });

  it("CL9 still outlines marked text after a failure with no configuration before", async () => {
    const page = boot({ html: PAGE, config: false });
    await page.on();
    expect(outlined()).toBe(1);
  });

  it("CL10 a save then replies config-not-loaded", async () => {
    const page = boot({ html: PAGE, config: false });
    await page.on();
    click(byId("p"));
    const { replies } = page.command("save", { key: "greeting", values: { da: { value: "Hej da" } } });
    await settle();
    expect((replies[0] as { error?: string }).error).toBe("config-not-loaded");
  });

  it("CL11 does not fetch again when settings are re-applied with the same address", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    await page.on();
    expect(page.requests.filter((entry) => entry.url === CONFIG_URL)).toHaveLength(1);
  });

  it("CL12 fetches again when the address changes", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    await page.host.applySettings(page.settings([SITE], `${CONFIG_URL}?v=2`));
    expect(page.requests.map((entry) => entry.url)).toContain(`${CONFIG_URL}?v=2`);
  });

  it("fetches again after a failure when settings are re-applied", async () => {
    const page = boot({ html: PAGE, config: false });
    await page.on();
    await page.on();
    expect(page.requests.filter((entry) => entry.url === CONFIG_URL)).toHaveLength(2);
  });

  it("XC1 rejects an HTML page answered with status 200, saying it is not a configuration", async () => {
    const page = boot({ html: PAGE });
    page.overrides.push({ match: isConfig, answer: async () => new Response("<!doctype html><title>Sign in</title>", { headers: { "content-type": "text/html" } }) });
    await page.on();
    expect(page.consoleLines).toEqual([
      "[intl-tms] failed to fetch the editing configuration: the address answered with an HTML page, which is not an editing configuration",
    ]);
  });

  it("rejects another product's JSON", async () => {
    const page = boot({ html: PAGE });
    page.overrides.push({ match: isConfig, answer: json({ name: "something else" }) });
    await page.on();
    expect(page.last("status-changed")?.payload.status.configReason).toBe(
      "the address answered with JSON of another shape, which is not an editing configuration",
    );
  });

  it("XD8 says the website is newer when it speaks a newer protocol", async () => {
    const page = boot({ html: PAGE });
    page.overrides.push({ match: isConfig, answer: json({ ...page.config, protocol: 99 }) });
    await page.on();
    expect(page.last("status-changed")?.payload.status.protocol).toBe("website-newer");
  });

  it("does not start half-working against an incompatible website", async () => {
    const page = boot({ html: PAGE });
    page.overrides.push({ match: isConfig, answer: json({ ...page.config, protocol: 99 }) });
    await page.on();
    expect(outlined()).toBe(0);
  });

  it("reports a loaded, compatible configuration in its status", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    const status = page.last("status-changed")?.payload.status;
    expect([status?.config, status?.protocol]).toEqual(["loaded", "compatible"]);
  });

  it("reports how many translations the page carries", async () => {
    const page = boot({ html: `${PAGE}<button aria-label="${mark("Luk", "a.close")}">x</button>` });
    await page.on();
    expect(page.last("status-changed")?.payload.status.found).toEqual({ text: 1, hidden: 1 });
  });

  it("reports a page served without Markers", async () => {
    const page = boot({ html: "<p>plain</p>" });
    await page.on();
    expect(page.last("status-changed")?.payload.status.marked).toBe(false);
  });
});

describe("the page's Locale", () => {
  const opened = async (options: Parameters<typeof boot>[0]) => {
    const page = boot({ html: PAGE, ...options });
    await page.on();
    click(byId("p"));
    return page.last("selection-opened")?.payload.locale;
  };

  it("CL13 resolves en-GB to the configured en-gb", async () => {
    expect(await opened({ lang: "en-GB", config: { locales: ["en-gb", "da"], sourceLocale: "da" } })).toBe("en-gb");
  });

  it("CL14 resolves en_GB to the configured en-gb", async () => {
    expect(await opened({ lang: "en_GB", config: { locales: ["en-gb", "da"], sourceLocale: "da" } })).toBe("en-gb");
  });

  it("CL15 a save of en-gb on a page declaring en-GB is shown on the page", async () => {
    const page = boot({ html: PAGE, lang: "en-GB", config: { locales: ["en-gb", "da"], sourceLocale: "da" } });
    await page.on();
    click(byId("p"));
    page.command("save", { key: "greeting", values: { "en-gb": { value: "Hello" } } });
    await settle();
    expect(strip(byId("p").textContent ?? "")).toBe("Hello");
  });

  it("CL16 a page with no language shows the Source Locale", async () => {
    expect(await opened({ config: { locales: ["en", "da"], sourceLocale: "da" } })).toBe("da");
  });

  it("CL17 with no Source Locale either, the first configured Locale", async () => {
    expect(await opened({ config: { locales: ["fr", "de"], sourceLocale: undefined } })).toBe("fr");
  });

  it("CL18 with no configuration, the empty string", async () => {
    expect(await opened({ config: false })).toBe("");
  });

  it("CL19 an unconfigured page language is passed on as written", async () => {
    expect(await opened({ lang: "sv" })).toBe("sv");
  });

  it("CL20 a bare language does not match a regional Locale", async () => {
    expect(await opened({ lang: "en", config: { locales: ["en-gb", "da"], sourceLocale: "da" } })).toBe("en");
  });

  it("CL21 the next opening uses the page's new language", async () => {
    const page = boot({ html: PAGE, lang: "en" });
    await page.on();
    click(byId("p"));
    document.documentElement.lang = "da";
    click(byId("p"));
    expect(page.last("selection-opened")?.payload.locale).toBe("da");
  });
});
