// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { opened, panel } from "./support/view.js";

describe("panel: signing in", () => {
  it.each([
    { state: "not-signed-in", descriptor: { credentials: true, help: "Use your company account." } },
    { state: "not-signed-in" },
    { state: "not-permitted", help: "Ask IT." },
  ])("says nothing and offers no way to sign in: %j", (status) => {
    const p = panel();
    p.driver.setSignIn(status as never);
    expect([...p.container.querySelectorAll("[data-role^=sign-in]")]).toEqual([]);
    expect(p.container.textContent).not.toMatch(/sign|Ask IT|company account/i);
  });

  it("names the Editor once accepted", () => {
    const p = panel();
    p.driver.setSignIn({ state: "not-signed-in" });
    p.driver.setSignIn({ state: "accepted", editor: "Ada Jensen" });
    expect(p.role("editing-as")?.textContent).toBe("Editing as Ada Jensen");
  });

  it("keeps the draft when the session ends mid-edit", () => {
    const p = opened();
    p.type(p.control("da"), "Udrul straks");
    p.driver.setSignIn({ state: "not-signed-in" });
    expect(p.control("da").value).toBe("Udrul straks");
  });
});
