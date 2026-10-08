// @vitest-environment jsdom
import type { PersistOutcome } from "@intl-tms/core/tools";
import { describe, expect, it } from "vitest";
import { CONFIG, PANEL, STATUS, opened, panel, settle } from "./support/view.js";

const REQUIRED = { ...CONFIG, schema: { fields: [{ ...STATUS, required: true }] } };
const TAGGED = { en: { value: "Go to <a>Docs</a>" }, da: { value: "Gå til <a>Docs</a>" } };

describe("panel view: saving", () => {
  it("offers Save all and Cancel", () => {
    const view = opened();
    expect([view.button("save").textContent, view.button("cancel").textContent]).toEqual([PANEL.save, PANEL.cancel]);
  });

  it("VS1 the callback receives only the edited Locale", async () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(Object.keys(view.saves[0]?.writes ?? {})).toEqual(["da"]);
  });

  it("the write carries the new value beside what was loaded", async () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(view.saves[0]?.writes.da).toEqual({ value: "Udrul straks", expected: { value: "Udrul nu" } });
  });

  it("VS2 the callback receives the open key", async () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(view.saves[0]?.key).toBe("hero.title");
  });

  it("text typed without an input event is harvested when Save is pressed", async () => {
    const view = opened();
    view.control("da").value = "Udrul straks";
    await view.press("save");
    expect(view.saves[0]?.writes.da?.value).toBe("Udrul straks");
  });

  it("VS3 the status shows the saved Locale's success token", async () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect([view.status().textContent, view.status().dataset.kind]).toEqual(["da ✓", "success"]);
  });

  it("VS4 the status says there are no changes when nothing was edited", async () => {
    const view = opened();
    await view.press("save");
    expect(view.status().textContent).toBe("No changes");
  });

  it("VS5 the callback is not called when nothing was edited", async () => {
    const view = opened();
    await view.press("save");
    expect(view.callbacks.save).not.toHaveBeenCalled();
  });

  describe("while a save is in flight", () => {
    const inFlight = () => {
      let finish: (outcome: PersistOutcome) => void = () => undefined;
      const view = opened({ answer: () => new Promise<PersistOutcome>((resolve) => (finish = resolve)) });
      view.type(view.control("da"), "Udrul straks");
      view.button("save").click();
      return { view, finish: () => finish({ ok: true, results: { da: { ok: true, status: 200 } } }) };
    };

    it("VS6 Save is disabled", () => {
      expect(inFlight().view.button("save").disabled).toBe(true);
    });

    it("VS7 the status already says saving", () => {
      expect(inFlight().view.status().textContent).toBe("Saving...");
    });

    it("VS8 Save is enabled when the save settles", async () => {
      const { view, finish } = inFlight();
      await settle();
      finish();
      await settle();
      expect(view.button("save").disabled).toBe(false);
    });

    it("typing during the save is kept and stays unsaved", async () => {
      const { view, finish } = inFlight();
      await settle();
      view.type(view.control("da"), "Udrul straks!");
      finish();
      await settle();
      await view.press("save");
      expect(view.saves.map((save) => save.writes.da?.value)).toEqual(["Udrul straks", "Udrul straks!"]);
    });
  });

  it("VS9 the status says connection error when the callback resolves with nothing", async () => {
    const view = opened({ answer: () => undefined });
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect([view.status().textContent, view.status().dataset.kind]).toEqual(["Connection error", "error"]);
  });

  it("VS10 the status says connection error when the callback throws", async () => {
    const view = opened({ answer: () => new Error("port closed") });
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(view.status().textContent).toBe("Connection error");
  });

  it("VS11 Save is enabled again after the callback throws", async () => {
    const view = opened({ answer: () => new Error("port closed") });
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(view.button("save").disabled).toBe(false);
  });

  it("VS12 Save with nothing selected does not call the callback", async () => {
    const view = panel();
    await view.press("save");
    expect(view.callbacks.save).not.toHaveBeenCalled();
  });

  it("a failed Locale shows its failure token with the status", async () => {
    const view = opened({ answer: () => ({ ok: false, results: { da: { ok: false, status: 500 } } }) });
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect([view.status().textContent, view.status().dataset.kind]).toEqual(["da ✗ (500)", "error"]);
  });

  it("the control keeps what was typed after a failed save", async () => {
    const view = opened({ answer: () => ({ ok: false, results: { da: { ok: false, status: 500 } } }) });
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(view.control("da").value).toBe("Udrul straks");
  });

  it("XV15 a successful status is announced politely", async () => {
    const view = opened();
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect([view.status().getAttribute("role"), view.status().getAttribute("aria-live")]).toEqual(["status", "polite"]);
  });

  it("a failed status is announced assertively", async () => {
    const view = opened({ answer: () => undefined });
    view.type(view.control("da"), "Udrul straks");
    await view.press("save");
    expect(view.status().getAttribute("aria-live")).toBe("assertive");
  });
});

