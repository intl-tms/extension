// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { mountPopup, type PopupPorts } from "../src/popup/view.js";
import { POPUP } from "../src/shared/strings.js";
import { STORAGE } from "../src/shared/storage.js";

const A = "https://a.example";

interface Setup {
  url?: string | undefined;
  sites?: unknown;
  configUrl?: unknown;
  granted?: boolean;
  /** What the browser answers to an access request; an Error makes the request itself fail. */
  answer?: boolean | Error;
}

async function popup(setup: Setup = {}) {
  const calls: string[] = [];
  const writes: Record<string, unknown>[] = [];
  let granted = setup.granted ?? false;
  const ports: PopupPorts = {
    activeTabUrl: async () => ("url" in setup ? setup.url : `${A}/pricing`),
    readSettings: async () => ({ [STORAGE.sites]: setup.sites ?? [], [STORAGE.configUrl]: setup.configUrl ?? "" }),
    writeSettings: (values) => {
      calls.push("write");
      writes.push(values);
      return Promise.resolve();
    },
    isGranted: async () => granted,
    requestAccess: (pattern) => {
      calls.push(`request:${pattern}`);
      if (setup.answer instanceof Error) return Promise.reject(setup.answer);
      granted = setup.answer ?? true;
      return Promise.resolve(granted);
    },
    tabStatus: async () => undefined,
    onTabStatus: () => undefined,
    openTab: () => undefined,
  };
  const container = document.createElement("div");
  document.body.append(container);
  await mountPopup({ container, ports });
  const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  const field = container.querySelector("input")!;
  const type = (text: string) => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const click = async (name: string) => {
    button(name).click();
    await settle();
  };
  const selected = () => [...container.querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  const hint = () => {
    const element = container.querySelector<HTMLElement>("[data-role=hint]")!;
    return element.hidden ? undefined : element.textContent;
  };
  return { container, calls, writes, button, field, type, click, selected, hint };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Popup view", () => {
  it("shows the product name as its title", async () => {
    const { container } = await popup();
    expect(container.querySelector("h1")?.textContent).toBe("Intl TMS");
  });

  it("PO23 names the Site it switches", async () => {
    const { container } = await popup({ url: "http://localhost:3000/x" });
    expect(container.querySelector("[data-role=site]")?.textContent).toBe("Edit mode on localhost:3000");
  });

  it("PO4 shows On for a Listed and Granted Site with an address", async () => {
    const { selected } = await popup({ sites: [A], configUrl: "https://x/config", granted: true });
    expect(selected()).toEqual([POPUP.on]);
  });

  it("PO5 shows Off as soon as the field is cleared, whatever is stored", async () => {
    const { selected, type } = await popup({ sites: [A], configUrl: "https://x/config", granted: true });
    type("");
    expect(selected()).toEqual([POPUP.off]);
  });

  it("PO7 shows Off for a Site that is Listed and not Granted", async () => {
    const { selected } = await popup({ sites: [A], configUrl: "https://x/config", granted: false });
    expect(selected()).toEqual([POPUP.off]);
  });

  it("PO9 disables On when the tab has no Site", async () => {
    const { button } = await popup({ url: "chrome://extensions", configUrl: "https://x/config" });
    expect(button(POPUP.on).disabled).toBe(true);
  });

  it("PO10 disables On with no address", async () => {
    const { button } = await popup();
    expect(button(POPUP.on).disabled).toBe(true);
  });

  it("enables On once an address is typed", async () => {
    const { button, type } = await popup();
    type("https://x/config");
    expect(button(POPUP.on).disabled).toBe(false);
  });

  it("PO11 clicking On stores the Site in the list", async () => {
    const { writes, click } = await popup({ configUrl: "https://x/config" });
    await click(POPUP.on);
    expect(writes[0]?.[STORAGE.sites]).toEqual([A]);
  });

  it("PO12 clicking On for a Listed Site lists it once", async () => {
    const { writes, click } = await popup({ sites: [A], configUrl: "https://x/config" });
    await click(POPUP.on);
    expect(writes[0]?.[STORAGE.sites]).toEqual([A]);
  });

  it("PO16 clicking On writes the settings before requesting access", async () => {
    const { calls, click } = await popup({ configUrl: "https://x/config" });
    await click(POPUP.on);
    expect(calls).toEqual(["write", `request:${A}/*`]);
  });

  it("PO17 clicking On writes the list and the address in one write", async () => {
    const { writes, click, type } = await popup();
    type(" https://x/config ");
    await click(POPUP.on);
    expect(writes).toEqual([{ [STORAGE.sites]: [A], [STORAGE.configUrl]: "https://x/config" }]);
  });

  it("shows On once access is granted", async () => {
    const { selected, click } = await popup({ configUrl: "https://x/config", answer: true });
    await click(POPUP.on);
    expect(selected()).toEqual([POPUP.on]);
  });

  it("PO19 shows Off when access is refused", async () => {
    const { selected, click } = await popup({ configUrl: "https://x/config", answer: false });
    await click(POPUP.on);
    expect(selected()).toEqual([POPUP.off]);
  });

  it("PO20 shows the not-given-access hint when access is refused", async () => {
    const { hint, click } = await popup({ configUrl: "https://x/config", answer: false });
    await click(POPUP.on);
    expect(hint()).toBe(POPUP.hintNotGranted);
  });

  it("PO21 treats a failed access request as refused", async () => {
    const { hint, click } = await popup({ configUrl: "https://x/config", answer: new Error("no gesture") });
    await click(POPUP.on);
    expect(hint()).toBe(POPUP.hintNotGranted);
  });

  it("PO22 clicking On with no Site writes nothing", async () => {
    const { calls, button } = await popup({ url: undefined, configUrl: "https://x/config" });
    button(POPUP.on).disabled = false;
    button(POPUP.on).click();
    expect(calls).toEqual([]);
  });

  it("PO13 clicking Off stores the list without this Site", async () => {
    const { writes, click } = await popup({ sites: [A, "https://b.example"], configUrl: "https://x/config", granted: true });
    await click(POPUP.off);
    expect(writes).toEqual([{ [STORAGE.sites]: ["https://b.example"] }]);
  });

  it("shows Off after clicking Off", async () => {
    const { selected, click } = await popup({ sites: [A], configUrl: "https://x/config", granted: true });
    await click(POPUP.off);
    expect(selected()).toEqual([POPUP.off]);
  });

  it("PO15 clicking Off for a Site never on writes nothing", async () => {
    const { calls, click } = await popup({ sites: ["https://b.example"], configUrl: "https://x/config" });
    await click(POPUP.off);
    expect(calls).toEqual([]);
  });

  it("clicking Off never asks for access", async () => {
    const { calls, click } = await popup({ sites: [A], configUrl: "https://x/config", granted: true });
    await click(POPUP.off);
    expect(calls).toEqual(["write"]);
  });

  it("PO18 stores the address trimmed when the field is committed", async () => {
    const { writes, field } = await popup();
    field.value = " https://x/config ";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(writes).toEqual([{ [STORAGE.configUrl]: "https://x/config" }]);
  });

  it("shows the stored address in the field", async () => {
    const { field } = await popup({ configUrl: "https://x/config" });
    expect(field.value).toBe("https://x/config");
  });

  it("PO24 shows the cannot-be-switched-on hint for a tab with no Site", async () => {
    const { hint } = await popup({ url: "chrome://extensions" });
    expect(hint()).toBe(POPUP.hintNoSite);
  });

  it("PO25 shows the enter-a-config-URL hint", async () => {
    const { hint } = await popup();
    expect(hint()).toBe(POPUP.hintNoAddress);
  });

  it("PO26 shows no hint line when nothing is wrong", async () => {
    const { hint } = await popup({ sites: [A], configUrl: "https://x/config", granted: true });
    expect(hint()).toBeUndefined();
  });

  it("XP5 shows why a typed address is not accepted", async () => {
    const { hint, type } = await popup();
    type("/api/config");
    expect(hint()).toBe(POPUP.hintAddressNotAbsolute);
  });

  it("labels the address field", async () => {
    const { container, field } = await popup();
    expect(container.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(POPUP.addressLabel);
  });

  it("renders even when settings cannot be read", async () => {
    const container = document.createElement("div");
    await mountPopup({
      container,
      ports: {
        activeTabUrl: async () => `${A}/`,
        readSettings: () => Promise.reject(new Error("storage unavailable")),
        writeSettings: () => Promise.resolve(),
        isGranted: () => Promise.reject(new Error("no")),
        requestAccess: () => Promise.resolve(false),
        tabStatus: () => Promise.reject(new Error("no stash")),
        onTabStatus: () => {
          throw new Error("no events");
        },
        openTab: () => undefined,
      },
    });
    expect(container.querySelector("[data-role=hint]")?.textContent).toBe(POPUP.hintNoAddress);
  });
});
