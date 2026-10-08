import { describe, expect, it, vi } from "vitest";
import { PAGE_HOST_FILE, REGISTRATION_ID, createReconciler, type ReconcilePorts, type Registration } from "../src/worker/reconcile.js";

interface World {
  stored: unknown;
  granted: string[];
  registration: Registration | undefined;
  tabs: { id: number; url?: string }[];
  refuse: number[];
  calls: string[];
}

function world(overrides: Partial<World> = {}) {
  const state: World = { stored: [], granted: [], registration: undefined, tabs: [], refuse: [], calls: [], ...overrides };
  const ports: ReconcilePorts = {
    readSites: async () => state.stored,
    isGranted: async (pattern) => state.granted.includes(pattern),
    getRegistration: async () => state.registration,
    register: async (registration) => {
      state.calls.push("register");
      state.registration = registration;
    },
    update: async (registration) => {
      state.calls.push("update");
      state.registration = registration;
    },
    unregister: async () => {
      state.calls.push("unregister");
      state.registration = undefined;
    },
    listTabs: async () => state.tabs,
    inject: async (tabId) => {
      state.calls.push(`inject:${tabId}`);
      if (state.refuse.includes(tabId)) throw new Error("cannot access contents of the page");
    },
    logError: vi.fn(),
  };
  return { state, ports, reconcile: createReconciler(ports) };
}

const A = "https://a.example";
const B = "https://b.example";

