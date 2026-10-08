import { hostOf } from "../shared/site.js";
import { POPUP } from "../shared/strings.js";

/**
 * The Popup's decisions, pure: no browser, no storage, no DOM. The view feeds
 * it what the field holds right now, so the switch and the hint follow the
 * Editor's typing rather than what is stored.
 */

/** What the Popup knows about the active tab. */
export interface PopupFacts {
  /** The active tab's Site, or nothing when it has none. */
  site: string | undefined;
  /** The address field's current text. */
  address: string;
  /** The Editor switched edit mode on for this Site. */
  listed: boolean;
  /** The browser has given the Extension access to this Site. */
  granted: boolean;
}

/** Whether an address was accepted, and if not, why in words. */
export type AddressCheck = { ok: true; address: string } | { ok: false; reason: string };

/** A configuration address is present when it is non-empty after trimming whitespace. */
export function addressPresent(address: string): boolean {
  return address.trim() !== "";
}

/**
 * Checks a typed address: it must be an absolute `http` or `https` address.
 * The commonest mistake is pasting a path, which would otherwise fail later
 * and elsewhere as "nothing is highlighted".
 */
export function checkAddress(address: string): AddressCheck {
  const trimmed = address.trim();
  if (trimmed === "") return { ok: false, reason: POPUP.hintNoAddress };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: POPUP.hintAddressNotAbsolute };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: POPUP.hintAddressNotWeb(url.protocol) };
  return { ok: true, address: trimmed };
}

/** Whether the On button can be pressed: edit mode can do nothing without a Site and an accepted address. */
export function canSwitchOn(facts: Pick<PopupFacts, "site" | "address">): boolean {
  return facts.site !== undefined && checkAddress(facts.address).ok;
}

/** Whether the switch shows On: a Site, an accepted address, Listed and Granted. Anything else is Off. */
export function isOn(facts: PopupFacts): boolean {
  return canSwitchOn(facts) && facts.listed && facts.granted;
}

/** The Listed Sites with `site` added, once. */
export function addSite(sites: readonly string[], site: string): string[] {
  return sites.includes(site) ? [...sites] : [...sites, site];
}

/** The Listed Sites without `site`. Other Sites are untouched. */
export function removeSite(sites: readonly string[], site: string): string[] {
  return sites.filter((listed) => listed !== site);
}

/** The line naming what the switch applies to, so the Editor knows what they are switching. */
export function siteLine(site: string | undefined): string {
  return site === undefined ? "" : POPUP.siteLine(hostOf(site));
}

/** The one line of problem text: the first that applies, or nothing. */
export function hintFor(facts: PopupFacts): string | undefined {
  if (facts.site === undefined) return POPUP.hintNoSite;
  const address = checkAddress(facts.address);
  if (!address.ok) return address.reason;
  // How a dismissed or denied prompt reaches the Editor: clicking On asks again.
  if (facts.listed && !facts.granted) return POPUP.hintNotGranted;
  return undefined;
}
