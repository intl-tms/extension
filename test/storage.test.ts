import { describe, expect, it } from "vitest";
import { STORAGE, readSettings } from "../src/shared/storage.js";

const settings = (sites: unknown, configUrl: unknown) => readSettings({ [STORAGE.sites]: sites, [STORAGE.configUrl]: configUrl });

describe("stored settings are untrusted", () => {
  it("keeps entries that are Sites", () => {
    expect(settings(["https://a.example", "http://localhost:3000"], "").sites).toEqual(["https://a.example", "http://localhost:3000"]);
  });

  it("skips entries that are not Sites", () => {
    expect(settings(["not a site", 7, "https://a.example/", "javascript:alert(1)", "https://b.example"], "").sites).toEqual(["https://b.example"]);
  });

  it("treats a value that is not a list as no Sites", () => {
    expect(settings({ 0: "https://a.example" }, "").sites).toEqual([]);
  });

  it("lists a repeated Site once", () => {
    expect(settings(["https://a.example", "https://a.example"], "").sites).toEqual(["https://a.example"]);
  });

  it("trims the configuration address", () => {
    expect(settings([], "  https://x/config ").configUrl).toBe("https://x/config");
  });

  it("treats an address that is not a string as absent", () => {
    expect(settings([], { url: "https://x" }).configUrl).toBe("");
  });

  it("treats a missing store as empty settings", () => {
    expect(readSettings(undefined)).toEqual({ sites: [], configUrl: "" });
  });
});
