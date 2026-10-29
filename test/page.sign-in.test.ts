// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCheck, type Authorize } from "@intl-tms/core";
import type { PageStatus } from "../src/shared/protocol.js";
import { BASE, CONFIG_URL, SITE, boot, byId, cleanup, click, mark, settle } from "./support/page.js";

const MARKED = `<p id="p">${mark("Hej", "greeting")}</p>`;
const UNMARKED = `<p id="p">Hej</p>`;

/** A website with a login for Editors whose signed-in state a test controls. */
function website(options: { credentials?: boolean; help?: { unauthenticated?: string; forbidden?: string } } = {}) {
  const state = { signedIn: false, editor: true };
  const authorize: Authorize = sessionCheck({
    user: () => (state.signedIn ? { id: "ada", name: "Ada Jensen" } : null),
    may: () => state.editor,
    signIn: "/editors/sign-in",
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    ...(options.help === undefined ? {} : { help: options.help }),
  });
  return { state, authorize };
}

function setVisibility(value: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const signIn = (page: { last(kind: "status-changed"): { payload: { status: PageStatus } } | undefined }) => page.last("status-changed")?.payload.status.signIn;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the sign-in state", () => {
  it("a refused configuration says the Editor is not signed in, with how to sign in", async () => {
    const { authorize } = website({ help: { unauthenticated: "Use your company account." } });
    const page = boot({ html: UNMARKED, authorize });
    await page.on();
    expect(signIn(page)).toEqual({ state: "not-signed-in", descriptor: { session: { signIn: `${SITE}/editors/sign-in` }, help: "Use your company account." } });
  });

  it("a 401 without a descriptor is still not signed in", async () => {
    const page = boot({ html: UNMARKED, authorize: () => false });
    await page.on();
    expect(signIn(page)).toEqual({ state: "not-signed-in", descriptor: {} });
  });

  it("a sign-in address that is not a web address is dropped", async () => {
    const page = boot({ html: UNMARKED, request: async () => new Response(JSON.stringify({ error: "unauthorized", code: "unauthorized", auth: { session: { signIn: "javascript:alert(1)" } } }), { status: 401 }) });
    await page.on();
    expect(signIn(page)).toEqual({ state: "not-signed-in", descriptor: {} });
  });

  it("a 403 says the Editor may not edit, with the help text", async () => {
    const { state, authorize } = website({ help: { forbidden: "Ask IT for the Editor role." } });
    state.signedIn = true;
    state.editor = false;
    const page = boot({ html: UNMARKED, authorize });
    await page.on();
    expect(signIn(page)).toEqual({ state: "not-permitted", help: "Ask IT for the Editor role." });
  });

  it("a 403 for a foreign origin is not about signing in", async () => {
    const page = boot({ html: MARKED, request: async () => new Response(JSON.stringify({ error: "origin not allowed", code: "forbidden-origin" }), { status: 403 }) });
    await page.on();
    expect(signIn(page)).toBeUndefined();
  });

  it("an accepted configuration names the Editor", async () => {
    const { state, authorize } = website();
    state.signedIn = true;
    const page = boot({ html: MARKED, authorize });
    await page.on();
    expect(signIn(page)).toEqual({ state: "accepted", editor: "Ada Jensen" });
  });

  it("a refused save sets the state, and the next accepted answer clears it", async () => {
    const { state, authorize } = website();
    state.signedIn = true;
    const page = boot({ html: MARKED, authorize });
    await page.on();
    click(byId("p"));
    await settle();
    state.signedIn = false;
    page.command("save", { key: "greeting", values: { da: { value: "x" } } });
    await settle();
    expect(signIn(page)?.state).toBe("not-signed-in");
    state.signedIn = true;
    page.command("save", { key: "greeting", values: { da: { value: "y" } } });
    await settle();
    expect(signIn(page)?.state).toBe("accepted");
  });
});

describe("coming back after signing in", () => {
  it("the configuration is requested again when the page becomes visible", async () => {
    const page = boot({ html: UNMARKED, authorize: website().authorize });
    await page.on();
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(page.requests.filter((r) => r.url === CONFIG_URL)).toHaveLength(2);
  });

  it("once per return", async () => {
    const page = boot({ html: UNMARKED, authorize: website().authorize });
    await page.on();
    for (let i = 0; i < 3; i++) {
      setVisibility("hidden");
      setVisibility("visible");
      await settle();
    }
    expect(page.requests.filter((r) => r.url === CONFIG_URL)).toHaveLength(4);
  });

  it("not while signed in", async () => {
    const { state, authorize } = website();
    state.signedIn = true;
    const page = boot({ html: MARKED, authorize });
    await page.on();
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(page.requests.filter((r) => r.url === CONFIG_URL)).toHaveLength(1);
  });

  it("an unmarked page reloads once after signing in", async () => {
    const { state, authorize } = website();
    const page = boot({ html: UNMARKED, authorize });
    await page.on();
    state.signedIn = true;
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(page.reloads.count).toBe(1);
  });

  it("is not reloaded again while it stays signed in", async () => {
    const { state, authorize } = website();
    const page = boot({ html: UNMARKED, authorize });
    await page.on();
    state.signedIn = true;
    for (let i = 0; i < 2; i++) {
      setVisibility("hidden");
      setVisibility("visible");
      await settle();
    }
    expect(page.reloads.count).toBe(1);
  });

  it("an unmarked page that is still refused is not reloaded", async () => {
    const page = boot({ html: UNMARKED, authorize: website().authorize });
    await page.on();
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(page.reloads.count).toBe(0);
  });

  it("a page with Markers is not reloaded after signing in again: the draft stays", async () => {
    const { state, authorize } = website();
    const page = boot({ html: MARKED, authorize });
    await page.on();
    state.signedIn = true;
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect([page.reloads.count, signIn(page)?.state]).toEqual([0, "accepted"]);
  });

  it("stops listening when edit mode is switched off", async () => {
    const page = boot({ html: UNMARKED, authorize: website().authorize });
    await page.on();
    page.host.switchOff();
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(page.requests.filter((r) => r.url === CONFIG_URL)).toHaveLength(1);
  });
});

describe("a session cookie that must travel to another origin", () => {
  it("the configuration is requested again once, with credentials", async () => {
    const page = boot({ html: UNMARKED, authorize: website({ credentials: true }).authorize });
    await page.on();
    expect(page.requests.filter((r) => r.url === CONFIG_URL).map((r) => r.credentials)).toEqual([undefined, "include"]);
  });

  it("and every later request of the page load includes them", async () => {
    const { state, authorize } = website({ credentials: true });
    const page = boot({ html: MARKED, authorize });
    await page.on();
    state.signedIn = true;
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    click(byId("p"));
    await settle();
    page.command("save", { key: "greeting", values: { da: { value: "x" } } });
    await settle();
    expect(page.requests.find((r) => r.method === "PUT" && r.url.startsWith(`${BASE}/keys/`))?.credentials).toBe("include");
  });

  it("without the flag, a refused request is not repeated", async () => {
    const page = boot({ html: UNMARKED, authorize: website().authorize });
    await page.on();
    expect(page.requests.filter((r) => r.url === CONFIG_URL)).toHaveLength(1);
  });
});
