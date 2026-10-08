// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PANEL, hiddenItem, opened, panel, usage } from "./support/view.js";

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

describe("panel view: Hidden on this page", () => {
  const section = (view: ReturnType<typeof panel>) => view.role("hidden")!;
  const hiddenRows = (view: ReturnType<typeof panel>) => view.roles<HTMLButtonElement>("hidden-item");

  it("VL10 the section is not shown for an empty list", () => {
    const view = panel();
    expect(view.shown(section(view))).toBe(false);
  });

  it("is titled Hidden on this page", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect(section(view).querySelector("h3")?.textContent).toBe(PANEL.hiddenTitle);
  });

  it("VL11 a row shows the attribute name", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect(hiddenRows(view)[0]?.querySelector("[data-role=hidden-attribute]")?.textContent).toBe("aria-label");
  });

  it("VL12 a row shows the value", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect(hiddenRows(view)[0]?.querySelector("[data-role=hidden-value]")?.textContent).toBe("Close");
  });

  it("VL13 a row shows the key", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect(hiddenRows(view)[0]?.querySelector("[data-role=hidden-key]")?.textContent).toBe("icon.close");
  });

  it("a row's tooltip names the attribute and the key", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect(hiddenRows(view)[0]?.title).toBe("aria-label · icon.close");
  });

  it("VL14 the pointer entering a row calls flash with its reference", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    hiddenRows(view)[0]?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(view.callbacks.flash).toHaveBeenCalledWith("a1:aria-label");
  });

  it("VL15 activating a row calls open with its reference", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    hiddenRows(view)[0]?.click();
    expect(view.callbacks.openHidden).toHaveBeenCalledWith("a1:aria-label");
  });

  it("a Hidden row is a button", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect(hiddenRows(view)[0]?.tagName).toBe("BUTTON");
  });

  it("VL16 the section disappears when the list becomes empty", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    view.driver.setHidden([]);
    expect(view.shown(section(view))).toBe(false);
  });

  it("VL17 the section is shown with Hidden items and nothing selected", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    expect([view.shown(section(view)), view.shown(view.role("placeholder"))]).toEqual([true, true]);
  });
});
