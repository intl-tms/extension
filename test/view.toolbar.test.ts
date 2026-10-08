// @vitest-environment jsdom
import type { PanelConfig } from "@intl-tms/core/tools";
import { describe, expect, it } from "vitest";
import { CONFIG, PANEL, STATUS, opened } from "./support/view.js";

const TOOLBAR: PanelConfig = { locales: ["en", "da", "de"], sourceLocale: "en", schema: { fields: [STATUS], toolbar: { search: true, filters: [{ field: "status" }] } } };
const VALUES = {
  en: { value: "Go to <a>Docs</a>", status: "approved" },
  da: { value: "Gå til <a>Docs</a>", status: "draft" },
  de: { value: "Zu den <a>Docs</a>", status: "approved" },
};
const withToolbar = (config: PanelConfig = TOOLBAR) => opened({ config }, VALUES);
type View = ReturnType<typeof opened>;
const searchBox = (view: View) => view.role<HTMLInputElement>("search")!;
const filter = (view: View) => view.role<HTMLSelectElement>("filter")!;
const locales = (view: View) => view.rows().map((row) => row.dataset.locale);
const hint = (view: View) => (view.shown(view.role("toolbar-hint")) ? view.role("toolbar-hint")?.textContent : undefined);

describe("panel view: toolbar", () => {
  it("VT1 a Schema with no toolbar renders none", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    expect([view.role("search"), view.role("filter"), view.shown(view.role("toolbar"))]).toEqual([null, null, false]);
  });

  it("VT2 search enabled renders a search box", () => {
    expect(searchBox(withToolbar()).placeholder).toBe(PANEL.searchPlaceholder);
  });

  it("VT3 a declared filter renders a dropdown whose first option is All", () => {
    expect([...filter(withToolbar()).options].map((option) => option.textContent)).toEqual([PANEL.filterAll, "Draft", "Approved"]);
  });

  it("VT4 search text matching one Locale hides the other non-current rows", () => {
    const view = withToolbar();
    view.type(searchBox(view), "zu den");
    expect(locales(view)).toEqual(["en", "de"]);
  });

  it("search matches a Locale code", () => {
    const view = withToolbar();
    view.type(searchBox(view), "DA");
    expect(locales(view)).toEqual(["en", "da"]);
  });

  it("VT5 search text matching nothing still shows the Current Locale's row", () => {
    const view = withToolbar();
    view.type(searchBox(view), "zzz");
    expect(locales(view)).toEqual(["en"]);
  });

  it("VT6 a chosen filter value hides rows with another value", () => {
    const view = withToolbar();
    view.type(filter(view), "approved", "change");
    expect(locales(view)).toEqual(["en", "de"]);
  });

  it("VT7 a row edited, then hidden by the search, still saves", async () => {
    const view = withToolbar();
    view.control("da").value = "Gå hen til <a>Docs</a>";
    view.type(searchBox(view), "zu den");
    await view.press("save");
    expect(view.saves[0]?.writes.da?.value).toBe("Gå hen til <a>Docs</a>");
  });

  it("the search box keeps focus while the rows repaint", () => {
    const view = withToolbar();
    searchBox(view).focus();
    view.type(searchBox(view), "zu");
    expect(document.activeElement).toBe(searchBox(view));
  });

  it("VT8 the search box is empty when a different key opens", () => {
    const view = withToolbar();
    view.type(searchBox(view), "zu den");
    view.driver.open("footer.note", "en", "Footer");
    expect(searchBox(view).value).toBe("");
  });

  it("VT9 every filter is back to All when a different key opens", () => {
    const view = withToolbar();
    view.type(filter(view), "approved", "change");
    view.driver.open("footer.note", "en", "Footer");
    expect(filter(view).value).toBe("");
  });

  it("a different key starts with every Locale shown", () => {
    const view = withToolbar();
    view.type(searchBox(view), "zu den");
    view.driver.open("footer.note", "en", "Footer");
    expect(locales(view)).toEqual(["en", "da", "de"]);
  });

  const REQUIRED: PanelConfig = { ...TOOLBAR, schema: { ...TOOLBAR.schema, fields: [{ ...STATUS, required: true }] } };

  it("VT10 the hint names the Locale of a hidden row with an empty required Field", () => {
    const view = opened({ config: REQUIRED }, { ...VALUES, da: { value: "Gå til <a>Docs</a>" } });
    view.type(searchBox(view), "zu den");
    expect(hint(view)).toBe("Required field empty in hidden locale(s): da");
  });

  it("VT11 the hint names the Locale of a hidden row with a tag error", () => {
    const view = withToolbar();
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    view.type(searchBox(view), "zu den");
    expect(hint(view)).toBe("Tags do not match the source in hidden locale(s): da");
  });

  it("VT12 the hint carries both sentences when both apply", () => {
    const view = opened({ config: REQUIRED }, { ...VALUES, da: { value: "Gå til <a>Docs</a>" } });
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    view.type(searchBox(view), "zu den");
    expect(hint(view)).toBe("Required field empty in hidden locale(s): da · Tags do not match the source in hidden locale(s): da");
  });

  it("VT13 Save is disabled while a hidden row has a tag error", () => {
    const view = withToolbar();
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    view.type(searchBox(view), "zu den");
    expect(view.button("save").disabled).toBe(true);
  });

  it("VT14 the hint is gone when the row is visible again", () => {
    const view = withToolbar();
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    view.type(searchBox(view), "zu den");
    view.type(searchBox(view), "");
    expect(hint(view)).toBeUndefined();
  });

  it("shows no hint while the row with the error is visible", () => {
    const view = withToolbar();
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    expect(hint(view)).toBeUndefined();
  });

  it("VT15 a save contains no trace of the search text", async () => {
    const view = withToolbar();
    view.type(searchBox(view), "zu den");
    view.type(view.control("de"), "Zu den neuen <a>Docs</a>");
    await view.press("save");
    expect(JSON.stringify(view.saves)).not.toContain("zu den");
  });

  it("a filter choice survives a configuration that still declares the filter", () => {
    const view = withToolbar();
    view.type(filter(view), "approved", "change");
    view.driver.setConfig({ ...TOOLBAR, locales: ["en", "da", "de", "sv"] });
    expect([filter(view).value, locales(view)]).toEqual(["approved", ["en", "de"]]);
  });

  it("a filter choice is dropped by a configuration that no longer declares the filter", () => {
    const view = withToolbar();
    view.type(filter(view), "approved", "change");
    view.driver.setConfig({ ...TOOLBAR, schema: { fields: [STATUS], toolbar: { search: true } } });
    expect(locales(view)).toEqual(["en", "da", "de"]);
  });
});
