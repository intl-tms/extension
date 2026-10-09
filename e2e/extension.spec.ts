import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { startFixture, type Fixture } from "./fixture.js";

// The built Extension in a real browser, walking the editing loop. Everything the unit tests
// cannot see lives in the bootstraps, and this is the test that runs them.
//
// Three things a test cannot do are worked around, deliberately:
//  - The browser's permission prompt cannot be clicked. The test build (dist-e2e) is granted the
//    fixture's host at install; everything after the grant is the shipped code.
//  - The Side Panel cannot be driven as a panel. The same document is loaded in a tab, where it
//    sends the same ready message and receives the same pushes.
//  - The Popup cannot be clicked. The test writes what the Popup would store.

const EXTENSION = fileURLToPath(new URL("../dist-e2e", import.meta.url));

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let site: Fixture;
let other: Fixture;
let page: Page;
let panel: Page;
let extensionId: string;

// Extension APIs are called from the panel document, which is an extension page: the test
// runner's handle on the Worker does not survive the Worker being stopped.
const store = (values: Record<string, unknown>) => panel.evaluate((stored) => chrome.storage.sync.set(stored), values);
const registrations = () => panel.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.matches));
const control = (locale: string) => panel.locator(`[data-role="control"][data-column="value"][data-locale="${locale}"]`);
const status = () => panel.locator('[data-role="status"]');
const outlined = (target: Page) => target.locator("[data-tms-hl]");

async function editAndSave(text: string) {
  await control("en").fill(text);
  await panel.locator('[data-role="save"]').click();
}

test.beforeAll(async () => {
  site = await startFixture();
  other = await startFixture({ alwaysMarked: true });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "intl-tms-e2e-")), {
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  const started = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(started.url()).host;
  // The tab is already open when the Site is switched On.
  page = await context.newPage();
  await page.goto(site.origin);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
});

test.afterAll(async () => {
  await context?.close();
  await site?.close();
  await other?.close();
});

test("EE1 switching the Site On outlines a marked string in a tab that was already open", async () => {
  await expect(outlined(page)).toHaveCount(0);
  await store({ sites: [site.origin], configUrl: site.configUrl });
  await expect(page.locator("#title")).toHaveAttribute("data-tms-hl", /.*/);
});

test("EE2 the registration lists that Site's pattern and nothing else", async () => {
  expect(await registrations()).toEqual([[`${site.origin}/*`]]);
});

test("EE3 the Page Host is present in that tab: it set the Toggle and left plain text alone", async () => {
  expect([await page.evaluate(() => document.cookie), await page.locator("#plain").getAttribute("data-tms-hl")]).toEqual(["tms-edit=1", null]);
});

test("EE4 no Page Host is present in the tab of a second Site that was never switched On", async () => {
  const second = await context.newPage();
  await second.goto(other.origin);
  // This Site always serves Markers and shares its host (and so its grant and its cookies) with the
  // first: only the exact-origin registration keeps the Page Host out.
  await second.waitForTimeout(500);
  expect(await outlined(second).count()).toBe(0);
  await second.close();
});

test("an Alt-click on an outlined link edits it and does not follow it", async () => {
  await page.locator("#link").click({ modifiers: ["Alt"] });
  await expect(panel.locator('[data-role="key"]')).toHaveText("nav.docs");
  expect(new URL(page.url()).hash).toBe("");
});

test("a plain click on the same link follows it", async () => {
  await page.locator("#link").click();
  expect(new URL(page.url()).hash).toBe("#docs");
});

// Whether the browser's own list is open cannot be seen from the page. Focus can, and both are
// the default of the same press: a select that did not take focus did not open either.
test("an Alt-click on a drop-down offers its options to edit, and the press never reaches the control", async () => {
  await page.locator("#lang").click({ modifiers: ["Alt"] });
  await expect(page.locator("[data-tms-picker-row]")).toHaveText(["textEnglish", "textDansk"]);
  await expect(page.locator("#lang:focus")).toHaveCount(0);
});

test("choosing an option there shows its key in the panel", async () => {
  await page.locator("[data-tms-picker-row]").nth(1).click();
  await expect(panel.locator('[data-role="key"]')).toHaveText("lang.da");
});

