// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strip } from "@intl-tms/core";
import type { SaveResult } from "@intl-tms/core";
import { boot, byId, cleanup, click, mark, settle, SITE } from "./support/page.js";

const TEXT = `<p id="p">${mark("Hej", "greeting")}</p>`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A page showing `da` with `greeting` clicked. */
async function opened(options: Parameters<typeof boot>[0] = {}) {
  const page = boot({ html: TEXT, lang: "da", ...options });
  await page.on();
  click(byId("p"));
  await settle();
  page.requests.length = 0;
  page.events.length = 0;
  return page;
}

async function save(page: Awaited<ReturnType<typeof opened>>, key: string, values?: unknown) {
  const sent = page.command("save", values === undefined ? { key } : { key, values });
  await settle();
  return { ...sent, reply: sent.replies[0] as (SaveResult & { page?: string }) | undefined };
}

const writes = (page: Awaited<ReturnType<typeof opened>>) => page.requests.filter((entry) => entry.method === "PUT");

describe("commands: validation", () => {
  it("CM1 a message of unknown kind leaves no reply pending", async () => {
    expect((await opened()).command("explode" as never, {}).pending).toBe(false);
  });

  it("CM2 a null message leaves no reply pending", async () => {
    expect((await opened()).host.handleMessage(null, () => undefined)).toBe(false);
  });

  it("CM3 a save with no key leaves no reply pending", async () => {
    expect((await opened()).command("save", { values: {} }).pending).toBe(false);
  });

  it("CM4 a save with no key does not reach the session", async () => {
    const page = await opened();
    const { replies } = await save(page, undefined as never, { da: { value: "x" } });
    expect([replies, writes(page)]).toEqual([[], []]);
  });

  it("CM5 a save with a key and no writes saves an empty set", async () => {
    const page = await opened();
    const { reply } = await save(page, "greeting");
    expect([reply?.ok, reply?.results, writes(page)]).toEqual([true, {}, []]);
  });

  it("CM6 a valid save reports a reply pending", async () => {
    expect((await opened()).command("save", { key: "greeting", values: {} }).pending).toBe(true);
  });

  it("CM7 a valid navigate leaves no reply pending", async () => {
    expect((await opened()).command("navigate", { url: `${SITE}/pricing` }).pending).toBe(false);
  });

  it("CM8 a flash whose reference is not text is ignored", async () => {
    const page = await opened();
    page.command("flash", { id: 0 });
    expect(document.querySelectorAll("[data-tms-hl-flash]")).toHaveLength(0);
  });

  it("a message addressed to another context is ignored", async () => {
    const page = await opened();
    expect(page.host.handleMessage({ to: "panel", kind: "save", payload: { key: "greeting" } }, () => undefined)).toBe(false);
  });

  it("ignores commands before edit mode is on", () => {
    const page = boot({ html: TEXT });
    page.command("navigate", { url: `${SITE}/pricing` });
    expect(page.assigned).toEqual([]);
  });
});

