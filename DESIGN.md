# Design

What the Extension's own pages look like, and why. It covers the Side Panel and
the Popup — the two surfaces the Extension owns — plus the outline the
highlighter draws on a website's page.

Rules use token names, never literal values. The tokens live in
[`static/tokens.css`](static/tokens.css); the Core keeps a copy for its
Storybook panel in `core/src/panel-style.ts`, and the two must be changed
together.

## The one rule

**Nothing on screen may claim more than the wire contract knows.**

A translation has no status, no approval state, no reviewer and no author.
Those are things a website's own Schema may add, under names its Developer
chooses; they are never built in. The complete list of what the panel can say
about a Locale:

| Signal | Where it comes from |
| --- | --- |
| on this page | `selection.locale` |
| source language | `sourceLocale` — a plain editable row, not a privileged one |
| edited | `dirty.locales` |
| empty | `draft[locale].value === ""` — normal, never an error |
| required empty | `requiredErrors` — blocks the save |
| tags do not match | `tagErrors` — blocks the save |
| changed elsewhere | `conflicts` |
| Shared | `shared`, i.e. `isSharedKey()` — a key starting `shared` |
| orphan | `meta.orphan` |

Nine. Anything a mockup or a rule adds beyond these is an invention, and the
reason this document opens with the list.

Two consequences worth stating, because both have been got wrong:

- **The Source Locale is editable.** It is the Locale whose wording lives in
  the website's code, not a locked reference. The only thing that is read-only
  is `meta.sourceMessage`, which is key metadata, not a translation.
- **`required` can only apply to a Field.** `TextField`, `TextareaField` and
  `SelectField` take it; `ReadonlyField` and `valueField` do not. So an empty
  translation is never an error, and "empty" is never red.

## Three sections

The panel answers three questions, and each gets a tab:

```
Translation      the key that is open
Page        9    everything the page is holding
Log              what each step actually did
```

- **The bar is the only navigation.** No section is stacked below another, and
  nothing scrolls off the bottom to be found by accident.
- **The count on Page is the scan's**, not a filter's: how many Markers the last
  scan found. It is absent before the first scan.
- **Opening a translation brings Translation forward.** A click on the page, or
  on a Page row, is a statement about what the Editor wants to look at.
- **A failure marks the Log tab; it never switches to it.** A failed save is
  read beside the draft that caused it. Reading the Log clears the mark.
- **The Page list keeps its place.** Its search, scope and order are about the
  page, so a key opening does not reset them — unlike the Translation toolbar's
  search and Field filters, which are about one key.

The bar is one stop in the Tab order: the arrows move inside it.

### The Page tab

One row per Marker, in document order, in two groups: **Visible on the page**
and **Not visible** (the translations that live in an attribute). A row carries
the text the page is showing, its key, and only what is already known:

| On a row | Where it comes from |
| --- | --- |
| text, or `—` | the scan |
| key | the scan |
| `Shared` | `isSharedKey(key)` |
| `aria-label`, `placeholder`, … | the scan |
| violet dot | `PanelState.unsavedKeys` |

Pointing at a row finds it on the page: a Hidden translation is flashed,
because it has nothing to look at; a visible one is already outlined, so it is
only brought into view. Clicking a row opens it exactly as a click on the page
would.

**What the Page tab deliberately does not show.** The design board carried a
`3/5` coverage count, an `orphan` badge and a `Missing` scope. All three need
the stored row of every key on the page, and the contract has one values
endpoint per key: showing them would mean a request per Marker on every scan.
They stay out until a bulk read exists.

## Anatomy

The Translation tab is the same five blocks in the same order. Blocks 1, 2
and 5 never vary. What the Schema changes is listed beside blocks 3 and 4 and
nowhere else.

```
1  KEY           sourceMessage · key · Shared · Used on · description
2  SECTION       "Translations"            6 languages · 2 empty
3  TOOLBAR       (a) search      — only with toolbar.search
                 (b) languages   — always
                 (c) field pills — only with toolbar.filters
4  LANGUAGES     one group per Locale
5  FOOTER        Cancel · Save all · status
```

Block 3 is one stack of rows in a fixed order; a row is absent when the
configuration did not ask for it. Row (b) is always present, so the block is
never empty — which is why `shouldRenderToolbar()` no longer gates the whole
toolbar, only rows (a) and (c).

### One group per language

A Locale's label sits **above** its group, as text, not inside it:

