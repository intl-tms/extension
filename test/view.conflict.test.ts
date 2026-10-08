// @vitest-environment jsdom
import type { PanelWrite, PersistOutcome } from "@intl-tms/core/tools";
import { describe, expect, it } from "vitest";
import { CONFIG, STATUS, opened } from "./support/view.js";

const SCHEMA = { ...CONFIG, schema: { fields: [STATUS, { type: "text" as const, name: "note" }, { type: "readonly" as const, name: "audit" }] } };
const LOADED = { en: { value: "Deploy now", status: "draft", note: "ok" }, da: { value: "Udrul nu" } };
const STORED = { value: "Ship it", status: "approved", note: "ok" };

/**
 * `hero.title` is open with values loaded for `en` (value and a `status` Select). The Editor types
 * a new `en` value and saves. The reply refuses `en` as a conflict and carries the stored row, in
 * which both the value and `status` differ from what was loaded.
 */
async function conflict(later: (writes: Record<string, PanelWrite>) => PersistOutcome | undefined = (writes) => ({
  ok: true,
  results: Object.fromEntries(Object.keys(writes).map((locale) => [locale, { ok: true, status: 200 }])),
})) {
  let first = true;
  const view = opened(
    {
      config: SCHEMA,
      answer: (_key, writes) => {
        if (!first) return later(writes);
        first = false;
        return { ok: false, results: { en: { ok: false, status: 409, failure: "conflict", current: STORED } } };
      },
    },
    LOADED,
  );
  view.type(view.control("en"), "Deploy today");
  await view.press("save");
  return view;
}

describe("panel view: a Write conflict", () => {
  it("VC1 the stored value is shown under the value control", async () => {
    const view = await conflict();
    const notice = view.within("en", "conflict", "value");
    expect([view.shown(notice), notice?.textContent]).toEqual([true, "Changed since you opened it. Stored now: Ship it"]);
  });

  it("VC2 the control still holds what the Editor typed", async () => {
    expect((await conflict()).control("en").value).toBe("Deploy today");
  });

  it("VC3 status, which the Editor had not touched, shows the stored option", async () => {
    expect((await conflict()).control<HTMLSelectElement>("en", "status").value).toBe("approved");
  });

  it("VC4 no notice is shown under a column that did not conflict", async () => {
    const view = await conflict();
    expect([view.shown(view.within("en", "conflict", "status")), view.shown(view.within("en", "conflict", "note"))]).toEqual([false, false]);
  });

  it("VC5 a conflicting Select's notice shows the stored option's label", async () => {
    let first = true;
    const view = opened(
      {
        config: SCHEMA,
        answer: (): PersistOutcome => {
          if (!first) return { ok: true, results: {} };
          first = false;
          return { ok: false, results: { en: { ok: false, status: 409, failure: "conflict", current: { value: "Deploy now", status: "approved" } } } };
        },
      },
      { en: { value: "Deploy now" }, da: { value: "Udrul nu" } },
    );
    view.type(view.control<HTMLSelectElement>("en", "status"), "draft", "change");
    await view.press("save");
    expect(view.within("en", "conflict", "status")?.textContent).toBe("Changed since you opened it. Stored now: Approved");
  });

  it("VC6 the status says the Locale changed elsewhere", async () => {
    expect((await conflict()).status().textContent).toBe("en ⚠ changed elsewhere");
  });

  it("VC7 Diagnostics stays closed", async () => {
    expect((await conflict()).diagnostics().open).toBe(false);
  });

  it("VC8 the log records a refusal, not a failure", async () => {
    const text = (await conflict()).log.text();
    expect([text.includes("refused: changed elsewhere"), text.includes("FAILED")]).toEqual([true, false]);
  });

  it("VC9 the notice is hidden once the draft is typed back to the stored value", async () => {
    const view = await conflict();
    view.type(view.control("en"), "Ship it");
    expect(view.shown(view.within("en", "conflict", "value"))).toBe(false);
  });

  it("VC10 saving again expects the stored value", async () => {
    const view = await conflict();
    await view.press("save");
    expect(view.saves[1]?.writes.en?.expected).toEqual({ value: "Ship it" });
  });

  it("VC11 saving again leaves the untouched column out of the write", async () => {
    const view = await conflict();
    await view.press("save");
    expect(view.saves[1]?.writes.en).toEqual({ value: "Deploy today", expected: { value: "Ship it" } });
  });

  it("VC12 the notice is hidden once saving again succeeds", async () => {
    const view = await conflict();
    await view.press("save");
    expect([view.shown(view.within("en", "conflict", "value")), view.status().textContent]).toEqual([false, "en ✓"]);
  });

  it("VC13 Cancel shows the stored value", async () => {
    const view = await conflict();
    await view.press("cancel");
    expect(view.control("en").value).toBe("Ship it");
  });

  it("VC14 Cancel hides the notice", async () => {
    const view = await conflict();
    await view.press("cancel");
    expect(view.shown(view.within("en", "conflict", "value"))).toBe(false);
  });

  it("VC15 a read-only Field has no conflict element", async () => {
    expect((await conflict()).within("en", "conflict", "audit")).toBeUndefined();
  });

  it("the conflict notice is associated with its control", async () => {
    const view = await conflict();
    expect(view.control("en").getAttribute("aria-describedby")?.split(" ")).toContain(view.within("en", "conflict", "value")?.id);
  });
});
