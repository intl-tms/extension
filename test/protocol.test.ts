import { describe, expect, it } from "vitest";
import { message, parseFor } from "../src/shared/protocol.js";

describe("protocol", () => {
  it("builds an addressed message", () => {
    expect(message("worker", "hidden-changed", { items: [] })).toEqual({ to: "worker", kind: "hidden-changed", payload: { items: [] } });
  });

  it("carries the tab, Site and selection identifiers it is given", () => {
    expect(message("panel", "values-loaded", { key: "k" }, { tab: 7, site: "https://a.example", selection: "s-1" })).toEqual({
      to: "panel",
      kind: "values-loaded",
      payload: { key: "k" },
      tab: 7,
      site: "https://a.example",
      selection: "s-1",
    });
  });

  it("accepts a well-formed message addressed to the receiver", () => {
    expect(parseFor("page", { to: "page", kind: "flash", payload: { id: "a1:title" } })?.kind).toBe("flash");
  });

  it("ignores a message addressed to another context", () => {
    expect(parseFor("panel", { to: "worker", kind: "hidden-changed", payload: { items: [] } })).toBeUndefined();
  });

  it("ignores a kind its receiver does not handle", () => {
    expect(parseFor("panel", { to: "panel", kind: "save", payload: { key: "k" } })).toBeUndefined();
  });

  it.each([[null], [undefined], ["save"], [42], [{}], [{ to: "page" }], [{ to: "page", kind: "toString", payload: {} }]])("ignores %j", (raw) => {
    expect(parseFor("page", raw)).toBeUndefined();
  });

  it("ignores a save with no key", () => {
    expect(parseFor("page", { to: "page", kind: "save", payload: { values: {} } })).toBeUndefined();
  });

  it("accepts a save with no writes", () => {
    expect(parseFor("page", { to: "page", kind: "save", payload: { key: "k" } })?.payload).toEqual({ key: "k" });
  });

  it("ignores a save whose writes are not an object", () => {
    expect(parseFor("page", { to: "page", kind: "save", payload: { key: "k", values: "x" } })).toBeUndefined();
  });

  it.each([["javascript:alert(1)"], ["data:text/html,x"], ["/pricing"], [7]])("ignores a navigate to %j", (url) => {
    expect(parseFor("page", { to: "page", kind: "navigate", payload: { url } })).toBeUndefined();
  });

  it("accepts a navigate to an absolute web address", () => {
    expect(parseFor("page", { to: "page", kind: "navigate", payload: { url: "http://a.example/x" } })?.kind).toBe("navigate");
  });

  it("ignores a Hidden item reference that is not text", () => {
    expect(parseFor("page", { to: "page", kind: "open-hidden", payload: { id: 0 } })).toBeUndefined();
  });

  it("ignores a selection announcement without a key", () => {
    expect(parseFor("worker", { to: "worker", kind: "selection-opened", payload: { locale: "en", value: "x" } })).toBeUndefined();
  });

  it("accepts values-loaded with nothing but a key", () => {
    expect(parseFor("worker", { to: "worker", kind: "values-loaded", payload: { key: "k" } })?.kind).toBe("values-loaded");
  });

  it("ignores values that are not an envelope", () => {
    expect(parseFor("panel", { to: "panel", kind: "values-loaded", payload: { key: "k", values: [] } })).toBeUndefined();
  });

  it("ignores a Hidden list that is not a list", () => {
    expect(parseFor("panel", { to: "panel", kind: "hidden-changed", payload: { items: "x" } })).toBeUndefined();
  });

  it("accepts panel-ready with no payload", () => {
    expect(parseFor("worker", { to: "worker", kind: "panel-ready" })?.kind).toBe("panel-ready");
  });

  it("drops identifiers of the wrong type", () => {
    expect(parseFor("worker", { to: "worker", kind: "panel-ready", tab: "7", selection: 3 })).toEqual({ to: "worker", kind: "panel-ready", payload: {} });
  });
});
