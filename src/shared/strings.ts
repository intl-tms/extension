/**
 * Every string the Extension shows, in one catalogue (English). No view or
 * logic module carries literal user-facing text. Status text, per-Locale
 * tokens, the Shared notice, the conflict notice and the tag reason are the
 * Core's and are not repeated here.
 */

const list = (items: readonly string[]) => items.join(", ");

/** The product's name, and the tag that prefixes what it writes to a console. */
export const PRODUCT = { name: "Intl TMS", tag: "[intl-tms]" } as const;

/** Popup. */
export const POPUP = {
  siteLine: (host: string) => `Edit mode on ${host}`,
  on: "On",
  off: "Off",
  switchLabel: "Edit mode",
  addressLabel: "Config URL",
  addressPlaceholder: "https://app.example.com/api/…/config",
  hintNoSite: "Edit mode cannot be switched on for this tab.",
  hintNoAddress: "Enter a config URL to enable.",
  hintNotGranted: "The browser has not been given access to this site. Click On and allow it.",
  hintAddressNotAbsolute: "The config URL must be a full address starting with http:// or https://.",
  hintAddressNotWeb: (scheme: string) => `The config URL must start with http:// or https://, not ${scheme}//.`,
} as const;

/** Side Panel. */
export const PANEL = {
  placeholder: "Click a highlighted translation on the page to edit it.",
  sharedBadge: "Shared",
  currentLocale: "on this page",
  searchPlaceholder: "Search locale or value…",
  searchLabel: "Search locales",
  filterAll: "All",
  selectNone: "Select…",
  required: "Required",
  valueLabel: (locale: string) => `${locale} translation`,
  fieldLabel: (locale: string, label: string) => `${locale} ${label}`,
  hintRequired: (locales: readonly string[]) => `Required field empty in hidden locale(s): ${list(locales)}`,
  hintTags: (locales: readonly string[]) => `Tags do not match the source in hidden locale(s): ${list(locales)}`,
  hintJoin: " · ",
  save: "Save all",
  cancel: "Cancel",
  usedOnTitle: "Used on",
  usedOnLoading: "Loading…",
  usedOnFailed: "Couldn’t load usage",
  usedOnNone: "No other pages recorded yet.",
  usedOnCount: (count: number) => `×${count}`,
  usedOnNewTab: "↗ new tab",
  hiddenTitle: "Hidden on this page",
  hiddenTooltip: (attribute: string, key: string) => `${attribute} · ${key}`,
} as const;

/** Diagnostics: the pane and what is logged. */
export const DIAGNOSTICS = {
  title: "Diagnostics",
  copy: "Copy",
  clear: "Clear",
  copied: "Copied",
  copyFailed: "Copy failed",
  empty: "Nothing logged yet. Click a translation and press Save.",
  config: (languages: readonly string[], sourceLocale: string | undefined, hasSchema: boolean) =>
    `languages: ${languages.length > 0 ? list(languages) : "(none)"}; source: ${sourceLocale ?? "(unset)"}; schema: ${hasSchema ? "yes" : "no"}`,
  open: (key: string, locale: string) => `${key} (${locale})`,
  unconfiguredLocale: (locale: string, languages: readonly string[]) =>
    `the page says lang="${locale}", which is not one of the configured languages [${list(languages)}]`,
  unconfiguredLocaleDetail:
    "A save for this Locale is refused. Set the page's language to a configured one, or add this one to the configured languages.",
  values: (key: string, locales: readonly string[]) => `${key} -> ${locales.length > 0 ? list(locales) : "(no stored rows)"}`,
  valuesFailed: (key: string) => `${key} READ FAILED -- the panel is showing the on-page value only`,
  saveSent: (key: string) => `PUT ${key}`,
  saved: "saved",
  refused: "refused: changed elsewhere",
  failed: "FAILED",
  threw: "THREW",
} as const;

/** What is written to a console, where a developer will look. */
export const CONSOLE = {
  cookieDropped: (cookieName: string) => `${PRODUCT.tag} edit mode stays off: cookies are blocked for this site, so ${cookieName} could not be set`,
  cookieNotKept: (cookieName: string) =>
    `${PRODUCT.tag} edit mode stays off: this site did not keep ${cookieName} across a reload, so the page was not reloaded again`,
  configFailed: (reason: string) => `${PRODUCT.tag} failed to fetch the editing configuration: ${reason}`,
  reloadFailed: (reason: string) => `${PRODUCT.tag} reload after save failed: ${reason}`,
  reconcileFailed: (reason: string) => `${PRODUCT.tag} site access is out of step: ${reason}`,
} as const;

/** Why a configuration was not accepted, in words an Editor can act on. */
export const CONFIG_REASONS = {
  timedOut: (ms: number) => `the website did not answer within ${ms / 1000} seconds`,
  status: (status: number) => `the website answered with status ${status}`,
  notConfiguration: (received: string) => `the address answered with ${received}, which is not an editing configuration`,
  websiteNewer: "this website speaks a newer editing protocol than this extension; update the extension",
  websiteOlder: "this website speaks an older editing protocol than this extension; ask the website's developer to update it",
} as const;
