# Decisions

Choices made where the specification was silent, left the answer to the builder,
or where the Core differs from what the specification assumed. Each says what
was chosen and why.

## Scope

- **Built:** every baseline (unmarked) requirement of documents 01 to 07, i.e.
  milestones M0 to M8, plus the ▲ items those milestones fold in (listed
  below). Chrome only.
- **Not built:** M9 onward (discovery and the checklist Popup, restored
  Selection after a reload, drafts across a closed panel, the direct channel,
  the page bridge, options page, commands, context menu, badge, localisation,
  second browser family). See "Deferred" at the end.

## Tooling (M0)

- **pnpm, TypeScript 5.9 strict with `noUncheckedIndexedAccess`, vitest with
  jsdom, esbuild, eslint, Playwright.** The Core is consumed as a linked
  package (`link:../core`) and bundled in; it is the only runtime dependency.
- **Four bundles are IIFE single files** targeting Chrome 116, minified, with
  source maps. `scripts/build.mjs --watch` rebuilds bundles and re-copies
  static files.
- **No icons ship yet.** The manifest declares none, so the browser shows its
  default. Artwork is a product decision, not a build one.
- **Extension-page CSP** is `default-src 'none'; script-src 'self'; style-src
  'self'`: extension pages make no network request of their own.

## Spike S1 and S2: transport

- **Not run. The relay is the transport.** The direct channel (ARC-30) is an
  M12 improvement and the protocol is the same either way (MSP-1), so nothing
  built here has to change when the spike is done.
- **S2 (which tab is the panel beside) is not relied on.** The panel learns its
  tab from the messages it is shown: every relayed message names its tab, and
  the panel names that tab back on every command (RLY-44).

## Protocol (M1)

- **Addressing is a `to` member** (`worker`, `page`, `panel`), not distinct
  kinds per hop. So the catalogue's `selection-changed` does not exist: the
  Worker relays `selection-opened` re-addressed to the panel.
- **The envelope** is `{ to, kind, payload, tab?, site?, selection? }`. `site`
  is an addition to the specification's envelope: the Worker stamps the
  sender's origin so the per-Site configuration slice (RLY-41) and same-Site
  navigation (NAV-4) need no second lookup.
- **Selection identifiers** are minted by the Page Host (`s-<page>-<n>`), new
  for every opening. The relay uses them to refuse values from an earlier
  opening of the same key.
- **Validation** is one table of payload checks beside the one definition of
  the shapes, applied by `parseFor(destination, raw)` at every receiver. It is
  hand-written rather than generated (MSP-21 is ▲).
- **Exhaustiveness (MSP-10)** is a mapped type, `Handlers<Destination>`. A
  type-level test (`test/protocol.types.test.ts`) fails the type check when a
  kind has no handler.
- **A `status-changed` announcement** carries the page status (HST-43). The
  Worker stashes it per tab; nothing displays it yet.

## The Core differs from the specification's examples

- **Hidden items are `{ id, attribute, key, value }`** with a stable string
  `id`, not `{ index, attr, … }`. `flash` and `open-hidden` therefore carry
  `{ id: string }`, which is HST-44 (stable references) for free. Scenario CM8
  becomes "a reference that is not text is ignored".
- **The panel store already keeps drafts across a change of selection**
  (PNL-102), so PV-120's core behaviour exists; its list-of-unsaved-keys UI is
  not built.
- **The Core client does not fetch the configuration**, so the Page Host does,
  with its own time limit on the injected request function and timers.

## Stored values

- `sites` and `configUrl` in synchronised storage, as specified.
- **Configuration slices are per Site** (RLY-41): `configSlices` in durable
  storage is `{ sites: { [origin]: slice }, last: origin | null }`.
- **The stash is per tab** (RLY-40): `stash` in session storage is `{ tabs: {
  [tabId]: { site, selection, selectionId, hidden, status } }, selectionTab,
  hiddenTab }`. `selectionTab` and `hiddenTab` are the tabs of the most recent
  Selection and Hidden list: what a panel that has not named a tab is seeded
  from.

## Reconciliation (M2)

- The port "read the Listed Sites" returns the raw stored value and
  reconciliation validates it, so the untrusted-list rule has one home.
- A failed run logs `site access is out of step: <what it was doing>: <reason>`
  and resolves; the queue continues.

## Popup (M3)

- **The settings write is issued, not awaited, before the access request.**
  Both happen synchronously inside the click, write first. Awaiting the write
  would risk losing the gesture the request needs.
- **POP-34 (live address validation) is built**: an address that is not an
  absolute `http`/`https` address shows its reason and keeps On disabled.
