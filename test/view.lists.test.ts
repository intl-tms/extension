// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PANEL, opened, panel, usage } from "./support/view.js";

const usedOn = (view: ReturnType<typeof panel>) => view.role("used-on")!;
const usageRows = (view: ReturnType<typeof panel>) => view.roles<HTMLButtonElement>("usage");

describe("panel view: Used on", () => {
  it("is titled Used on", () => {
    expect(usedOn(opened()).querySelector("h3")?.textContent).toBe(PANEL.usedOnTitle);
  });

  it("VL1 says Loading… while usages have not arrived", () => {
    expect(opened().role("used-on-state")?.textContent).toBe(PANEL.usedOnLoading);
  });

  it("VL2 shows the failure text when usages failed", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [], true);
    expect(view.role("used-on-state")?.textContent).toBe(PANEL.usedOnFailed);
  });

  it("VL3 shows the none-recorded text for no usages", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [], false);
    expect(view.role("used-on-state")?.textContent).toBe(PANEL.usedOnNone);
  });

  it("VL4 a row shows the page's path", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing?a=1")], false);
    expect(usageRows(view)[0]?.querySelector("[data-role=usage-path]")?.textContent).toBe("/pricing");
  });

  it("VL5 a usage with count 3 shows ×3", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing", 3)], false);
    expect(usageRows(view)[0]?.querySelector("[data-role=usage-count]")?.textContent).toBe("×3");
  });

  it("VL6 a usage with count 1 shows no count", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing", 1)], false);
    expect(usageRows(view)[0]?.querySelector("[data-role=usage-count]")).toBeNull();
  });

  it("a row shows when it was last seen as a relative time", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing")], false);
    expect(usageRows(view)[0]?.querySelector("[data-role=usage-time]")?.textContent).toBe("1h ago");
  });

  it("VL7 a row's tooltip is the full address", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing?a=1")], false);
    expect(usageRows(view)[0]?.title).toBe("https://x.example/pricing?a=1");
  });

  it("VL8 a usage with no address has no row", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [{ key: "hero.title", source: "static", file: "src/app.tsx", lastSeen: "2026-01-10T11:00:00.000Z" }], false);
    expect(usageRows(view)).toEqual([]);
  });

  it("VL9 activating a row calls navigate with its address", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing?a=1")], false);
    usageRows(view)[0]?.click();
    expect(view.callbacks.navigate).toHaveBeenCalledWith("https://x.example/pricing?a=1");
  });

  it("VB35 a Used on row is a button", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing")], false);
    expect(usageRows(view)[0]?.tagName).toBe("BUTTON");
  });

  it("usages for another key change nothing", () => {
    const view = opened();
    view.driver.setUsage("another.key", [usage("https://x.example/pricing")], false);
    expect(view.role("used-on-state")?.textContent).toBe(PANEL.usedOnLoading);
  });

  it("an address on another Site shows where it leads and that it opens a new tab", () => {
    const view = opened({ view: { site: () => "https://app.example.com" } });
    view.driver.setUsage("hero.title", [usage("https://elsewhere.example/pricing")], false);
    expect(usageRows(view)[0]?.textContent).toContain(`elsewhere.example/pricing ${PANEL.usedOnNewTab}`);
  });

  it("an address on the page's own Site shows only its path", () => {
    const view = opened({ view: { site: () => "https://app.example.com" } });
    view.driver.setUsage("hero.title", [usage("https://app.example.com/pricing")], false);
    expect(usageRows(view)[0]?.querySelector("[data-role=usage-path]")?.textContent).toBe("/pricing");
  });

  it("XH1 an address containing markup is rendered literally", () => {
    const view = opened();
    view.driver.setUsage("hero.title", [usage("https://x.example/<img src=x onerror=alert(1)>")], false);
    expect(usedOn(view).querySelector("img")).toBeNull();
  });
});