```
Danish  da  [on this page]                     edited
┌───────────────────────────────────────────┐
│ Gem alle ændringer i din indkøbskurv      │  the translation, 14px
├───────────────────────────────────────────┤
│ Workflow * │ With legal              ▾    │  a select Field
├───────────────────────────────────────────┤
│ Glossary   │ cart = indkøbskurv           │  a text Field
├───────────────────────────────────────────┤
│ Char limit │ 36 — set by the design system │  a readonly Field
└───────────────────────────────────────────┘
```

One border, one focus ring, one error colour per Locale. The translation is the
only thing at reading size; a Field's label is an addon on the left of its own
row rather than a block above it, which is what makes a Schema of four Fields
across six Locales readable at 360px instead of 48 stacked labelled controls.

**With no Fields the group holds one input, so the group's border *is* the
input's border.** Same template, nothing to group.

The border belongs to the thing you type in. Earlier drafts removed field
borders to reduce boxiness and made the panel unreadable: a borderless input
inside a bordered container reads as a card of text. The rule that came out of
it: **a box around a container is decoration and comes off; a box around an
input is an affordance and stays.** It is also WCAG 1.4.11 — an input's border
needs 3:1 against its background, which `--border-input` meets and a tint
alone does not.

### Field treatments

| Schema | Drawn as |
| --- | --- |
| `valueField` | The hero input or textarea, 14px, top of the group |
| `text` | Labelled row, label as a left addon, 12px input |
| `textarea` | The same, two rows, grows |
| `select` | The same row, a real dropdown. Option labels verbatim, never recoloured |
| `readonly` | Text on a tinted row. Never an input: it is never written |
| `required` | An asterisk on the label, and a sentence naming the consequence |
| no Fields | The group degenerates to one input |

A `select` is drawn with no semantics. `Workflow: With legal` is a field label
and an option label; the panel does not know that "With legal" is worse than
"Signed off", so it never colours one differently from the other.

### The language picker

Which Locales are shown is the Editor's choice, not the Developer's, so the
picker is always present — unlike `toolbar.filters`, which needs a declared
`select` Field. It is a trigger plus a popover of checkboxes, with quick sets
for All, None, Empty and Edited, each derivable from state.

**The Locale on the page can never be hidden.** `visibleLocales()` returns it
unconditionally, so its checkbox is checked and disabled rather than silently
ignoring a click, and "None" is labelled as leaving that one Locale. Hiding
composes by intersection with search and Field filters, and `hiddenErrors()`
already names what a filter is hiding, so a filter can never leave a disabled
Save button with no cause on screen.

## Tokens

### Colour

A neutral ground, near-black for the one primary action, and a single accent.

| Token | Light | Use |
| --- | --- | --- |
| `--surface` | `#ffffff` | The page, and an input's ground |
| `--surface-raised` | `#fafafa` | Addon rows, readonly rows, footers |
| `--surface-sunken` | `#f4f4f5` | Segmented controls, count badges |
| `--border` | `#e4e4e7` | Hairlines inside a group, dividers |
| `--border-input` | `#d4d4d8` | A group's own border. 3:1 — an affordance |
| `--text` | `#18181b` | Translations, language names, primary button ground |
| `--text-muted` | `#52525b` | Labels, field inputs, metadata |
| `--text-subtle` | `#6b6b75` | Section captions, codes, hints. The lightest grey allowed |
| `--text-inverse` | `#fafafa` | On the primary button |
| `--accent` | `#8b5cf6` | Focus, the Locale on the page, the page outline |
| `--accent-strong` | `#5b21b6` | Accent text. 8.6:1 |
| `--accent-tint` | `#f5f3ff` | The current Locale's label chip, Shared |
| `--accent-ring` | `#ede9fe` | The 3px focus ring |
| `--accent-border` | `#a78bfa` | A focused group's border |
| `--danger` | `#dc2626` | Blocks the save |
| `--danger-text` | `#991b1b` | Its words |
| `--danger-tint` | `#fef2f2` | Its row |
| `--warning` | `#ca8a04` | Changed elsewhere, and only that |
| `--success` | `#16a34a` | A completed save, and only that |

`--text-subtle` is the lightest grey allowed on text, and it is chosen so it
holds on the darkest of those grounds: `#71717a` reads 4.40:1 on
`--surface-sunken` and fails, `#6b6b75` reads 4.79:1 and passes. `#a1a1aa`,
used for 10px captions in early drafts, fails everywhere at 2.6:1.

