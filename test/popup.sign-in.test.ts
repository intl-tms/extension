// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountPopup, type PopupPorts } from "../src/popup/view.js";
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
  };
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  await mountPopup({ container, ports });
  const text = (role: string) => {
    const element = container.querySelector<HTMLElement>(`[data-role=${role}]`);
    return element === null || element.closest("[hidden]") !== null ? undefined : element.textContent;
  };
  return { container, opened, text, change: (next: unknown) => listener?.(next) };
}

const refused = [
  { signIn: { state: "not-signed-in", descriptor: { session: { signIn: `${A}/editors/sign-in` }, help: "Use your company account." } } },
  { signIn: { state: "not-signed-in" } },
  { signIn: { state: "not-permitted", help: "Ask IT for the Editor role." } },
];

describe("the Popup and signing in", () => {
  it.each(refused)("says nothing about a refused Editor and offers no way to sign in: %j", async (status) => {
    const { container, opened } = await popup(status);
    expect([container.querySelector("button")?.textContent, container.textContent]).not.toEqual([expect.stringContaining("Sign in"), expect.anything()]);
    expect(container.textContent).not.toMatch(/sign|Ask IT|company account/i);
    expect([...container.querySelectorAll("[data-role^=sign-in]")]).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("names the Editor the website named", async () => {
    expect((await popup({ signIn: { state: "accepted", editor: "Ada Jensen" } })).text("editing-as")).toBe("Editing as Ada Jensen");
  });

  it("shows nothing for a tab with no status", async () => {
    expect((await popup(undefined)).text("editing-as")).toBeUndefined();
  });

  it("follows a status that changes while it is open", async () => {
    const { text, change } = await popup(refused[0]);
    change({ signIn: { state: "accepted", editor: "Ada Jensen" } });
    expect(text("editing-as")).toBe("Editing as Ada Jensen");
  });
});
