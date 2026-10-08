/**
 * Site helpers. A Site is the origin of a browser tab (scheme, host and port)
 * and is the unit edit mode is switched on for. Only `http` and `https` tabs
 * have one.
 */

const WEB_SCHEMES = new Set(["http:", "https:"]);

/** The Site of an address, or nothing when it has none: no address, one that will not parse, or one that is not a website. */
export function siteOf(address: string | undefined): string | undefined {
  if (typeof address !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  return WEB_SCHEMES.has(url.protocol) ? url.origin : undefined;
}

/**
 * Whether a value is a Site: a string that equals its own origin. Stored lists
 * arrive from other devices and are untrusted, so this is the only test that
 * lets an entry become an access pattern.
 */
export function isSite(value: unknown): value is string {
  return typeof value === "string" && siteOf(value) === value;
}

/** Every path under the Site: the one form used both to ask the browser for access and to register the Page Host. */
export function accessPattern(site: string): string {
  return `${site}/*`;
}

/** The Site's host and port without its scheme, for showing to an Editor. */
export function hostOf(site: string): string {
  return new URL(site).host;
}
