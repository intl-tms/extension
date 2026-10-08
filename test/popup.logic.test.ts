import { describe, expect, it } from "vitest";
import { addSite, addressPresent, canSwitchOn, checkAddress, hintFor, isOn, removeSite, siteLine } from "../src/popup/logic.js";
import { POPUP } from "../src/shared/strings.js";

const A = "https://a.example";
const B = "https://b.example";
const good = { site: A, address: "https://x/config", listed: true, granted: true };

describe("Popup logic", () => {
  it("PO1 an address is present", () => {
    expect(addressPresent("https://x/config")).toBe(true);
  });

  it("PO2 an empty address is not present", () => {
    expect(addressPresent("")).toBe(false);
  });

  it("PO3 an address of spaces only is not present", () => {
    expect(addressPresent("   ")).toBe(false);
  });

  it("PO4 shows On with an address and a Site that is Listed and Granted", () => {
    expect(isOn(good)).toBe(true);
  });

  it("PO5 shows Off once the address is cleared", () => {
    expect(isOn({ ...good, address: "" })).toBe(false);
  });

  it("PO6 shows Off when the Site is not Listed", () => {
    expect(isOn({ ...good, listed: false })).toBe(false);
  });

  it("PO7 shows Off when the Site is Listed and not Granted", () => {
    expect(isOn({ ...good, granted: false })).toBe(false);
  });

  it("PO8 shows Off when the Site is Granted and not Listed", () => {
    expect(isOn({ ...good, listed: false, granted: true })).toBe(false);
  });

  it("shows Off when the tab has no Site", () => {
    expect(isOn({ ...good, site: undefined })).toBe(false);
  });

  it("PO9 On is disabled when the tab has no Site", () => {
    expect(canSwitchOn({ site: undefined, address: "https://x/config" })).toBe(false);
  });

  it("PO10 On is disabled with no address", () => {
    expect(canSwitchOn({ site: A, address: " " })).toBe(false);
  });

  it("On is enabled with a Site and an address", () => {
    expect(canSwitchOn({ site: A, address: "https://x/config" })).toBe(true);
  });

  it("PO11 switching On adds the Site to the list", () => {
    expect(addSite([B], A)).toEqual([B, A]);
  });

  it("PO12 switching On a Listed Site lists it once", () => {
    expect(addSite([A, B], A)).toEqual([A, B]);
  });

  it("PO13 switching Off removes that Site", () => {
    expect(removeSite([A], A)).toEqual([]);
  });

  it("PO14 switching Off leaves the other Site", () => {
    expect(removeSite([A, B], A)).toEqual([B]);
  });

  it("PO15 switching Off a Site never on leaves the list unchanged", () => {
    expect(removeSite([B], A)).toEqual([B]);
  });

  it("PO23 the Site line names the host and port", () => {
    expect(siteLine("http://localhost:3000")).toBe("Edit mode on localhost:3000");
  });

  it("the Site line is empty when the tab has no Site", () => {
    expect(siteLine(undefined)).toBe("");
  });

  it("PO24 hints that a tab with no Site cannot be switched on", () => {
    expect(hintFor({ ...good, site: undefined })).toBe(POPUP.hintNoSite);
  });

  it("PO25 hints to enter a config URL", () => {
    expect(hintFor({ ...good, address: "" })).toBe(POPUP.hintNoAddress);
  });

  it("PO20 hints that the browser has not given access when Listed and not Granted", () => {
    expect(hintFor({ ...good, granted: false })).toBe(POPUP.hintNotGranted);
  });

  it("PO26 has no hint when nothing is wrong", () => {
    expect(hintFor(good)).toBeUndefined();
  });

  it("has no hint for a Site that is simply Off", () => {
    expect(hintFor({ ...good, listed: false, granted: false })).toBeUndefined();
  });

  it("XP4 rejects an address with another scheme, with a reason", () => {
    expect(checkAddress("ftp://x/config")).toEqual({ ok: false, reason: POPUP.hintAddressNotWeb("ftp:") });
  });

  it("XP5 rejects a relative address, with a reason", () => {
    expect(checkAddress("/api/config")).toEqual({ ok: false, reason: POPUP.hintAddressNotAbsolute });
  });

  it("accepts an absolute web address, trimmed", () => {
    expect(checkAddress(" http://localhost:3000/api/config ")).toEqual({ ok: true, address: "http://localhost:3000/api/config" });
  });

  it("On is disabled while the address is not accepted", () => {
    expect(canSwitchOn({ site: A, address: "ftp://x/config" })).toBe(false);
  });

  it("hints why an address is not accepted", () => {
    expect(hintFor({ ...good, address: "/api/config" })).toBe(POPUP.hintAddressNotAbsolute);
  });
});