describe("panel view: validation", () => {
  const missingRequired = () => opened({ config: REQUIRED }, { en: { value: "Deploy now", status: "draft" }, da: { value: "Udrul nu" } });

  it("VV1 an empty required Field is labelled Required", () => {
    const view = missingRequired();
    const marker = view.within("da", "required", "status");
    expect([view.shown(marker), marker?.textContent]).toEqual([true, PANEL.required]);
  });

  it("a filled required Field is not labelled", () => {
    const view = missingRequired();
    expect(view.shown(view.within("en", "required", "status"))).toBe(false);
  });

  it("marks the empty required Field's control invalid", () => {
    expect(missingRequired().control("da", "status").getAttribute("aria-invalid")).toBe("true");
  });

  it("VV2 Save is disabled while a required Field is empty", () => {
    expect(missingRequired().button("save").disabled).toBe(true);
  });

  it("VV3 a save attempted anyway does not call the callback", async () => {
    const view = missingRequired();
    view.type(view.control("en"), "Deploy today");
    view.button("save").disabled = false;
    await view.press("save");
    expect(view.callbacks.save).not.toHaveBeenCalled();
  });

  it("VV4 the status then says to fill required fields", async () => {
    const view = missingRequired();
    view.type(view.control("en"), "Deploy today");
    view.button("save").disabled = false;
    await view.press("save");
    expect([view.status().textContent, view.status().dataset.kind]).toEqual(["Fill required fields", "error"]);
  });

  it("choosing a value for the required Field enables Save", () => {
    const view = missingRequired();
    view.type(view.control<HTMLSelectElement>("da", "status"), "draft", "change");
    expect([view.button("save").disabled, view.shown(view.within("da", "required", "status"))]).toEqual([false, false]);
  });

  const renamedTag = () => {
    const view = opened({}, TAGGED);
    view.control("da").focus();
    view.type(view.control("da"), "Gå til <b>Docs</b>");
    return view;
  };

  it("VV5 the reason beside the control names the renamed tag", () => {
    const view = renamedTag();
    const reason = view.within("da", "tag-error");
    expect([view.shown(reason), reason?.textContent]).toEqual([true, "Tags must match the source: unknown <b>; missing <a>"]);
  });

  it("VV6 the control is marked invalid", () => {
    expect(renamedTag().control("da").getAttribute("aria-invalid")).toBe("true");
  });

  it("XV16 the inline error is associated with its control", () => {
    const view = renamedTag();
    expect(view.control("da").getAttribute("aria-describedby")?.split(" ")).toContain(view.within("da", "tag-error")?.id);
  });

  it("VV7 Save is disabled", () => {
    expect(renamedTag().button("save").disabled).toBe(true);
  });

  it("VV8 a save attempted anyway does not call the callback", async () => {
    const view = renamedTag();
    view.button("save").disabled = false;
    await view.press("save");
    expect(view.callbacks.save).not.toHaveBeenCalled();
  });

  it("VV9 the status then says tags must match", async () => {
    const view = renamedTag();
    view.button("save").disabled = false;
    await view.press("save");
    expect(view.status().textContent).toBe("Tags must match the source");
  });

  it("VV10 Save is enabled once the tag is typed back", () => {
    const view = renamedTag();
    view.type(view.control("da"), "Gå hen til <a>Docs</a>");
    expect(view.button("save").disabled).toBe(false);
  });

  it("VV11 the inline reason is gone once the tag is typed back", () => {
    const view = renamedTag();
    view.type(view.control("da"), "Gå hen til <a>Docs</a>");
    expect([view.shown(view.within("da", "tag-error")), view.control("da").hasAttribute("aria-invalid")]).toEqual([false, false]);
  });

  it("VV12 focus is still in the control once the tag is typed back", () => {
    const view = renamedTag();
    const control = view.control("da");
    view.type(control, "Gå hen til <a>Docs</a>");
    expect(document.activeElement).toBe(control);
  });

  it("VV13 a draft reworded with its tags intact is saved", async () => {
    const view = opened({}, TAGGED);
    view.type(view.control("da"), "Gå hen til <a>Docs</a>");
    await view.press("save");
    expect(view.saves[0]?.writes.da?.value).toBe("Gå hen til <a>Docs</a>");
  });

  it("a tag error has no element until there is a value control to sit beside", () => {
    expect(opened().within("da", "tag-error")?.hidden).toBe(true);
  });
});
