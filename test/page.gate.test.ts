// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_URL, SITE, TOGGLE, boot, cleanup, byId, click, mark, outlined, reload, rescan, settle } from "./support/page.js";

const PAGE = `<p id="p">${mark("Hej", "greeting")}</p>`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the Gate: a Site that is not Listed", () => {
  async function notListed() {
    const page = boot({ html: PAGE, cookies: [] });
    await page.host.applySettings(page.settings(["https://other.example"]));
    await settle();
    return page;
  }

  it("GT1 makes no request", async () => {
    expect((await notListed()).requests).toEqual([]);
  });

  it("GT2 writes no cookie", async () => {
    expect((await notListed()).jar.writes).toEqual([]);
  });

  it("GT3 does not reload", async () => {
    expect((await notListed()).reloads.count).toBe(0);
  });

  it("GT4 outlines nothing", async () => {
    await notListed();
    expect(outlined()).toBe(0);
  });

  it("GT5 sends no message", async () => {
    expect((await notListed()).sent).toEqual([]);
  });

  it("leaves the document exactly as it found it", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    const before = document.documentElement.outerHTML;
    await page.host.applySettings(page.settings(["https://other.example"]));
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("GT28 makes no request when the script is still registered for a Site that was switched Off", async () => {
    const page = boot({ html: PAGE });
    await page.host.applySettings(page.settings([]));
    expect(page.requests).toEqual([]);
  });

  it("does not act for another port of a Listed host", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.host.applySettings(page.settings(["http://localhost:4000"]));
    expect(page.jar.writes).toEqual([]);
  });

  it("does not act on a stored list that is not a list", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.host.applySettings(page.settings(SITE));
    expect(page.jar.writes).toEqual([]);
  });
});

describe("the Gate: Listed with no configuration address", () => {
  it("GT6 makes no request", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.host.applySettings(page.settings([SITE], "  "));
    expect(page.requests).toEqual([]);
  });

  it("GT7 writes no cookie", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.host.applySettings(page.settings([SITE], ""));
    expect(page.jar.writes).toEqual([]);
  });
});

describe("the Toggle: a page rendered without it", () => {
  it("GT8 sets the Toggle", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.jar.stored.get(TOGGLE)).toBe("1");
  });

  it("GT9 reloads the page", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.reloads.count).toBe(1);
  });

  it("GT10 writes the cookie for the root path, same-site-lax", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.jar.writes[0]).toMatch(new RegExp(`^${TOGGLE}=1; Path=/; SameSite=Lax`));
  });

  it("GT11 fetches no configuration before the reload", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.requests).toEqual([]);
  });

  it("outlines nothing before the reload", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(outlined()).toBe(0);
  });

  it("XG2 gives the Toggle a bounded lifetime", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.jar.writes[0]).toContain("Max-Age=43200");
  });

  it("XG1 marks the Toggle secure on a secure page", async () => {
    const page = boot({ html: PAGE, cookies: [], origin: "https://app.example.com" });
    await page.on();
    expect(page.jar.writes[0]).toMatch(/; Secure$/);
  });

  it("does not mark the Toggle secure on a page that is not", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.jar.writes[0]).not.toContain("Secure");
  });

  it("XG3 does not reload a second time when the Toggle did not survive the first reload", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    page.jar.stored.clear();
    const reloaded = reload(page);
    await reloaded.on();
    expect(reloaded.reloads.count).toBe(0);
  });

  it("says in the console why edit mode stays off when the Toggle did not survive the reload", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    page.jar.stored.clear();
    const reloaded = reload(page);
    await reloaded.on();
    expect(reloaded.consoleLines.join("\n")).toContain("did not keep tms-edit across a reload");
  });

  it("reports that it is about to reload", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    await page.on();
    expect(page.last("status-changed")?.payload.status.toggle).toBe("pending-reload");
  });
});

describe("the Toggle: cookies are blocked", () => {
  const blocked = async () => {
    const page = boot({ html: PAGE, cookies: [], cookiesBlocked: true });
    await page.on();
    return page;
  };

  it("GT12 does not reload", async () => {
    expect((await blocked()).reloads.count).toBe(0);
  });

  it("GT13 writes the reason to the page's console", async () => {
    expect((await blocked()).consoleLines).toEqual([`[intl-tms] edit mode stays off: cookies are blocked for this site, so ${TOGGLE} could not be set`]);
  });

  it("GT14 outlines nothing", async () => {
    await blocked();
    expect(outlined()).toBe(0);
  });

  it("XC7 reports that reason in its status", async () => {
    expect((await blocked()).last("status-changed")?.payload.status.toggle).toBe("blocked");
  });
});

