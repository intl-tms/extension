// @vitest-environment jsdom
import { SHARED_NOTICE } from "@intl-tms/core/tools";
import { describe, expect, it } from "vitest";
import { CONFIG, PANEL, STATUS, opened, panel } from "./support/view.js";

describe("panel view: basics", () => {
  it("VB1 shows the placeholder when nothing is selected", () => {
    const view = panel();
    expect([view.shown(view.role("placeholder")), view.role("placeholder")?.textContent]).toEqual([true, PANEL.placeholder]);
  });

  it("VB2 does not show the editor when nothing is selected", () => {
    const view = panel();
    expect(view.shown(view.role("selection"))).toBe(false);
  });

  it("hides the placeholder once something is selected", () => {
    const view = opened();
    expect(view.shown(view.role("placeholder"))).toBe(false);
  });

  it("VB3 renders inside the container it is given", () => {
    const view = panel();
    expect(view.container.querySelector("h1")?.textContent).toBe("Intl TMS");
  });

  it("VB4 has one value control per Locale", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    expect(view.roles("control").map((control) => control.dataset.locale)).toEqual(["en", "da"]);
  });

  it("VB5 the Current Locale's control holds the on-page value", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    expect(view.control("da").value).toBe("Udrul nu");
  });

  it("puts the Current Locale's row first", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    expect(view.rows().map((row) => row.dataset.locale)).toEqual(["da", "en"]);
  });

  it("VB6 marks the Current Locale's row current", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    expect(view.rows().map((row) => row.dataset.current)).toEqual(["true", "false"]);
  });

  it("gives the Current Locale's row a text cue as well as a colour", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    expect(view.row("da")?.textContent).toContain(PANEL.currentLocale);
  });

  it("each row shows its Locale code", () => {
    const view = opened();
    expect(view.within("da", "locale")?.textContent).toBe("da");
  });

  it("VB7 shows the key", () => {
    const view = opened();
    expect(view.role("key")?.textContent).toBe("hero.title");
  });

  it("VB8 the title is the source message when the key has one", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    view.driver.setValues("hero.title", { locales: {}, meta: { sourceMessage: "Deploy now" } }, false);
    expect([view.shown(view.role("title")), view.role("title")?.textContent]).toEqual([true, "Deploy now"]);
  });

  it("VB9 the key is still shown beneath the source message", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    view.driver.setValues("hero.title", { locales: {}, meta: { sourceMessage: "Deploy now" } }, false);
    expect([view.shown(view.role("key")), view.role("key")?.textContent]).toEqual([true, "hero.title"]);
  });

  it("VB10 the title row is not shown without metadata", () => {
    const view = opened();
    expect(view.shown(view.role("title"))).toBe(false);
  });

  it("VB11 shows the badge for a Shared key", () => {
    const view = panel();
    view.driver.open("shared.save", "en", "Save");
    expect([view.shown(view.role("shared-badge")), view.role("shared-badge")?.textContent]).toEqual([true, PANEL.sharedBadge]);
  });

  it("VB12 shows the notice for a Shared key", () => {
    const view = panel();
    view.driver.open("shared.save", "en", "Save");
    expect(view.role("shared-notice")?.textContent).toBe(SHARED_NOTICE);
  });

  it("VB13 shows neither for any other key", () => {
    const view = opened();
    expect(view.shown(view.role("shared-badge"))).toBe(false);
  });

  it("VB14 the Source Locale's control holds the source message when it has no stored row", () => {
    const view = panel();
    view.driver.open("hero.title", "da", "Udrul nu");
    view.driver.setValues("hero.title", { locales: {}, meta: { sourceMessage: "Deploy now" } }, false);
    expect(view.control("en").value).toBe("Deploy now");
  });

  it("VB15 fills the other Locales' controls when values arrive", () => {
    const view = opened();
    expect(view.control("da").value).toBe("Udrul nu");
  });

  it("VB16 values for another key change nothing on screen", () => {
    const view = opened();
    const before = view.container.innerHTML;
    view.driver.setValues("another.key", { locales: { da: { value: "Noget andet" } } }, false);
    expect(view.container.innerHTML).toBe(before);
  });

  it("VB17 the status is an error when values fail to load", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "Deploy now");
    view.driver.setValues("hero.title", { locales: {} }, true);
    expect([view.status().textContent, view.status().dataset.kind]).toEqual(["Could not load other locales", "error"]);
  });

  it("VB18 a Locale present only in the loaded values has a row", () => {
    const view = opened({}, { en: { value: "Deploy now" }, sv: { value: "Driftsätt nu" } });
    expect(view.control("sv").value).toBe("Driftsätt nu");
  });

  it("VB19 a Locale with no stored row has empty, editable controls", () => {
    const view = opened({}, { en: { value: "Deploy now" } });
    expect([view.control("da").value, view.control("da").disabled, view.control("da").readOnly]).toEqual(["", false, false]);
  });

  it("VB20 the value control is multi-line when the Schema says so", () => {
    const view = opened({ config: { ...CONFIG, schema: { valueField: { type: "textarea" } } } });
    expect([view.control("en").tagName, view.control<HTMLTextAreaElement>("en").rows]).toEqual(["TEXTAREA", 2]);
  });

  it("VB21 the value control is single-line with no Schema", () => {
    const view = opened();
    expect(view.control("en").tagName).toBe("INPUT");
  });

  it("VB22 a Select Field's first option is the empty Select…", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    const first = view.control<HTMLSelectElement>("en", "status").options[0];
    expect([first?.value, first?.textContent]).toEqual(["", PANEL.selectNone]);
  });

  it("lists a Select Field's declared options after the empty one", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    expect([...view.control<HTMLSelectElement>("en", "status").options].map((option) => option.textContent)).toEqual([PANEL.selectNone, "Draft", "Approved"]);
  });

  it("VB23 a Select Field shows the stored option as selected", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } }, { en: { value: "Deploy now", status: "approved" } });
    expect(view.control<HTMLSelectElement>("en", "status").value).toBe("approved");
  });

  it("a Select Field keeps a stored value that is not one of its options", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } }, { en: { value: "Deploy now", status: "legacy" } });
    expect(view.control<HTMLSelectElement>("en", "status").value).toBe("legacy");
  });

  it("a Field with a label shows it", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    expect(view.within("en", "field-label")?.textContent).toBe("Status");
  });

  it("VB24 a Field with no label shows its name", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [{ type: "text", name: "note" }] } } });
    expect(view.within("en", "field-label")?.textContent).toBe("note");
  });

  it("a multi-line Field is a multi-line control", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [{ type: "textarea", name: "note" }] } } });
    expect(view.control("en", "note").tagName).toBe("TEXTAREA");
  });

  it("VB25 a read-only Field holding an object is shown as JSON", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [{ type: "readonly", name: "audit" }] } } }, { en: { value: "Deploy now", audit: { by: "ada" } } });
    expect(view.within("en", "readonly")?.textContent).toBe('{"by":"ada"}');
  });

  it("VB26 a read-only Field has no control", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [{ type: "readonly", name: "audit" }] } } });
    expect(view.control("en", "audit")).toBeUndefined();
  });

  it("VB27 a key containing markup characters is shown literally", () => {
    const view = panel();
    view.driver.open("a<b>bold</b>", "en", "x");
    expect([view.role("key")?.textContent, view.role("key")?.querySelector("b")]).toEqual(["a<b>bold</b>", null]);
  });

  it("VB28 a value containing a script element creates no element", () => {
    const view = panel();
    view.driver.open("hero.title", "en", "<script>window.pwned = true</script><img src=x onerror=alert(1)>");
    view.driver.setValues("hero.title", { locales: {}, meta: { sourceMessage: "<script>1</script>" } }, false);
    expect(view.container.querySelectorAll("script, img")).toHaveLength(0);
  });

  it("VB29 a control for a Locale code containing quote and bracket is still found and refocused", () => {
    const hostile = 'x"]';
    const view = panel({ config: { locales: ["en", hostile] } });
    view.driver.open("hero.title", "en", "Deploy now");
    view.control(hostile).focus();
    view.driver.setValues("hero.title", { locales: { [hostile]: { value: "stored" } } }, false);
    expect([document.activeElement === view.control(hostile), view.control(hostile).value]).toEqual([true, "stored"]);
  });

  describe("opening in a Locale that is not configured", () => {
    const unconfigured = () => {
      const view = panel();
      view.driver.open("hero.title", "sv", "Driftsätt nu");
      return view;
    };

    it("VB30 logs a failure naming the page's language and the configured list", () => {
      expect(unconfigured().log.text()).toContain('the page says lang="sv", which is not one of the configured languages [en, da]');
    });

    it("the failure carries its remedy", () => {
      expect(unconfigured().log.text()).toContain("Set the page's language to a configured one, or add this one to the configured languages.");
    });

    it("VB31 opens Diagnostics", () => {
      expect(unconfigured().diagnostics().open).toBe(true);
    });
  });

  it("VB32 Diagnostics stays closed when it opens in a configured Locale", () => {
    expect(opened().diagnostics().open).toBe(false);
  });

  it("VB33 says nothing about the Locale before any configuration arrived", () => {
    const view = panel({ config: false });
    view.driver.open("hero.title", "sv", "Driftsätt nu");
    expect([view.diagnostics().open, view.log.text().includes("lang=")]).toEqual([false, false]);
  });

  it("VB34 a value control's accessible name includes its Locale", () => {
    expect(opened().control("da").getAttribute("aria-label")).toBe("da translation");
  });

  it("a Field control's accessible name includes its Locale and its label", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    expect(view.control("da", "status").getAttribute("aria-label")).toBe("da Status");
  });

  it("every editable control carries its Locale and column as data", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    expect(view.roles("control").map((control) => `${control.dataset.locale}/${control.dataset.column}`)).toEqual(["en/value", "en/status", "da/value", "da/status"]);
  });

  it("generates no styles in script", () => {
    const view = opened({ config: { ...CONFIG, schema: { fields: [STATUS] } } });
    expect(view.container.querySelectorAll("style, [style]")).toHaveLength(0);
  });
});