- Clicking Off for a Site that is not Listed writes nothing.
- The Popup's decisions are in `popup/logic.ts` (pure); `popup/view.ts` renders
  and calls ports; there is no messaging port at all (POP-15), which a test
  pins.

## Page Host (M4, M5)

- **Editing is an Alt-click (Option on a Mac); a plain click is the page's.**
  The Core's highlighter owns the rule and the reasons (see its decisions).
  The Extension only words it: the panel's placeholder, the diagnostics hint
  and the Editor's guide. The content script still runs at `document_idle`,
  so a page that captures at the window before then hears an edit press first.
- **Cookies and the tab's session storage are ports** in addition to the ones
  the specification lists, because "cookies are blocked" and "already
  reloaded" must be testable without a browser.
- **Toggle (ACT-20, ACT-21):** `tms-edit=1; Path=/; SameSite=Lax;
  Max-Age=43200`, plus `Secure` on an https page. It is renewed once per page
  load while edit mode is on.
- **Reload guard (ACT-22):** a flag in the page's session storage is set before
  the reload and cleared when a load arrives with the Toggle present. A load
  with the flag set and no Toggle means the website did not keep the cookie:
  no second reload, a console line, status `toggle: "not-kept"` (a value added
  to the specification's status shape). The flag is consumed, so a later
  manual load may try once more: at most one reload per page load the Editor
  causes, never a loop.
- **"The website does not mark its text"** is reported as `marked: false` in
  the status after the first scan, not by a second reload.
- **"Active"** means the Gate passed and the Toggle is present. Switching off
  when not active does nothing (ACT-54).
- **Configuration validation (ACT-40):** a response must be JSON with a
  `locales` list of strings and `endpoints.values`. The reason names what was
  received (an HTML page, something that is not JSON, JSON of another shape).
- **Protocol (ACT-41):** a served `protocol` greater or smaller than the
  bundled Core's is `website-newer` / `website-older`; the session is not
  started. A configuration with no `protocol` member is accepted as
  `unknown`.
- **Overlapping applications (ACT-6)** share one in-flight configuration
  request per address; a generation counter makes the earlier one yield.
- **A re-application after a failed load fetches again** (ACT-31: "when there
  is none yet"). Backoff and retry-on-focus (ACT-43) are deferred.
- **Save reply:** the session's outcome is sent as it is, including its `page`
  member. A thrown session is `{ ok: false, error: "internal: <text>",
  results: {} }`, the text capped at 500 characters (XSEC-14).
- **NAV-4:** the Page Host follows a navigate only to its own origin. An
  address on another origin is opened in a new tab by the panel's controller.
  "Shown where it leads and confirmed" is done in the row itself: such a row
  shows the host and a "new tab" cue, and the click is the confirmation. A
  separate confirmation dialog is not built.
- **Commands are ignored while edit mode is off**, except save, which reaches
  the session and is refused there as a stale selection (HST-36).
- **XD7 (no fetch for an unsupported descriptor protocol)** needs the page
  descriptor, which is M9. XD8 is built against the configuration's protocol.

## Relay (M6)

- **Sender checks (RLY-45), partly.** A command is accepted only from one of
  the Extension's own pages, and an announcement only from a page script. "An
  announcement only from a tab whose Site is On" is **not** checked: it needs
  an asynchronous permission lookup, and `selection-opened` must open the panel
  without awaiting anything (RLY-13). The Page Host's own Gate already sends
  nothing from a Site that is not Listed.
- **Commands name their tab (RLY-44)**; one that names none goes to the tab of
  the most recent Selection (save, navigate) or Hidden list (flash,
  open-hidden).
- **The panel-ready reply** is `{ tab, site?, selection }` or `null`, i.e. the
  stashed Selection wrapped with where it came from.
- **Values and usages that arrived with the error flag are relayed but not
  attached** to the stash: a panel seeded later should re-read, not be told
  there are none.
- **Stash bound (RLY-42):** when a tab's stash exceeds 256 kB of JSON its
  attached values and usages are dropped.
- **A tab's stash is dropped** when the tab closes, or starts loading a page on
  another Site (or one whose address is not disclosed). A reload on the same
  Site keeps it (ARC-42).
- **Restore:** read once at construction. Per tab, what this Worker heard wins
  field by field; a new Selection replaces a stored one whole. A tab dropped
  before the read finished stays dropped. Writes wait for the read, so a
  partial stash never overwrites a previous Worker's.

## Panel (M7)

- **The view repaints explicitly** after each driver call and each Editor
  action instead of subscribing to the store, so which of the two repaints
  runs is decided in one visible place.
- **Field edits are pushed to the store as they happen**, like value edits,
  and harvesting still runs before every full repaint. Harvesting skips a
  control that shows what the store already holds, so it can never turn
  something the Editor did not type into a change.
- **A Select whose stored value is not one of its options** gets that value as
  an extra option, so showing a row never changes it.
- **Required markers are updated by the guard repaint** as well as the tag
  errors and conflict notices, so choosing a value clears "Required" without
  rebuilding the row.
- **A message for a key that is not open is not logged either**: the log pane
  is on screen (PV-69).
- **Accessibility folded in:** accessible names with the Locale (XA11Y-1), the
  status as a live region, polite or assertive by kind (XA11Y-4), inline
  errors and conflict notices tied to their control with `aria-describedby`
  and `aria-invalid` (XA11Y-5), a text cue on the Current Locale's row
  (XA11Y-7).
- **Light and dark tokens** are both defined (`static/tokens.css`), following
  the browser, because it is one media query once the rules use tokens.

## Bootstraps and end to end (M8)

- **Each context has a `start.ts`** that takes the browser API as a parameter
  and a three-line `main.ts` that passes `chrome`. The wiring is unit tested
  with fakes; only `main.ts` names the global.
- **The end-to-end suite** runs the built Extension in Playwright's Chromium
  against a fixture website on the real Core server. Its three documented
  workarounds are the specification's (XTST-8): the test build
  (`dist-e2e`) holds `http://localhost/*` at install; the panel document is
  loaded in a tab; the test writes what the Popup would store.
- **The stopped Worker** is stopped through the DevTools protocol
  (`ServiceWorker.stopAllWorkers`) and observed through the same protocol:
  the save must succeed and the Worker must be seen going from `stopped` to
  `running` after it. The test runner's own handle on the Worker does not
  survive the stop, so extension APIs are called from the panel document.
- **Not covered by any automated test:** the browser's permission prompt, the
  real Side Panel opening inside the click's gesture, and the Popup rendered
  by the browser. These need a person; see the readme's manual check.
- **Cookies are per host, not per port.** Two Sites on one host and different
  ports share the Toggle cookie. The Gate and the registration still keep the
  Page Host to the exact origin (EE4 proves it), but the second port's website
  will mark its pages for that Editor.

## Deferred (specified, deliberately not built)

- **M9:** page descriptor and discovery (DSC), the checklist Popup
  (POP-30…42 except POP-34), badge, capabilities, retry and revalidation,
  not-signed-in detection, Site records.
- **M10:** Selection restored after a reload (HST-40…42), drafts across a
  closed panel (PV-123), the unsaved-keys list, MSP-22 (the panel's own save
  time limit), MSP-23 (snapshot).
- **M11:** the rest of accessibility, localisation, automated accessibility
  and visual checks.
- **M12+:** direct channel, the panel following the active tab (RLY-43: a
  panel in another window currently shows whichever tab was clicked last),
  page bridge, arrive and locate, per-row save state, page inventory, options
  page, commands, context menu, support bundle, live preview, screenshots,
  header Toggle, split Page Host and budgets, second browser family,
  hostile-page suite and threat model.

## A reason and a way to sign in (XA1)

- **One place sees every answer.** The Page Host wraps the request function it
  gives the Core's client and uses for the configuration. A `401` sets the
  sign-in state to *not signed in* with the descriptor, a `403` whose code is
  `forbidden` to *not permitted* with the help text, and any successful answer
  to *accepted*. A `403` with another code (`forbidden-origin`) is about the
  request and changes nothing. Bodies are read from a copy.
- **The state is a member of the page status**, `signIn`, so the Worker
  stashes it with the rest and the Popup reads it from the stash in the
  session area. The Popup still sends no message.
- **The panel gets its own message, `sign-in-changed`,** relayed only when the
  sign-in part of a status changes, so a busy page's scans do not repaint the
  panel. Once a Selection is shown, the panel follows only that tab.
- **Every receiver validates** the state with the Core's
  `readSignInDescriptor` and `readHelpText`. The Editor's name is accepted
  only when it passes the help-text rule (one short line).
- **Coming back** is the page's `visibilitychange` to visible, while edit mode
  is on and the state is *not signed in*. The listener is added when edit mode
  starts on the page and removed when it is switched off.
- **The reload after signing in** happens on the change from *not signed in*
  to *accepted* when the last scan found no Markers (or no scan finished). It
  is tied to the change, not to a page load, so it cannot loop and needs no
  guard in the tab's session storage.
- **Credentials.** A `401` whose descriptor asks for credentials is repeated
  once with `credentials: "include"`, and every later request of the page load
  includes them.
- **Help text after a `401` without a sign-in address** is still shown under
  "This website refused the request."
- **End to end**, `e2e/sign-in.spec.ts` runs against a fixture website with a
  login for Editors. The test browser never hides a background tab, so the
  test sends the page the `visibilitychange` a real tab switch would.