### Type

| Size | Weight | What |
| --- | --- | --- |
| 15px | 600 | `sourceMessage`, or the key when there is none |
| 14px | 400 | The translation itself |
| 13px | 600 | A language name |
| 13px | 400 | Controls and list rows |
| 12px | 400 | Schema Field inputs |
| 11px | 400 | Labels, hints, metadata |
| mono | 400 | Keys and Locale codes |

Inter where available, the system stack otherwise. A mono stack for keys and
Locale codes, because both are identifiers an Editor copies and compares.

Language names are **not** in the wire contract — it carries Locale codes only.
`Intl.DisplayNames` turns `da` into "Danish" in the panel, with the code kept
beside the name and used as the fallback when the browser has no name for it.
No Core change and no network.

### Metrics

| Token | Value |
| --- | --- |
| Panel width | `360px`, the Chrome default |
| `--control-height` | `32px` |
| Translation input | `38px` |
| Field row | `32px`, readonly row `28px` |
| Field label addon | `86px` |
| `--radius-group` | `8px` |
| `--radius-control` | `6px` |
| Gutter | `14px` |
| Focus ring | `3px` `--accent-ring` |

## The colour budget

Four colours carry meaning, and nothing else does:

- **Accent** — focus, the Locale on the page, and the outline on the website.
  Spent on one thing at a time.
- **Danger** — only what stops a save: `requiredErrors`, `tagErrors`. Not
  "empty".
- **Warning** — only `conflicts`.
- **Success** — only a finished save.

**Colour is never the only signal.** Every coloured state carries a word, and
where a glyph is used it differs in shape as well as hue.

## The outline on the page

The highlighter's outline uses the same accent as the panel, so the one thing
an Editor sees on the website matches the tool editing it:

```
2px solid   --accent         a marked translation
3px solid   --accent         while Alt is held
2px dashed  --accent         an attribute-only translation
2px solid   --accent-strong  the translation open in the panel
3px solid   --accent-strong  a flash, while a Page row is pointed at
```

One hue in two weights: `highlight` is `--accent`, `active` is
`--accent-strong`. These are the Core's `DEFAULT_COLORS`, so a website that
configures nothing already matches the panel beside it.

**A website may use its own brand instead**, through `colors` in its
configuration — both outlines are the website's to set, and the panel's accent
does not follow. That is deliberate: the outline is drawn on someone else's
page, and the panel is the tool's own surface.

## Accessibility

- Text 4.5:1, including 11px greys. An input's border 3:1 (WCAG 1.4.11).
- A real `<button>`, `<a href>`, `<input>` and `<label>` for everything
  interactive. Never a `role` on a `div`.
- `aria-label` on an icon-only button; `aria-hidden="true"` on a decorative
  glyph, `role="img"` with a label on one that carries meaning.
- `aria-invalid` on a control whose Locale has an error, and the error named by
  `aria-describedby`.
- A disabled Save always has a visible cause, including when the cause is in a
  Locale the toolbar is hiding.
- `prefers-color-scheme: dark` redefines the tokens and nothing else.

## Not in the design system

Three things were drawn during design and removed for being inventions. They
are listed so they are not drawn again:

- **A translation status.** No approval, review or sign-off state exists. A
  website may add a `select` Field that resembles one; it is that website's
  Field, rendered with no meaning attached.
- **A read-only source row.** Every Locale is editable.
- **A last editor, author or timestamp per Locale.** Not in the contract.

Also removed: a second row-hiding mechanism. Collapsing rows "to save space"
alongside the toolbar hiding them looked identical and meant different things.
The toolbar hides rows; nothing else does.

## State of the work

Landed:

- The token file, the five-block anatomy, the group, the Field treatments and
  the Locale label line.
- The accent outline, as the Core's `DEFAULT_COLORS`. It reaches a website
  when the Core is released: the Extension depends on a published version, so
  until then a website matches by setting `colors` itself.
- The three tabs and the Page list. The inventory needed no Core change: the
  Page Host already sees every scan through `onScan`, so it publishes the whole
  list itself as `page-markers`. `PanelState.hidden` still carries the Core's
  Hidden subset and stands in until the first scan is reported.

Not landed yet:

- **Per-Site memory for the language picker.** The chosen set lives for the
  panel's lifetime only.
- **A bulk values read**, which is what the Page tab's coverage count and orphan
  mark are waiting on.
