// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SIGN_IN } from "../src/shared/strings.js";
import { opened, panel } from "./support/view.js";

describe("panel: signing in", () => {
  it("says the Editor is not signed in, with Sign in and the help text", () => {
    const p = panel();
    p.driver.setSignIn({ state: "not-signed-in", descriptor: { session: { signIn: "https://a.example/in" }, help: "Use your company account." } });
    expect([p.role("sign-in-line")?.textContent, p.role("sign-in-help")?.textContent, p.shown(p.role("sign-in"))]).toEqual([SIGN_IN.notSignedIn, "Use your company account.", true]);
  });

  it("Sign in calls back with the address", () => {
    const p = panel();
    p.driver.setSignIn({ state: "not-signed-in", descriptor: { session: { signIn: "https://a.example/in" } } });
    p.button("sign-in-button").click();
    expect(p.callbacks.signIn).toHaveBeenCalledWith("https://a.example/in");
  });

  it("says a signed-in Editor may not edit", () => {
    const p = panel();
    p.driver.setSignIn({ state: "not-permitted", help: "Ask IT." });
    expect([p.role("sign-in-line")?.textContent, p.shown(p.role("sign-in-button"))]).toEqual([SIGN_IN.forbidden, false]);
  });

  it("help text is text, never markup", () => {
    const p = panel();
    p.driver.setSignIn({ state: "not-permitted", help: "<img src=x onerror=alert(1)>" });
    expect(p.container.querySelector("img")).toBeNull();
  });

  it("hides the line and names the Editor once accepted", () => {
    const p = panel();
    p.driver.setSignIn({ state: "not-signed-in" });
    p.driver.setSignIn({ state: "accepted", editor: "Ada Jensen" });
    expect([p.shown(p.role("sign-in")), p.role("editing-as")?.textContent]).toEqual([false, "Editing as Ada Jensen"]);
  });

  it("keeps the draft when the session ends mid-edit", () => {
    const p = opened();
    p.type(p.control("da"), "Udrul straks");
    p.driver.setSignIn({ state: "not-signed-in" });
    expect(p.control("da").value).toBe("Udrul straks");
  });
});
