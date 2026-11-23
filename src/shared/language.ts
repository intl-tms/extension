/**
 * A Locale's name in words.
 *
 * The wire contract carries Locale codes only, so the name is made here from
 * the browser's own data: it is never stored, never sent and never saved into
 * a row. A code the browser has no name for comes back unchanged — showing
 * `da` is better than showing nothing, and the panel shows the code beside the
 * name regardless, because the code is what an Editor compares against a
 * configuration.
 */

/** Built once: a formatter per row would be rebuilt on every repaint. */
let names: Intl.DisplayNames | undefined;
let unavailable = false;

export function languageName(locale: string): string {
  if (locale === "") return locale;
  if (!unavailable && names === undefined) {
    try {
      // `fallback: "none"` matters: the default invents a name for a tag it has
      // no data for, so an unconfigured Locale would read "zz (Unknown Region)"
      // instead of falling back to the code the configuration actually spells.
      names = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
    } catch {
      // No display names in this browser: codes throughout.
      unavailable = true;
    }
  }
  try {
    return names?.of(locale) ?? locale;
  } catch {
    // Not a structurally valid language tag. The configuration's spelling stands.
    return locale;
  }
}