test("a plain click on the drop-down is the page's: the control takes it", async () => {
  await page.locator("#lang").click();
  await expect(page.locator("#lang:focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("EE5 Alt-clicking the outlined string shows its key in the panel", async () => {
  await page.locator("#title").click({ modifiers: ["Alt"] });
  await expect(panel.locator('[data-role="key"]')).toHaveText("hero.title");
});

test("EE6 the panel's Current Locale control holds its text", async () => {
  await expect(control("en")).toHaveValue("Deploy now");
});

test("EE7 an edited and saved value shows the success token", async () => {
  await editAndSave("Deploy today");
  await expect(status()).toHaveText("en ✓");
});

test("EE8 the website holds the new value", async () => {
  expect(await site.stored("hero.title")).toBe("Deploy today");
});

test("EE9 the page shows the new text", async () => {
  await expect(page.locator("#title")).toContainText("Deploy today");
});

test("EE10–EE12 a save after the Worker was stopped succeeds, handled by a Worker that never saw the click", async () => {
  // Ask the browser to stop it, rather than waiting thirty seconds, and watch it happen.
  const cdp = await context.newCDPSession(panel);
  const states: string[] = [];
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const version of versions) if (states.at(-1) !== version.runningStatus) states.push(version.runningStatus);
  });
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await expect.poll(() => states.at(-1)).toBe("stopped");
  const stoppedAt = states.length;

  await editAndSave("Deploy tonight");
  await expect(status()).toHaveText("en ✓");
  expect(await site.stored("hero.title")).toBe("Deploy tonight");
  // The Worker that routed this save was started after the stop: it never saw the click.
  expect(states.slice(stoppedAt)).toContain("running");
});

test("EE13 an element with a marked attribute added to the page appears in Hidden on this page", async () => {
  await page.evaluate(async () => {
    const catalog = (await (await fetch("/catalog.json")).json()) as { icon: { close: string } };
    const button = document.createElement("button");
    button.id = "icon";
    button.setAttribute("aria-label", catalog.icon.close);
    button.textContent = "x";
    document.body.append(button);
  });
  await expect(panel.locator('[data-role="hidden-item"] [data-role="hidden-key"]')).toHaveText("icon.close");
});

test("EE14 activating its row shows its key in the panel", async () => {
  await panel.locator('[data-role="hidden-item"]').click();
  await expect(panel.locator('[data-role="key"]')).toHaveText("icon.close");
});

test("EE15 editing and saving it shows the new value in its row", async () => {
  await expect(control("en")).toHaveValue("Close");
  await editAndSave("Close dialog");
  await expect(panel.locator('[data-role="hidden-item"] [data-role="hidden-value"]')).toHaveText("Close dialog");
});

test("EE16 a save after another Editor changed the same key says it changed elsewhere", async () => {
  await page.locator("#title").click({ modifiers: ["Alt"] });
  await expect(control("en")).toHaveValue("Deploy tonight");
  await site.write("hero.title", "Ship it");
  await editAndSave("Deploy at dawn");
  await expect(status()).toHaveText("en ⚠ changed elsewhere");
});

test("EE17 the notice shows the other Editor's value", async () => {
  await expect(panel.locator('[data-role="conflict"][data-column="value"]').first()).toHaveText("Changed since you opened it. Stored now: Ship it");
});

test("EE18 the control still holds what this Editor typed", async () => {
  await expect(control("en")).toHaveValue("Deploy at dawn");
});

test("EE19 the website still holds the other Editor's value", async () => {
  expect(await site.stored("hero.title")).toBe("Ship it");
});

test("EE20 pressing Save again stores this Editor's value", async () => {
  await panel.locator('[data-role="save"]').click();
  await expect(status()).toHaveText("en ✓");
  expect(await site.stored("hero.title")).toBe("Deploy at dawn");
});

test("EE21–EE22 a value with a tag reloads the page, which shows it rendered, and the panel reports success", async () => {
  await page.locator("#rich").click({ modifiers: ["Alt"] });
  await expect(control("en")).toHaveValue("Read the <b>docs</b>");
  const reloaded = page.waitForEvent("load");
  await editAndSave("Read the <b>manual</b>");
  await reloaded;
  await expect(page.locator("#rich b")).toHaveText("manual");
  await expect(status()).toHaveText("en ✓");
});

test("EE23–EE24 switching the Site Off removes the outlines and the Toggle", async () => {
  await expect(outlined(page)).not.toHaveCount(0);
  await store({ sites: [] });
  await expect(outlined(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("EE25 the page loaded again has no Page Host and no registration", async () => {
  await page.reload();
  await page.waitForTimeout(500);
  expect([await outlined(page).count(), await page.evaluate(() => document.cookie), await registrations()]).toEqual([0, "", []]);
});
