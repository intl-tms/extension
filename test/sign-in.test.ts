import { describe, expect, it } from "vitest";
import { editingAs, readSignInStatus } from "../src/shared/sign-in.js";


const descriptor = { session: { signIn: "https://app.test/editors/sign-in" }, help: "Sign in with your company account." };
describe("editing as", () => {
  it("names the Editor the website named", () => {
    expect(editingAs({ state: "accepted", editor: "Ada Jensen" })).toBe("Editing as Ada Jensen");
  });

  it("says nothing without a name", () => {
    expect(editingAs({ state: "accepted" })).toBeUndefined();
  });

  it("says nothing when not accepted", () => {
    expect(editingAs({ state: "not-signed-in" })).toBeUndefined();
  });
});

describe("reading a stored or relayed sign-in status", () => {
  it("keeps a valid status", () => {
    expect(readSignInStatus({ state: "not-signed-in", descriptor })).toEqual({ state: "not-signed-in", descriptor });
  });

  it.each([undefined, null, "x", {}, { state: "other" }])("%j is no status", (value) => {
    expect(readSignInStatus(value)).toBeUndefined();
  });

  it("drops a sign-in address that is not a web address", () => {
    expect(readSignInStatus({ state: "not-signed-in", descriptor: { session: { signIn: "javascript:alert(1)" } } })).toEqual({ state: "not-signed-in", descriptor: {} });
  });

  it("drops a help text from a stored status", () => {
    expect(readSignInStatus({ state: "not-permitted", help: "Ask IT." })).toEqual({ state: "not-permitted" });
  });

  it("drops an Editor name that is not one short line of text", () => {
    expect(readSignInStatus({ state: "accepted", editor: "a\nb" })).toEqual({ state: "accepted" });
  });

  it("keeps an Editor name", () => {
    expect(readSignInStatus({ state: "accepted", editor: "Lin" })).toEqual({ state: "accepted", editor: "Lin" });
  });
});
