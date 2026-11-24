// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TABS } from "../src/shared/strings.js";
import { opened, panel } from "./support/view.js";

type View = ReturnType<typeof panel>;

const arrow = (view: View, key: string) => view.role("tabs")?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const paneOf = (view: View, name: string) => view.container.querySelector<HTMLElement>(`#${view.tab(name).getAttribute("aria-controls")}`);

describe("panel view: the tab bar", () => {
  it("has the three sections, in the order they are worked in", () => {
    expect(panel().tabs().map((button) => button.dataset.tab)).toEqual(["translation", "page", "log"]);
  });

  it("names each one", () => {
    expect(panel().roles("tab-label").map((label) => label.textContent)).toEqual([TABS.translation, TABS.page, TABS.log]);
  });

  it("VT-T1 starts on the translation", () => {
    expect(panel().current()).toBe("translation");
  });

  it("the bar is a tablist and each button a tab", () => {
    const view = panel();
    expect([view.role("tabs")?.getAttribute("role"), view.tab("page").getAttribute("role")]).toEqual(["tablist", "tab"]);
  });

  it("says which tab is selected", () => {
    const view = panel();
    expect(view.tabs().map((button) => button.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("each tab names the pane it controls, and the pane names its tab", () => {
    const view = panel();
    const pane = paneOf(view, "page");
    expect([pane?.dataset.role, pane?.getAttribute("aria-labelledby")]).toEqual(["page", view.tab("page").id]);
  });

  it("only the current pane is on screen", () => {
    const view = panel();
    expect([view.shown(view.role("editor")), view.shown(view.role("page")), view.shown(view.role("diagnostics"))]).toEqual([true, false, false]);
  });

  it("activating a tab brings its pane on screen and takes the other away", () => {
    const view = panel();
    view.tab("page").click();
    expect([view.shown(view.role("page")), view.shown(view.role("editor"))]).toEqual([true, false]);
  });

  it("the bar is one stop in the Tab order", () => {
    const view = panel();
    view.tab("page").click();
    expect(view.tabs().map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("the right arrow moves to the next section and focuses it", () => {
    const view = panel();
    view.tab("translation").focus();
    arrow(view, "ArrowRight");
    expect([view.current(), document.activeElement]).toEqual(["page", view.tab("page")]);
  });

  it("the left arrow from the first section wraps to the last", () => {
    const view = panel();
    arrow(view, "ArrowLeft");
    expect(view.current()).toBe("log");
  });

  it("another key moves nothing", () => {
    const view = panel();
    arrow(view, "a");
    expect(view.current()).toBe("translation");
  });

  it("the Page list keeps its place while a translation is edited", () => {
    const view = opened();
    view.tab("page").click();
    view.type(view.control("da"), "Udrul straks");
    expect(view.current()).toBe("page");
  });
});