describe("reconciliation: the registration", () => {
  it("SA1 covers the pattern of a Site that is Listed and Granted", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    await reconcile();
    expect(state.registration?.matches).toEqual([`${A}/*`]);
  });

  it("SA2 covers both of two Sites that are Listed and Granted", async () => {
    const { state, reconcile } = world({ stored: [A, B], granted: [`${A}/*`, `${B}/*`] });
    await reconcile();
    expect(state.registration?.matches).toEqual([`${A}/*`, `${B}/*`]);
  });

  it("SA3 leaves out a Site that is Listed and not Granted", async () => {
    const { state, reconcile } = world({ stored: [A, B], granted: [`${A}/*`] });
    await reconcile();
    expect(state.registration?.matches).toEqual([`${A}/*`]);
  });

  it("SA4 leaves out a Site that is Granted and not Listed", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`, `${B}/*`] });
    await reconcile();
    expect(state.registration?.matches).toEqual([`${A}/*`]);
  });

  it("SA5 registers nothing when no Listed Site is Granted", async () => {
    const { state, reconcile } = world({ stored: [A] });
    await reconcile();
    expect(state.registration).toBeUndefined();
  });

  it("SA6 attempts no removal when nothing is registered", async () => {
    const { state, reconcile } = world({ stored: [A] });
    await reconcile();
    expect(state.calls).toEqual([]);
  });

  it("SA7 removes the registration when the last Site is switched Off", async () => {
    const { state, reconcile } = world({ stored: [], granted: [`${A}/*`], registration: registrationFor([`${A}/*`]) });
    await reconcile();
    expect(state.calls).toEqual(["unregister"]);
  });

  it("SA8 updates an existing registration when the Sites change", async () => {
    const { state, reconcile } = world({ stored: [A, B], granted: [`${A}/*`, `${B}/*`], registration: registrationFor([`${A}/*`]) });
    await reconcile();
    expect(state.registration?.matches).toEqual([`${A}/*`, `${B}/*`]);
  });

  it("SA9 does not register an existing registration a second time", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], registration: registrationFor([`${A}/*`]) });
    await reconcile();
    expect(state.calls).not.toContain("register");
  });

  it("SA10 is for the top frame only", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    await reconcile();
    expect(state.registration?.allFrames).toBe(false);
  });

  it("SA11 runs at document idle", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    await reconcile();
    expect(state.registration?.runAt).toBe("document_idle");
  });

  it("is one registration under one fixed identifier, persisted across browser restarts", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    await reconcile();
    expect([state.registration?.id, state.registration?.js, state.registration?.persistAcrossSessions]).toEqual([REGISTRATION_ID, [PAGE_HOST_FILE], true]);
  });
});

function registrationFor(matches: string[]): Registration {
  return { id: REGISTRATION_ID, js: [PAGE_HOST_FILE], matches, allFrames: false, runAt: "document_idle", persistAcrossSessions: true };
}

describe("reconciliation: the stored list is untrusted", () => {
  const granted = ["not a site/*", "https://a.example//*", "https://a.example/path/*", "javascript:alert(1)/*", `${B}/*`];

  it.each([
    ["SA12", "not a site"],
    ["SA13", 42],
    ["SA14", "https://a.example/"],
    ["SA15", "https://a.example/path"],
    ["SA16", "javascript:alert(1)"],
  ])("%s skips the stored entry %j", async (_id, entry) => {
    const { state, reconcile } = world({ stored: [entry, B], granted });
    await reconcile();
    expect(state.registration?.matches).toEqual([`${B}/*`]);
  });

  it("SA17 treats a stored value that is not a list as no Sites", async () => {
    const { state, reconcile } = world({ stored: { 0: A }, granted: [`${A}/*`] });
    await reconcile();
    expect(state.registration).toBeUndefined();
  });
});

describe("reconciliation: runs", () => {
  it("SA18 two overlapping runs register once", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    await Promise.all([reconcile(), reconcile()]);
    expect(state.calls.filter((call) => call === "register")).toHaveLength(1);
  });

  it("SA19 a run after a failed run still reconciles", async () => {
    const { state, ports, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    const register = ports.register;
    ports.register = async () => {
      ports.register = register;
      throw new Error("browser said no");
    };
    await reconcile();
    await reconcile();
    expect(state.registration?.matches).toEqual([`${A}/*`]);
  });

  it("a failed run is logged with what it was trying to do", async () => {
    const { ports, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    ports.register = async () => {
      throw new Error("browser said no");
    };
    await reconcile();
    expect(ports.logError).toHaveBeenCalledWith(expect.stringContaining("site access is out of step: registering the page script: browser said no"));
  });

  it("a failed run does not reject", async () => {
    const { ports, reconcile } = world({ stored: [A], granted: [`${A}/*`] });
    ports.readSites = async () => {
      throw new Error("storage unavailable");
    };
    await expect(reconcile()).resolves.toBeUndefined();
  });
});

describe("reconciliation: open tabs", () => {
  it("SA20 injects the Page Host into an open tab on a Listed and Granted Site", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], tabs: [{ id: 1, url: `${A}/pricing` }] });
    await reconcile();
    expect(state.calls).toContain("inject:1");
  });

  it("SA21 does not inject into an open tab on another Site", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], tabs: [{ id: 2, url: `${B}/` }] });
    await reconcile();
    expect(state.calls).not.toContain("inject:2");
  });

  it("SA22 does not inject into an open tab on a Listed, not Granted Site", async () => {
    const { state, reconcile } = world({ stored: [A, B], granted: [`${A}/*`], tabs: [{ id: 2, url: `${B}/` }] });
    await reconcile();
    expect(state.calls).not.toContain("inject:2");
  });

  it("SA23 leaves alone a tab whose address is not disclosed", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], tabs: [{ id: 3 }] });
    await reconcile();
    expect(state.calls).not.toContain("inject:3");
  });

  it("SA24 injects after registering", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], tabs: [{ id: 1, url: `${A}/` }] });
    await reconcile();
    expect(state.calls).toEqual(["register", "inject:1"]);
  });

  it("SA25 still injects the second tab when the first refuses", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], tabs: [{ id: 1, url: `${A}/` }, { id: 2, url: `${A}/b` }], refuse: [1] });
    await reconcile();
    expect(state.calls).toContain("inject:2");
  });

  it("does not inject into a tab on another port of a Granted host", async () => {
    const { state, reconcile } = world({ stored: [A], granted: [`${A}/*`], tabs: [{ id: 4, url: "https://a.example:8443/" }] });
    await reconcile();
    expect(state.calls).not.toContain("inject:4");
  });
});