describe("the Toggle: recognised exactly", () => {
  it("GT15 a cookie whose name ends with the Toggle's is not the Toggle", async () => {
    const page = boot({ html: PAGE, cookies: [`x${TOGGLE}=1`] });
    await page.on();
    expect(page.reloads.count).toBe(1);
  });

  it("GT16 the Toggle's name with another value is not the Toggle", async () => {
    const page = boot({ html: PAGE, cookies: [`${TOGGLE}=10`] });
    await page.on();
    expect(page.reloads.count).toBe(1);
  });

  it("GT17 the Toggle among other cookies is recognised", async () => {
    const page = boot({ html: PAGE, cookies: ["a=b", `${TOGGLE}=1`, "c=d"] });
    await page.on();
    expect(outlined()).toBe(1);
  });

  it("GT18 a page rendered with the Toggle does not reload", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    expect(page.reloads.count).toBe(0);
  });

  it("reads and writes the page's own cookies by default", async () => {
    document.cookie = `${TOGGLE}=1`;
    const page = boot({ html: PAGE, cookies: [], host: { cookies: undefined } });
    await page.on();
    await page.host.applySettings(page.settings([]));
    expect(document.cookie).not.toContain(TOGGLE);
  });
});

describe("switching off", () => {
  const onThenOff = async () => {
    const page = boot({ html: `${PAGE}<button id="b" aria-label="${mark("Luk", "a.close")}">x</button>` });
    await page.on();
    page.sent.length = 0;
    await page.host.applySettings(page.settings([]));
    await settle();
    return page;
  };

  it("GT19 removes the outlines when the Site is removed from the list", async () => {
    await onThenOff();
    expect(outlined()).toBe(0);
  });

  it("GT20 expires the Toggle", async () => {
    expect((await onThenOff()).jar.stored.has(TOGGLE)).toBe(false);
  });

  it("expires the Toggle with an empty value, the root path and a date in the past", async () => {
    expect((await onThenOff()).jar.writes.at(-1)).toBe(`${TOGGLE}=; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  });

  it("GT21 sends an empty Hidden list", async () => {
    expect((await onThenOff()).last("hidden-changed")?.payload).toEqual({ items: [] });
  });

  it("GT22 reports usage again once switched On again", async () => {
    const page = await onThenOff();
    const before = page.usageReports().length;
    await page.on(); // sets the Toggle and asks for a reload
    await page.on(); // the page as it comes back
    expect(page.usageReports().length).toBe(before + 1);
  });

  it("GT23 leaves no highlight attribute in the document", async () => {
    await onThenOff();
    expect(document.documentElement.outerHTML).not.toContain("data-tms-hl");
  });

  it("stops following the page", async () => {
    await onThenOff();
    document.body.insertAdjacentHTML("beforeend", `<p>${mark("Ny", "later")}</p>`);
    await rescan();
    expect(outlined()).toBe(0);
  });

  it("GT24 writes no cookie when it was never active", async () => {
    const page = boot({ html: PAGE, cookies: [] });
    page.host.switchOff();
    expect(page.jar.writes).toEqual([]);
  });

  it("GT25 sends no message when it was never active", async () => {
    const page = boot({ html: PAGE });
    page.host.switchOff();
    expect(page.sent).toEqual([]);
  });

  it("switches off when the configuration address is cleared", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    await page.host.applySettings(page.settings([SITE], ""));
    expect(outlined()).toBe(0);
  });

  it("reports that the Gate is closed", async () => {
    expect((await onThenOff()).last("status-changed")?.payload.status.gate).toBe("off");
  });
});

describe("applying settings again", () => {
  it("GT26 does not fetch the configuration again when another Site is switched On", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    await page.host.applySettings(page.settings([SITE, "https://other.example"]));
    expect(page.requests.filter((entry) => entry.url === CONFIG_URL)).toHaveLength(1);
  });

  it("does not restart the session when another Site is switched On", async () => {
    const page = boot({ html: PAGE });
    await page.on();
    click(byId("p"));
    await page.host.applySettings(page.settings([SITE, "https://other.example"]));
    expect(document.querySelectorAll("[data-tms-hl-active]")).toHaveLength(1);
  });

  it("GT27 starts the session once when settings are applied twice while the first waits for the configuration", async () => {
    const page = boot({ html: PAGE });
    const first = page.host.applySettings(page.settings());
    const second = page.host.applySettings(page.settings([SITE, "https://other.example"]));
    await Promise.all([first, second]);
    await settle();
    expect([outlined(), page.of("config-loaded").length, page.requests.filter((entry) => entry.url === CONFIG_URL).length]).toEqual([1, 1, 1]);
  });

  it("does not start when the Site is switched Off while the configuration is loading", async () => {
    const page = boot({ html: PAGE });
    const first = page.host.applySettings(page.settings());
    const second = page.host.applySettings(page.settings([]));
    await Promise.all([first, second]);
    await settle();
    expect(outlined()).toBe(0);
  });
});
