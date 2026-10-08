import { describe, expect, it } from "vitest";
import { accessPattern, hostOf, isSite, siteOf } from "../src/shared/site.js";

describe("Sites", () => {
  it("ST1 a tab's Site is its origin", () => {
    expect(siteOf("https://app.example.com/pricing?x=1")).toBe("https://app.example.com");
  });

  it("ST2 the port is part of the Site", () => {
    expect(siteOf("http://localhost:3000/a")).toBe("http://localhost:3000");
  });

  it("ST3 two ports on one host are two Sites", () => {
    expect(siteOf("http://localhost:3000/")).not.toBe(siteOf("http://localhost:4000/"));
  });

  it("ST4 a browser-internal page has no Site", () => {
    expect(siteOf("chrome://extensions/")).toBeUndefined();
  });

  it("ST5 a local file has no Site", () => {
    expect(siteOf("file:///Users/me/index.html")).toBeUndefined();
  });

  it("ST6 a tab with no address has no Site", () => {
    expect(siteOf(undefined)).toBeUndefined();
  });

  it("ST7 text that is not an address has no Site", () => {
    expect(siteOf("not an address")).toBeUndefined();
  });

  it("ST8 an extension page has no Site", () => {
    expect(siteOf("chrome-extension://abcdefgh/panel.html")).toBeUndefined();
  });

  it("ST9 the access pattern is every path under the origin", () => {
    expect(accessPattern("https://a.example")).toBe("https://a.example/*");
  });

  it("the host of a Site is its host and port without the scheme", () => {
    expect(hostOf("http://localhost:3000")).toBe("localhost:3000");
  });

  it("a string that equals its own origin is a Site", () => {
    expect(isSite("https://a.example")).toBe(true);
  });

  it.each([["not a site"], [42], ["https://a.example/"], ["https://a.example/path"], ["javascript:alert(1)"], ["HTTPS://A.example"]])(
    "%j is not a Site",
    (value) => {
      expect(isSite(value)).toBe(false);
    },
  );
});
