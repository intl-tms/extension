# Intl TMS — the Extension

> [!WARNING]
> **Under active development. Do not use in production.**
> The Extension holds no credential: a website decides who may edit through
> its own login for Editors and the `authorize` check its developers build.
> Use the Extension on local and test websites only.

Documentation: <https://intl-tms.github.io/docs/> ·
Privacy: <https://intl-tms.github.io/docs/privacy>

A Chrome extension for editing a website's translations directly on the page.
Switch it on for a website, hold Alt and click any outlined text, edit it in
every language in the side panel, and save. Nothing is deployed and no other visitor sees
anything.

It is a Host of [`@intl-tms/core`](https://github.com/intl-tms/core): the Core owns the editing logic,
and the Extension owns what only a browser extension can do. The specification
is in `specs/extension-spec/`; choices made while building are in
[DECISIONS.md](DECISIONS.md).

## Editor's guide

### Install

1. Build the extension (see [Development](#development)), or get the `dist`
   folder from someone who has.
2. Open `chrome://extensions`, switch on **Developer mode**, choose **Load
   unpacked** and pick the `dist` folder.
3. Pin **Intl TMS** to the toolbar so its icon is always there.

The extension starts with access to no website at all. It does nothing on any
site until you switch it on there.

### Switch it on

1. Open the website you want to edit.
2. Click the **Intl TMS** icon. The window says `Edit mode on <website>` so you
   can see which website you are switching.
3. Paste the **Config URL** you were given for that website. It is a full
   address beginning with `https://`.
4. Click **On**.

The first time, Chrome asks:

> "Intl TMS" wants to: Read and change your data on *that website*

That is Chrome's standard wording for "this extension may run on this one
website". Click **Allow**. The extension uses it to outline the text on the
page and to save your edits through the website, as you. It is asked once per
website, and only for that website.

The page reloads once, and every piece of translated text gets an outline.

### Sign in

Websites let only their Editors edit, with a login for Editors that your
organisation's IT department manages. If you are not signed in, the popup and
the side panel say `You are not signed in to this website.` and offer **Sign
in**, which opens the website's sign-in page in a new tab. Sign in there with
your work account, then come back to the page: it reloads once by itself and is
outlined. Signing in lasts a working day; after that you are asked again.

`You are signed in, but may not edit translations here.` means your account
does not have permission to edit. Ask whoever manages your access to this
website; the line under it may say who.

While you are signed in, the popup and the panel say `Editing as <your name>`.

### Edit and save

1. Hold **Alt** (**Option** on a Mac) and click any outlined text. The side
   panel opens beside the page with that text in every language. The language
   the page is showing is marked **on this page**.
2. Change what you want, in as many languages as you want.
3. Click **Save all**. The line under the buttons shows a tick for each
   language that was saved, and the page shows the new text.

Things worth knowing:

- A click without Alt is an ordinary click: links, buttons and menus work as
  they always do, so you can move around the website with edit mode on. While
  Alt is held the outlines thicken to show what a click will edit.
- Alt-click a drop-down list to choose which of its options to edit.
- **Cancel** puts everything back to what was loaded.
- If a text contains tags such as `<b>…</b>`, keep them. The panel tells you
  which tag is wrong and will not save until it matches.
- Some text needs the website to rebuild the page before it can be shown
  (anything with tags or placeholders). The page reloads by itself after such
  a save. Alt-click the text again before saving it a second time.
- If someone else changed the same text while you had it open, nothing is
  overwritten. The panel says **changed elsewhere**, shows what is stored now,
  and keeps what you typed. Click **Save all** again to keep yours, or
  **Cancel** to take theirs.
- A **Shared** badge means the text may appear in more than one place.
- Alt-clicking another text does not throw away what you typed for the first
  one: it is there again when you Alt-click that text.

### Text you cannot see

Some translations are not visible on the page: tooltips, labels read by screen
readers, placeholder text. They are listed in the panel under **Hidden on this
page**. Point at a row to see where it is on the page; click the row to edit
it.

### Used on

Under the languages, **Used on** lists the other pages where this text has been
seen. Click a page to go there. A page on a different website opens in a new
tab.

### Switch it off

Click the **Intl TMS** icon and click **Off**. The outlines disappear at once.
The next time the page loads it is exactly what every other visitor sees.

### Withdraw access

Switching Off keeps Chrome's permission, so switching On again does not ask.
To take the permission back: `chrome://extensions` → **Intl TMS** → **Details**
→ **Site access**, and remove the website. Edit mode goes off there at once.

## Troubleshooting

Find what you see, then check the causes in order.

### The On button is greyed out

1. A line under the field says why. `Enter a config URL to enable.`: paste the
   address you were given.
2. `The config URL must be a full address…`: it has to start with `http://` or
   `https://`. A part such as `/api/tms/config` is not enough.
3. `Edit mode cannot be switched on for this tab.`: the tab is not a website
   (a settings page, a new tab, a local file).

### I clicked On and it still shows Off

`The browser has not been given access to this site.` Chrome's question was
closed or answered with a refusal. Click **On** again and choose **Allow**.

### Nothing is outlined

1. Edit mode is not on for this website. Open the popup: it must show **On**
   and name this website. Two addresses that differ only in the port are two
   websites.
2. The website does not mark its text for editing. The Config URL being correct
   does not make a website editable; its developer has to set it up.
3. Cookies are blocked for this website. Edit mode is switched on with a
   cookie. Allow cookies for the site and reload.
4. The page has no translated text on it.

For a developer: when cookies are blocked or the configuration cannot be
loaded, the page's console says why, prefixed `[intl-tms]`.

### The panel says "Could not load other locales"

The panel is showing only the text from the page. Open **Diagnostics** at the
bottom of the panel (it opens by itself when something fails).

1. The Config URL is wrong or the website is down: the page's console has
   `failed to fetch the editing configuration` with the reason.
2. You are signed out of the website. The panel says so at the top: press
   **Sign in**, sign in, come back, and Alt-click the text again.

### Save shows ✗

Open **Diagnostics**. The line after `FAILED` says which:

| It says | What to do |
| --- | --- |
| `The page did not answer…` | Reload the page, Alt-click the text again, and save. |
| `The page no longer holds this translation. Click the text again.` | The page reloaded or changed since you clicked. Alt-click the text again; what you typed is still in the panel. |
| `No translation is selected…` | Alt-click an outlined text on the page first. |
| `The configuration never loaded…` | Check the Config URL in the popup. |
| `da: 401` or `da: 403` | You are not signed in, or may not edit. The line at the top of the panel says which; what you typed is kept, so sign in and save again. |
| `da: 400 …` | The website refused the text; the reason follows the number. |
| `da: the request never reached the server…` | The website is unreachable. Check your connection and try again. |

**Copy** puts the whole log on the clipboard to send to whoever supports the
website.

### Save shows ⚠ changed elsewhere

Not a fault: see [Edit and save](#edit-and-save).

## For the website's developer

For the extension to work, a website must:

- mark its message catalog with the Core's `markCatalog` when the request
  carries the cookie `tms-edit=1`, and not otherwise;
- serve the Core's request handler, whose `/config` address is the Config URL
  an Editor pastes;
- declare each page's language in `<html lang>`, spelled as (or matching, up
  to case and `_`/`-`) one of the configured locales.

It must never cache a marked response for another visitor, and never treat the
cookie as authorization: anyone can set a cookie. Protection is the handler's
`authorize`, built with the Core's `sessionCheck` over a login for Editors on
the same site as the pages. The Extension learns how to sign in from the
handler's refusal: a `401` names the sign-in address, which **Sign in** opens,
and a `403` may carry a help text, shown as plain text.

## Development

```
pnpm install
pnpm test        # unit tests: every logic module through its ports, in a simulated DOM, with the real Core
pnpm typecheck   # strict TypeScript; also runs the type-level protocol test
pnpm lint
pnpm build       # dist/ is a loadable extension
pnpm watch       # rebuild on change, static files included
pnpm test:e2e    # builds dist-e2e/ and runs the real-browser suite (first: pnpm exec playwright install chromium)
```

The Core must be built first (`../core/dist`), since it is linked, not
published.

### Layout

A browser extension is four programs with different lifetimes. Each is a logic
module behind injected ports, a `start.ts` that wires a browser API object to
those ports, and a three-line `main.ts` that passes the real `chrome`.

| Context | Logic | What it does |
| --- | --- | --- |
| Popup | `src/popup/logic.ts`, `view.ts` | Switches edit mode on and off for one Site. Writes settings and asks for a permission; talks to nothing else. |
| Worker | `src/worker/reconcile.ts`, `relay.ts` | Keeps the script registration in step with the Sites that are Listed and Granted; relays messages; opens the panel inside the click. Stopped by the browser when idle, so everything it routes on is persisted. |
| Page Host | `src/page/page-host.ts` | Runs inside an enabled website. The Gate, the Toggle cookie, the configuration, and hosting the Core's editing session. |
| Side Panel | `src/panel/controller.ts`, `view.ts`, `log.ts` | The editing UI: a thin view over the Core's panel store. |
| shared | `src/shared/` | Site helpers, stored value names, the message protocol, the string catalogue: each defined once. |

### Manual check

Three things no automated test can do: answer Chrome's permission prompt, open
the real side panel from a click, and render the popup under the toolbar.
After a change to a bootstrap, the Popup or the manifest, load `dist` and walk
the Editor's guide above once against a website that integrates the Core.

Every change to what ships bumps `version` in `static/manifest.json`: Chrome
keeps running the old Worker and old pages until it sees a new version.

## License

[MIT](./LICENSE)
