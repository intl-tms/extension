import { describe, expect, it } from "vitest";
import { editingAs, readSignInStatus, signInLine } from "../src/shared/sign-in.js";
import { SIGN_IN } from "../src/shared/strings.js";

const descriptor = { session: { signIn: "https://app.test/editors/sign-in" }, help: "Sign in with your company account." };

describe("the sign-in line", () => {
  it("a website that accepts a session: not signed in, with Sign in and the help text", () => {
    expect(signInLine({ state: "not-signed-in", descriptor })).toEqual({ text: SIGN_IN.notSignedIn, signIn: descriptor.session.signIn, help: descriptor.help });
  });

  it("a 401 with no descriptor: the website refused, with no action", () => {
    expect(signInLine({ state: "not-signed-in" })).toEqual({ text: SIGN_IN.refused });
  });

  it("a 401 whose descriptor names no way: the website refused, still with its help text", () => {
    expect(signInLine({ state: "not-signed-in", descriptor: { help: "Ask IT." } })).toEqual({ text: SIGN_IN.refused, help: "Ask IT." });
  });

  it("a 403: signed in but may not edit, with the help text", () => {
    expect(signInLine({ state: "not-permitted", help: "Ask IT for the Editor role." })).toEqual({ text: SIGN_IN.forbidden, help: "Ask IT for the Editor role." });
  });

  it("accepted has no line", () => {
    expect(signInLine({ state: "accepted" })).toBeUndefined();
  });

  it("no status has no line", () => {
    expect(signInLine(undefined)).toBeUndefined();
  });

  it("the texts are the specified ones", () => {
    expect([SIGN_IN.notSignedIn, SIGN_IN.refused, SIGN_IN.forbidden, SIGN_IN.signIn]).toEqual([
      "You are not signed in to this website.",
      "This website refused the request.",
      "You are signed in, but may not edit translations here. Ask whoever manages your access to this website.",
      "Sign in",
    ]);
  });
});

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

  it("drops a help text that is too long", () => {
    expect(readSignInStatus({ state: "not-permitted", help: "x".repeat(201) })).toEqual({ state: "not-permitted" });
  });

  it("drops an Editor name that is not one short line of text", () => {
    expect(readSignInStatus({ state: "accepted", editor: "a\nb" })).toEqual({ state: "accepted" });
  });

  it("keeps an Editor name", () => {
    expect(readSignInStatus({ state: "accepted", editor: "Lin" })).toEqual({ state: "accepted", editor: "Lin" });
  });
});
