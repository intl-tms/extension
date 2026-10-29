import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { HELP, startFixture, type Fixture } from "./fixture.js";

// Signing in, in a real browser: a website with a login for Editors that marks its pages only for a
// signed-in Editor. The same workarounds as the editing suite apply: the Site is granted at
// install, the Side Panel is loaded in a tab, and the Popup's choices are written to storage.
// One more: the test browser never hides a tab that is behind another, so coming back to the page
// is announced to it with the event a real tab switch sends.

const EXTENSION = fileURLToPath(new URL("../dist-e2e", import.meta.url));

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let site: Fixture;
let page: Page;
let panel: Page;

const store = (values: Record<string, unknown>) => panel.evaluate((stored) => chrome.storage.sync.set(stored), values);
const role = (target: Page, name: string) => target.locator(`[data-role="${name}"]`);
const outlined = () => page.locator("[data-tms-hl]");

/** Signs in in another tab, as an Editor would after pressing Sign in, and comes back to the page. */
async function signInElsewhere(account: string) {
  const tab = await context.newPage();
  await tab.goto(`${site.signInUrl}?as=${account}`);
  await page.bringToFront();
  await tab.close();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

test.beforeAll(async () => {
  site = await startFixture({ login: true });
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "intl-tms-e2e-")), {
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  const started = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(started.url()).host;
  page = await context.newPage();
  await page.goto(site.origin);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
});

test.afterAll(async () => {
  await context?.close();
  await site?.close();
});

test("SI1 signed out, switching the Site On marks nothing and the panel says the Editor is not signed in", async () => {
  await store({ sites: [site.origin], configUrl: site.configUrl });
  await expect(role(panel, "sign-in-line")).toHaveText("You are not signed in to this website.");
  await expect(role(panel, "sign-in-help")).toHaveText(HELP.unauthenticated);
  await expect(outlined()).toHaveCount(0);
});

test("SI2 Sign in opens the website's sign-in page in a new tab", async () => {
  const opened = context.waitForEvent("page");
  await role(panel, "sign-in-button").click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(site.signInUrl);
  await tab.close();
});

test("SI3 after signing in and coming back, the page reloads once by itself and is marked", async () => {
  await signInElsewhere("ada");
  await expect(page.locator("#title")).toHaveAttribute("data-tms-hl", /.*/);
});

test("SI4 the panel no longer shows the sign-in line, and names the Editor", async () => {
  await expect(role(panel, "sign-in")).toBeHidden();
  await expect(role(panel, "editing-as")).toHaveText("Editing as Ada Jensen");
});

test("SI5 the name is in no durable or synchronised storage", async () => {
  const stored = await panel.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.sync.get(null)]));
  expect(stored).not.toContain("Ada Jensen");
});

test("SI6 reading and saving work", async () => {
  await page.locator("#title").click({ modifiers: ["Alt"] });
  await expect(panel.locator('[data-role="key"]')).toHaveText("hero.title");
  await panel.locator('[data-role="control"][data-column="value"][data-locale="en"]').fill("Deploy today");
  await panel.locator('[data-role="save"]').click();
  await expect(role(panel, "status")).toHaveText("en ✓");
});

test("SI7 a session that ends mid-edit refuses the save and keeps the draft", async () => {
  await page.reload();
  await page.locator("#title").click({ modifiers: ["Alt"] });
  await expect(panel.locator('[data-role="key"]')).toHaveText("hero.title");
  site.endSessions();
  const control = panel.locator('[data-role="control"][data-column="value"][data-locale="en"]');
  await control.fill("Deploy tomorrow");
  await panel.locator('[data-role="save"]').click();
  await expect(role(panel, "sign-in-line")).toHaveText("You are not signed in to this website.");
  await expect(control).toHaveValue("Deploy tomorrow");
});

test("SI8 after signing in again the page is not reloaded, and the save succeeds", async () => {
  const loads: string[] = [];
  page.on("load", () => loads.push(page.url()));
  await signInElsewhere("ada");
  await expect(role(panel, "editing-as")).toHaveText("Editing as Ada Jensen");
  await panel.locator('[data-role="save"]').click();
  await expect(role(panel, "status")).toHaveText("en ✓");
  expect([loads, await site.stored("hero.title")]).toEqual([[], "Deploy tomorrow"]);
});

test("SI9 signed in without the Editor role, the panel says so, followed by the website's help text", async () => {
  site.endSessions();
  await signInElsewhere("sam");
  await page.reload();
  await expect(role(panel, "sign-in-line")).toHaveText("You are signed in, but may not edit translations here. Ask whoever manages your access to this website.");
  await expect(role(panel, "sign-in-help")).toHaveText(HELP.forbidden);
  await expect(outlined()).toHaveCount(0);
});
