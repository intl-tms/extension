// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CONFIG, STATUS, hiddenItem, opened, panel, usage } from "./support/view.js";

const TAGGED = { en: { value: "Go to <a>Docs</a>" }, da: { value: "Gå til <a>Docs</a>" } };

describe("panel view: repainting", () => {
  /** The Editor has typed "Udrul n" into `da`, caret after the fifth character, when values arrive. */
  const typingWhenValuesArrive = () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    const control = view.control("da");
    control.focus();
    view.type(control, "Udrul n");
    control.setSelectionRange(5, 5);
    view.driver.setValues("hero.title", { locales: { en: { value: "Deploy now" }, da: { value: "Stored" }, sv: { value: "Driftsätt" } } }, false);
    return view;
  };

  it("VR1 the typed text is still in the control", () => {
    expect(typingWhenValuesArrive().control("da").value).toBe("Udrul n");
  });

  it("VR2 focus is still in that control", () => {
    const view = typingWhenValuesArrive();
    expect(document.activeElement).toBe(view.control("da"));
  });

  it("VR3 the caret is where it was", () => {
    const control = typingWhenValuesArrive().control("da");
    expect([control.selectionStart, control.selectionEnd]).toEqual([5, 5]);
  });

  it("text typed without an input event is harvested before values are applied", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    view.control("da").value = "Udrul n";
    view.driver.setValues("hero.title", { locales: { da: { value: "Stored" } } }, false);
    expect(view.control("da").value).toBe("Udrul n");
  });

  it("VR4 a Field that was changed and not saved still shows the change when values arrive", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } }, { en: { value: "Deploy now", status: "draft" } });
    view.control<HTMLSelectElement>("en", "status").value = "approved";
    view.driver.setValues("hero.title", { locales: { en: { value: "Deploy now", status: "draft" }, da: { value: "Udrul nu" } } }, false);
    expect(view.control<HTMLSelectElement>("en", "status").value).toBe("approved");
  });

  it("VR5 nothing takes focus when values arrive and nothing in the rows had it", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    view.driver.setValues("hero.title", { locales: { da: { value: "Udrul nu" } } }, false);
    expect(document.activeElement).toBe(document.body);
  });

  it("VR6 a typed character reaches the store at once: a broken tag disables Save without Save being pressed", () => {
    const view = opened({}, TAGGED);
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    expect(view.button("save").disabled).toBe(true);
  });

  it("VR7 the control is the same element after a character is typed", () => {
    const view = opened();
    const before = view.control("da");
    view.type(before, "Udrul nu!");
    expect(view.control("da")).toBe(before);
  });

  it("VR8 the typed text is still in the control when a configuration arrives", () => {
    const view = opened();
    view.control("da").value = "Udrul n";
    view.driver.setConfig({ ...CONFIG, locales: ["en", "da", "de"] });
    expect(view.control("da").value).toBe("Udrul n");
  });

  it("a configuration that arrives adds its Locales' rows", () => {
    const view = opened();
    view.driver.setConfig({ ...CONFIG, locales: ["en", "da", "de"] });
    expect(view.rows().map((row) => row.dataset.locale)).toEqual(["en", "da", "de"]);
  });

  it("VR9 the row controls are the same elements after usages arrive", () => {
    const view = opened();
    const before = view.roles("control");
    view.driver.setUsage("hero.title", [usage("https://x.example/pricing")], false);
    expect(view.roles("control").every((control, index) => control === before[index])).toBe(true);
  });

  it("VR10 the row controls are the same elements after a Hidden list arrives", () => {
    const view = opened();
    const before = view.roles("control");
    view.driver.setHidden([hiddenItem]);
    expect(view.roles("control").every((control, index) => control === before[index])).toBe(true);
  });

  it("VR11 Cancel after an edit shows the loaded value", async () => {
    const view = opened();
    view.type(view.control("da"), "Noget andet");
    await view.press("cancel");
    expect(view.control("da").value).toBe("Udrul nu");
  });

  it("Cancel does not harvest text that never reached the store", async () => {
    const view = opened();
    view.control("da").value = "Noget andet";
    await view.press("cancel");
    expect(view.control("da").value).toBe("Udrul nu");
  });

  it("VR12 Cancel after a failed save clears the status", async () => {
    const view = opened({ answer: () => undefined });
    view.type(view.control("da"), "Noget andet");
    await view.press("save");
    await view.press("cancel");
    expect(view.status().textContent).toBe("");
  });

  it("opening another translation keeps the first key's unsaved Field edit", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [{ type: "text", name: "note" }] } } });
    view.control("en", "note").value = "check with legal";
    view.driver.open("footer.note", "en", "Footer");
    view.driver.open("hero.title", "en", "Deploy now");
    expect(view.control("en", "note").value).toBe("check with legal");
  });
});
