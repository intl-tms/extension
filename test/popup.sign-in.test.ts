// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountPopup, type PopupPorts } from "../src/popup/view.js";
import { SIGN_IN } from "../src/shared/strings.js";
import { STORAGE } from "../src/shared/storage.js";

const A = "https://a.example";

async function popup(status: unknown) {
  const opened: string[] = [];
  let listener: ((status: unknown) => void) | undefined;
  const ports: PopupPorts = {
    activeTabUrl: async () => `${A}/pricing`,
    readSettings: async () => ({ [STORAGE.sites]: [A], [STORAGE.configUrl]: `${A}/api/tms/config` }),
    writeSettings: () => Promise.resolve(),
    isGranted: async () => true,
    requestAccess: () => Promise.resolve(true),
    tabStatus: async () => status,
    onTabStatus: (changed) => {
      listener = changed;
    },
    openTab: (url) => void opened.push(url),
  };
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  await mountPopup({ container, ports });
  const text = (role: string) => {
    const element = container.querySelector<HTMLElement>(`[data-role=${role}]`);
    return element === null || element.closest("[hidden]") !== null ? undefined : element.textContent;
  };
  const signInButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent === SIGN_IN.signIn && !b.hidden && !b.closest("[hidden]"));
  return { container, opened, text, signInButton, change: (next: unknown) => listener?.(next) };
}

const notSignedIn = { signIn: { state: "not-signed-in", descriptor: { session: { signIn: `${A}/editors/sign-in` }, help: "Use your company account." } } };

describe("the Popup's sign-in line", () => {
  it("says the Editor is not signed in", async () => {
    expect((await popup(notSignedIn)).text("sign-in-line")).toBe(SIGN_IN.notSignedIn);
  });

  it("shows the website's help text under the line, as text", async () => {
    expect((await popup(notSignedIn)).text("sign-in-help")).toBe("Use your company account.");
  });

  it("Sign in opens the sign-in address in a new tab", async () => {
    const { signInButton, opened } = await popup(notSignedIn);
    signInButton()!.click();
    expect(opened).toEqual([`${A}/editors/sign-in`]);
  });

  it("a stored sign-in address that is not a web address offers no Sign in", async () => {
    const { signInButton } = await popup({ signIn: { state: "not-signed-in", descriptor: { session: { signIn: "javascript:alert(1)" } } } });
    expect(signInButton()).toBeUndefined();
  });

  it("help text with markup is shown as text", async () => {
    const { container } = await popup({ signIn: { state: "not-permitted", help: "<b>Ask IT</b>" } });
    expect(container.querySelector("b")).toBeNull();
  });

  it("says a signed-in Editor without permission may not edit", async () => {
    expect((await popup({ signIn: { state: "not-permitted" } })).text("sign-in-line")).toBe(SIGN_IN.forbidden);
  });

  it("shows nothing about signing in while the website accepts the Editor", async () => {
    expect((await popup({ signIn: { state: "accepted" } })).text("sign-in-line")).toBeUndefined();
  });

  it("names the Editor the website named", async () => {
    expect((await popup({ signIn: { state: "accepted", editor: "Ada Jensen" } })).text("editing-as")).toBe("Editing as Ada Jensen");
  });

  it("shows nothing for a tab with no status", async () => {
    const { text } = await popup(undefined);
    expect([text("sign-in-line"), text("editing-as")]).toEqual([undefined, undefined]);
  });

  it("follows a status that changes while it is open", async () => {
    const { text, change } = await popup(notSignedIn);
    change({ signIn: { state: "accepted", editor: "Ada Jensen" } });
    expect([text("sign-in-line"), text("editing-as")]).toEqual([undefined, "Editing as Ada Jensen"]);
  });
});
