// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PAGE, TABS } from "../src/shared/strings.js";
import { PANEL, hiddenItem, opened, panel, textMarker } from "./support/view.js";

type View = ReturnType<typeof panel>;

const MARKERS = [
  { id: "t1", key: "hero.title", value: "Deploy now" },
  { id: "t2", key: "shared.actions.pay", value: "Continue to payment" },
  hiddenItem,
];

/** A panel on the Page tab, with a scanned page behind it. */
function listed(items: readonly { id: string; key: string; value: string; attribute?: string }[] = MARKERS, url = "https://x.example/checkout") {
  const view = panel();
  view.driver.setMarkers([...items], url);
  view.tab("page").click();
  return view;
}

const keys = (view: View) => view.pageItems().map((row) => row.dataset.key);
const texts = (view: View) => view.pageItems().map((row) => row.querySelector('[data-role="page-text"]')?.textContent);
const groups = (view: View) => view.roles("page-group-name").map((head) => head.textContent);
const scope = (view: View, name: string) => view.roles<HTMLButtonElement>("page-scope").find((button) => button.dataset.scope === name)!;

describe("panel view: the Page tab", () => {
  it("is reached from a tab named Page", () => {
    expect(panel().tab("page").querySelector('[data-role="tab-label"]')?.textContent).toBe(TABS.page);
  });

  it("the tab counts what the page is holding", () => {
    const view = listed();
    expect(view.role("tab-count")?.textContent).toBe("3");
  });

  it("the tab carries no count before a scan is reported", () => {
    const view = panel();
    expect(view.shown(view.role("tab-count"))).toBe(false);
  });

  it("is not on screen until its tab is activated", () => {
    const view = panel();
    view.driver.setMarkers([...MARKERS], "https://x.example/checkout");
    expect([view.shown(view.role("page")), view.current()]).toEqual([false, "translation"]);
  });

  it("names the address being edited", () => {
    expect(listed().role("page-url")?.textContent).toBe("https://x.example/checkout");
  });

  it("says nothing about an address it was not given", () => {
    const view = panel();
    view.driver.setMarkers([...MARKERS], undefined);
    view.tab("page").click();
    expect(view.shown(view.role("page-url"))).toBe(false);
  });

  it("has one row per Marker, in the order the page holds them", () => {
    expect(keys(listed())).toEqual(["hero.title", "shared.actions.pay", "icon.close"]);
  });

  it("a row shows the text that is on the page", () => {
    expect(texts(listed())).toEqual(["Deploy now", "Continue to payment", "Close"]);
  });

  it("a row shows its key", () => {
    expect(listed().pageItems()[0]?.querySelector('[data-role="page-key"]')?.textContent).toBe("hero.title");
  });

  it("a row whose text is empty on the page shows a dash", () => {
    expect(texts(listed([{ id: "t1", key: "hero.title", value: "" }]))).toEqual([PANEL.emptyValue]);
  });

  it("a Shared key says so", () => {
    const marks = listed().pageItems().map((row) => row.querySelector('[data-role="page-shared"]')?.textContent);
    expect(marks).toEqual([undefined, PANEL.sharedBadge, undefined]);
  });

  it("a translation that lives in an attribute names the attribute", () => {
    expect(listed().pageItems()[2]?.querySelector('[data-role="page-attribute"]')?.textContent).toBe("aria-label");
  });

  it("the visible translations and the rest are two groups, visible first", () => {
    expect(groups(listed())).toEqual([PAGE.groupVisible, PAGE.groupHidden]);
  });

  it("each group counts itself", () => {
    expect(listed().roles("page-group-count").map((count) => count.textContent)).toEqual(["2", "1"]);
  });

  it("a page with nothing in an attribute has only the one group", () => {
    expect(groups(listed([textMarker]))).toEqual([PAGE.groupVisible]);
  });

  it("the row of the open key is marked as the current one", () => {
    const view = opened();
    view.driver.setMarkers([...MARKERS], "https://x.example/checkout");
    view.tab("page").click();
    expect(view.pageItems().map((row) => row.dataset.current)).toEqual(["true", "false", "false"]);
  });

  it("a row is a button", () => {
    expect(listed().pageItems()[0]?.tagName).toBe("BUTTON");
  });

  it("pointing at a row asks the page to find it", () => {
    const view = listed();
    view.pageItems()[0]?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(view.callbacks.flash).toHaveBeenCalledWith("t1");
  });

  it("activating a row opens that Marker", () => {
    const view = listed();
    view.pageItems()[2]?.click();
    expect(view.callbacks.openMarker).toHaveBeenCalledWith("a1:aria-label");
  });

  it("a translation opened on the page brings the Translation tab forward", () => {
    const view = listed();
    view.driver.open("hero.title", "en", "Deploy now");
    expect(view.current()).toBe("translation");
  });

  it("says so when the page has nothing marked", () => {
    const view = listed([]);
    expect([view.role("page-state")?.textContent, view.pageItems()]).toEqual([PAGE.none, []]);
  });

  it("stands in with the Hidden list until a scan is reported", () => {
    const view = panel();
    view.driver.setHidden([hiddenItem]);
    view.tab("page").click();
    expect(keys(view)).toEqual(["icon.close"]);
  });
});

describe("panel view: narrowing the Page tab", () => {
  it("search matches the text on the page", () => {
    const view = listed();
    view.type(view.role<HTMLInputElement>("page-search")!, "payment");
    expect(keys(view)).toEqual(["shared.actions.pay"]);
  });

  it("search matches a key", () => {
    const view = listed();
    view.type(view.role<HTMLInputElement>("page-search")!, "icon.");
    expect(keys(view)).toEqual(["icon.close"]);
  });

  it("says so when the search matches nothing", () => {
    const view = listed();
    view.type(view.role<HTMLInputElement>("page-search")!, "zzz");
    expect([view.role("page-state")?.textContent, view.pageItems()]).toEqual([PAGE.noMatch, []]);
  });

  it("the order can be by key instead of by the page", () => {
    const view = listed();
    view.type(view.role<HTMLSelectElement>("page-sort")!, "key", "change");
    expect(keys(view)).toEqual(["hero.title", "shared.actions.pay", "icon.close"]);
  });

  it("All is the scope a fresh panel is on", () => {
    expect(scope(listed(), "all").getAttribute("aria-pressed")).toBe("true");
  });

  it("nothing is unsaved until something is typed", () => {
    const view = listed();
    expect([scope(view, "unsaved").textContent, view.shown(view.role("page-unsaved"))]).toEqual([PAGE.scopeUnsaved(0), false]);
  });

  it("a key with an unsaved draft is counted, marked and pilled", () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    view.driver.setMarkers([...MARKERS], "https://x.example/checkout");
    view.tab("page").click();
    expect([
      view.role("page-unsaved")?.textContent,
      scope(view, "unsaved").textContent,
      view.pageItems().map((row) => row.querySelector('[data-role="page-dot"]') !== null),
    ]).toEqual([PAGE.unsaved(1), PAGE.scopeUnsaved(1), [true, false, false]]);
  });

  it("the Unsaved scope keeps only the keys with drafts", () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    view.driver.setMarkers([...MARKERS], "https://x.example/checkout");
    view.tab("page").click();
    scope(view, "unsaved").click();
    expect(keys(view)).toEqual(["hero.title"]);
  });

  it("XH2 a value containing markup is rendered literally", () => {
    const view = listed([{ id: "t1", key: "hero.title", value: "<img src=x onerror=alert(1)>" }]);
    expect([view.role("page")?.querySelector("img"), texts(view)]).toEqual([null, ["<img src=x onerror=alert(1)>"]]);
  });
});
