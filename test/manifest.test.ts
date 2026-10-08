import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../static/${name}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json")) as Record<string, unknown>;

describe("manifest", () => {
  it("MN1 contains no all-websites pattern", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|\*:\/\/\*/);
  });

  it("MN2 declares no standing site access", () => {
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("MN3 declares no page script", () => {
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("MN4 optional site access is exactly the two web schemes", () => {
    expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
  });

  it("MN5 permissions are exactly the baseline four", () => {
    expect([...(manifest.permissions as string[])].sort()).toEqual(["activeTab", "scripting", "sidePanel", "storage"]);
  });

  it("MN6 exposes no file to web pages", () => {
    expect([manifest.web_accessible_resources, manifest.externally_connectable]).toEqual([undefined, undefined]);
  });

  it("targets the current platform generation with a minimum browser version", () => {
    expect([manifest.manifest_version, manifest.minimum_chrome_version]).toEqual([3, "116"]);
  });

  it("extension pages allow only the Extension's own scripts and styles", () => {
    expect((manifest.content_security_policy as { extension_pages: string }).extension_pages).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'",
    );
  });
});

describe.each(["popup.html", "panel.html"])("%s", (shell) => {
  it("MN7 contains no inline script", () => {
    expect(read(shell)).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>|\son\w+\s*=/i);
  });

  it("contains no inline style", () => {
    expect(read(shell)).not.toMatch(/<style|\sstyle\s*=/i);
  });
});