describe("commands: saving", () => {
  it("CM9 a save for a key that is not active replies stale-selection", async () => {
    const { reply } = await save(await opened(), "another.key", { da: { value: "x" } });
    expect(reply?.error).toBe("stale-selection");
  });

  it("CM10 a save for a key that is not active makes no request", async () => {
    const page = await opened();
    await save(page, "another.key", { da: { value: "x" } });
    expect(page.requests).toEqual([]);
  });

  it("CM11 a Plain value saved for the Current Locale reaches the website as one write for that key", async () => {
    const page = await opened();
    await save(page, "greeting", { da: { value: "Hej da" } });
    expect(writes(page)).toEqual([{ url: `${SITE}/api/tms/keys/greeting`, method: "PUT", body: { locale: "da", value: "Hej da" } }]);
  });

  it("CM12 the reply says it succeeded", async () => {
    const { reply } = await save(await opened(), "greeting", { da: { value: "Hej da" } });
    expect(reply?.ok).toBe(true);
  });

  it("the reply carries each Locale's result", async () => {
    const { reply } = await save(await opened(), "greeting", { da: { value: "Hej da" } });
    expect(reply?.results.da?.ok).toBe(true);
  });

  it("CM13 the page shows the new text", async () => {
    await save(await opened(), "greeting", { da: { value: "Hej da" } });
    expect(strip(byId("p").textContent ?? "")).toBe("Hej da");
  });

  it("CM14 a Plain save does not reload", async () => {
    const page = await opened();
    await save(page, "greeting", { da: { value: "Hej da" } });
    expect(page.reloads.count).toBe(0);
  });

  it("CM15 a value with tags saved for the Current Locale reloads the page", async () => {
    const page = await opened();
    await save(page, "greeting", { da: { value: "Gå til <a>Docs</a>" } });
    expect(page.reloads.count).toBe(1);
  });

  it("CM16 the text node is not overwritten with the tag source", async () => {
    await save(await opened(), "greeting", { da: { value: "Gå til <a>Docs</a>" } });
    expect(strip(byId("p").textContent ?? "")).toBe("Hej");
  });

  it("CM17 a value with an argument reloads the page", async () => {
    const page = await opened();
    await save(page, "greeting", { da: { value: "Hej {name}" } });
    expect(page.reloads.count).toBe(1);
  });

  it("CM18 the text node is not overwritten with the argument source", async () => {
    await save(await opened(), "greeting", { da: { value: "Hej {name}" } });
    expect(strip(byId("p").textContent ?? "")).toBe("Hej");
  });

  it("CM19 saving only another Locale does not reload", async () => {
    const page = await opened();
    await save(page, "greeting", { en: { value: "Hello {name}" } });
    expect(page.reloads.count).toBe(0);
  });

  it("CM20 a write the website refuses with status 500 does not reload", async () => {
    const page = await opened();
    page.overrides.push({ match: (_url, method) => method === "PUT", answer: async () => new Response("{}", { status: 500 }) });
    await save(page, "greeting", { da: { value: "Hej <b>du</b>" } });
    expect(page.reloads.count).toBe(0);
  });

  it("CM21 the reply is given before the reload is asked for", async () => {
    const page = await opened();
    await save(page, "greeting", { da: { value: "Gå til <a>Docs</a>" } });
    expect(page.events.filter((event) => event === "reply" || event === "reload")).toEqual(["reply", "reload"]);
  });

  describe("when the reload throws", () => {
    const failing = async () => {
      const page = await opened({
        host: {
          navigation: {
            reload: () => {
              throw new Error("navigation blocked");
            },
            assign: () => undefined,
          },
        },
      });
      return { page, ...(await save(page, "greeting", { da: { value: "Gå til <a>Docs</a>" } })) };
    };

    it("CM22 the reply still said it succeeded", async () => {
      expect((await failing()).reply?.ok).toBe(true);
    });

    it("CM23 the failure is written to the page's console", async () => {
      expect((await failing()).page.consoleLines).toEqual(["[intl-tms] reload after save failed: navigation blocked"]);
    });

    it("CM24 exactly one reply was given", async () => {
      expect((await failing()).replies).toHaveLength(1);
    });
  });

  describe("when the session throws", () => {
    const throwing = async () => {
      const page = await opened();
      // The session asks its Host for the Current Locale when a save completes. A page that makes
      // that read fail is the one way to make the real session throw.
      vi.spyOn(document.documentElement, "getAttribute").mockImplementation(() => {
        throw new Error("boom");
      });
      const replies: unknown[] = [];
      page.host.handleMessage({ to: "page", kind: "save", payload: { key: "greeting", values: { da: { value: "x" } } } }, (result) => replies.push(result));
      await settle();
      vi.restoreAllMocks();
      return replies as SaveResult[];
    };

    it("CM25 the reply says it failed with an error beginning internal:", async () => {
      expect((await throwing())[0]).toMatchObject({ ok: false, error: "internal: boom" });
    });

    it("CM26 the reply's per-Locale results are empty", async () => {
      expect((await throwing())[0]?.results).toEqual({});
    });

    it("exactly one reply is given", async () => {
      expect(await throwing()).toHaveLength(1);
    });
  });

  it("CM27 a save after switching off replies stale-selection", async () => {
    const page = await opened();
    page.host.switchOff();
    const { reply } = await save(page, "greeting", { da: { value: "x" } });
    expect(reply?.error).toBe("stale-selection");
  });

  it("CM28 saving a Hidden translation sends hidden-changed with its new value", async () => {
    const page = boot({ html: `<button id="b" aria-label="${mark("Luk", "a.close")}">x</button>`, lang: "da" });
    await page.on();
    page.command("open-hidden", { id: page.last("hidden-changed")!.payload.items![0]!.id });
    await settle();
    page.command("save", { key: "a.close", values: { da: { value: "Luk nu" } } });
    await settle();
    expect(page.last("hidden-changed")?.payload.items?.map((item) => item.value)).toEqual(["Luk nu"]);
  });

  it("a reply callback that throws does not escape", async () => {
    const page = await opened();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    page.host.handleMessage({ to: "page", kind: "save", payload: { key: "greeting", values: {} } }, () => {
      throw new Error("channel closed");
    });
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
