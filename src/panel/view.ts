import {
  SHARED_NOTICE,
  conflictNotice,
  createPanelStore,
  explainSaveFailure,
  fieldText,
  hiddenErrors,
  isSharedKey,
  relativeTime,
  resolveToolbarFilters,
  shouldRenderToolbar,
  usagePath,
  visibleLocales,
  type PanelState,
  type PanelWrite,
  type PersistOutcome,
  type ResolvedFilter,
} from "@intl-tms/core/tools";
import type { FieldDef } from "@intl-tms/core";
import { languageName } from "../shared/language.js";
import { editingAs } from "../shared/sign-in.js";
import type { PageMarker } from "../shared/protocol.js";
import { DIAGNOSTICS, PAGE, PANEL, PRODUCT, TABS } from "../shared/strings.js";
import type { PanelCallbacks, PanelDriver } from "./controller.js";
import { createLog, type Log } from "./log.js";

/** What {@link createPanelView} is built from. */
export interface PanelViewOptions {
  /** What the view calls when the Editor acts. */
  callbacks: PanelCallbacks;
  /** The element the view renders straight into. The Side Panel is the Extension's own page, so nothing is isolated. */
  container: HTMLElement;
  /** The diagnostic log. Defaults to a new one. */
  log?: Log;
  /** Where Copy puts the log. Defaults to the browser's clipboard. */
  clipboard?: { writeText(text: string): Promise<void> };
  /** The clock used for "last seen" times. */
  now?: () => number;
  /** The Site of the page being edited, when known, so an address that leads elsewhere can say so. */
  site?: () => string | undefined;
  /**
   * The build that is running, shown beside the product name. An unpacked
   * extension gives no sign that a rebuild was loaded, so without this a stale
   * panel and a fresh one look the same.
   */
  version?: string;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The panel's three sections. */
type TabName = "translation" | "page" | "log";

/** Which of the page's translations the Page list shows. Both are counted from what is already on screen. */
type PageScope = "all" | "unsaved";

/** The order of the Page list: the order the page holds them in, or by key. */
type PageSort = "page" | "key";

const TAB_ORDER: readonly TabName[] = ["translation", "page", "log"];

const VALUE = "value";

/**
 * Creates the panel view and returns its driver.
 *
 * The view is a thin layer over the Core's panel store, which owns the
 * selection, the draft and baseline, the save diff, validation, conflicts, row
 * order and status text. What the view owns is repainting without disturbing
 * someone who is typing: its own state is exactly the toolbar's search text and
 * filter choices, and which control has focus during a repaint.
 *
 * Everything from a website, a store or a configuration is inserted as text,
 * and a control is found by walking the rendered controls and comparing their
 * data, never by composing a selector from a Locale code or a Field name.
 */
export function createPanelView(options: PanelViewOptions): PanelDriver {
  const { callbacks, container } = options;
  const document = container.ownerDocument;
  const log = options.log ?? createLog();
  const now = options.now ?? (() => Date.now());
  let ids = 0;
  const nextId = () => `tms-${++ids}`;

  // View state: never reaches the store, a draft, a save or a validation.
  let search = "";
  let selected: Record<string, string> = {};
  let filters: ResolvedFilter[] = [];
  /**
   * The Locales the Editor chose to see, or undefined for all of them. Unlike
   * the search and the Schema's filters it is NOT cleared when another key
   * opens: an Editor who narrowed to two languages means it for the page they
   * are working through, not for one translation.
   */
  let chosen: Set<string> | undefined;
  let languageSearch = "";
  /** Which section is on screen. The panel's own, and never reset: a key opening is not a reason to leave the Page list. */
  let tab: TabName = "translation";
  /** Something failed while another section was on screen: the Log tab says so until it is read. */
  let flagged = false;
  /** The Page list's own narrowing, which is about the page and so survives a key opening. */
  let pageSearch = "";
  let pageScope: PageScope = "all";
  let pageSort: PageSort = "page";
  /** What the page's last scan found, and where. Empty until a scan is reported. */
  let markers: readonly PageMarker[] = [];
  let markersUrl: string | undefined;

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, role?: string, text?: string): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    if (role !== undefined) created.dataset.role = role;
    if (text !== undefined) created.textContent = text;
    return created;
  }

  // ---------------------------------------------------------------------
  // Saving: the one seam that sees both the store's writes and the reply.
  // ---------------------------------------------------------------------

  // Something failed. The Editor is told where to look rather than being moved
  // there: a failed save is read beside the draft that caused it.
  const failure = () => {
    if (tab === "log") return;
    flagged = true;
    paintTabs();
  };

  async function persist(changes: Record<string, PanelWrite>): Promise<PersistOutcome | undefined> {
    const key = store.getState().selection?.key ?? "";
    log.add("save", DIAGNOSTICS.saveSent(key), JSON.stringify(changes, null, 2));
    let outcome: PersistOutcome | undefined;
    try {
      outcome = await callbacks.save(key, changes);
    } catch (error) {
      log.add("save", DIAGNOSTICS.threw, error instanceof Error ? error.message : String(error));
      failure();
      // The store owns the connection-error status; swallowing the throw would change what the Editor sees.
      throw error;
    }
    const detail = outcome === undefined ? "(no reply)" : JSON.stringify(outcome, null, 2);
    const why = explainSaveFailure(outcome);
    if (outcome?.ok === true) {
      log.add("save", DIAGNOSTICS.saved, detail);
    } else if (why === undefined) {
      // A Write conflict is the website's answer, shown beside the draft. It is not a failure.
      log.add("save", DIAGNOSTICS.refused, detail);
    } else {
      log.add("save", DIAGNOSTICS.failed, detail);
      log.add("why", why);
      failure();
    }
    return outcome;
  }

  const store = createPanelStore({ persist });

  // ---------------------------------------------------------------------
  // Skeleton: built once. Repaints fill it.
  // ---------------------------------------------------------------------

  const header = element("header");
  header.className = "panel-header";
  const editingAsLine = element("p", "editing-as");
  editingAsLine.className = "editing-as";
  editingAsLine.hidden = true;
  const heading = element("h1", undefined, PRODUCT.name);
  if (options.version !== undefined) heading.append(element("span", "version", options.version));
  header.append(heading, editingAsLine);

  /*
   * The tab bar. Three buttons and three panes: a tab is a disclosure that
   * remembers, so the panel can be scrolled to a Field without losing the Page
   * list's place, and nothing is ever stacked below the editor off screen.
   */
  const tabs = element("div", "tabs");
  tabs.className = "tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", TABS.label);

  function buildTab(name: TabName, label: string): HTMLButtonElement {
    const button = element("button", "tab");
    button.type = "button";
    button.className = "tab";
    button.id = nextId();
    button.dataset.tab = name;
    button.setAttribute("role", "tab");
    button.append(element("span", "tab-label", label));
    button.addEventListener("click", () => show(name));
    return button;
  }

  const translationTab = buildTab("translation", TABS.translation);
  const pageTab = buildTab("page", TABS.page);
  // How many translations the page is holding: the one number the bar carries.
  const pageTabCount = element("span", "tab-count");
  pageTabCount.className = "tab-count";
  pageTabCount.hidden = true;
  pageTab.append(pageTabCount);
  const logTab = buildTab("log", TABS.log);
  tabs.append(translationTab, pageTab, logTab);

  // A tablist is one stop: the arrows move between the tabs, not the Tab key.
  tabs.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TAB_ORDER[(TAB_ORDER.indexOf(tab) + step + TAB_ORDER.length) % TAB_ORDER.length];
    if (next === undefined) return;
    show(next);
    buttonOf(next).focus();
  });

  const editor = element("section", "editor");
  editor.className = "editor";
  const placeholder = element("p", "placeholder", PANEL.placeholder);
  placeholder.className = "placeholder";
  const selection = element("div", "selection");
  selection.hidden = true;

  const title = element("h2", "title");
  // The key and what is true of the key share one line, and wrap together.
  const keyLine = element("div", "key-line");
  keyLine.className = "key-line";
  const key = element("code", "key");
  const sharedBadge = element("span", "shared-badge", PANEL.sharedBadge);
  sharedBadge.hidden = true;
  keyLine.append(key, sharedBadge);

  // Two quiet asides under the key: why it is Shared, and what the Developer said about it.
  const sharedNotice = element("p", "shared-notice", SHARED_NOTICE);
  sharedNotice.className = "aside";
  sharedNotice.hidden = true;
  const description = element("p", "description");
  description.className = "aside";
  description.hidden = true;
  // Names the editable part and counts it, so the rows below are never a bare list.
  const section = element("div", "section");
  section.className = "section";
  const sectionCount = element("span", "locale-count");
  section.append(element("h3", undefined, PANEL.translationsTitle), sectionCount);

  /*
   * Which Locales are shown. Built once and refilled, like the rows: it is a
   * native disclosure so the keyboard and the Escape key work without a line
   * of positioning code.
   */
  const picker = element("details", "picker");
  picker.className = "picker";
  const pickerTrigger = element("summary", "picker-trigger");
  pickerTrigger.className = "picker-trigger";
  const pickerCount = element("span", "picker-count");
  pickerTrigger.append(element("span", "picker-title", PANEL.languages), pickerCount);
  const pickerSearch = element("input", "picker-search");
  pickerSearch.type = "search";
  pickerSearch.placeholder = PANEL.languagesSearch;
  pickerSearch.setAttribute("aria-label", PANEL.languagesSearchLabel);
  const pickerSets = element("div", "picker-sets");
  pickerSets.className = "picker-sets";
  const pickerList = element("div", "picker-list");
  pickerList.className = "picker-list";
  const pickerSummary = element("p", "picker-summary");
  pickerSummary.className = "picker-foot";
  const pickerBody = element("div");
  pickerBody.className = "picker-body";
  pickerBody.append(pickerSearch, pickerSets, pickerList, pickerSummary);
  picker.append(pickerTrigger, pickerBody);

  pickerSearch.addEventListener("input", () => {
    languageSearch = pickerSearch.value;
    paintPicker();
  });

  /** Closes the list and forgets what was typed into it: it narrows the list, not the panel. */
  function closePicker(): void {
    if (!picker.open) return;
    picker.open = false;
    languageSearch = "";
    pickerSearch.value = "";
    paintPicker();
  }

  // A disclosure stays open until its own summary is clicked again, which is
  // wrong for something that floats over the rows: a click anywhere else means
  // the Editor is done with it. Captured, so a handler that stops propagation
  // cannot leave the list hanging open.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (target instanceof Node && picker.contains(target)) return;
      closePicker();
    },
    true,
  );

  // Escape is a dialog's, not a disclosure's, so it is wired by hand. Focus
  // goes back to the trigger, or it would be left on a removed element.
  picker.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !picker.open) return;
    event.stopPropagation();
    closePicker();
    pickerTrigger.focus();
  });

  const toolbar = element("div", "toolbar");
  toolbar.className = "toolbar";
  const toolbarHint = element("p", "toolbar-hint");
  toolbarHint.className = "hint";
  const rows = element("div", "rows");
  rows.className = "rows";

  const actions = element("div");
  actions.className = "actions";
  const saveButton = element("button", "save", PANEL.save);
  saveButton.type = "button";
  saveButton.className = "primary";
  const cancelButton = element("button", "cancel", PANEL.cancel);
  cancelButton.type = "button";
  // Cancel first, Save last: the order they are read in is the order they are reached in.
  actions.append(cancelButton, saveButton);

  const status = element("p", "status");
  status.className = "status";
  status.setAttribute("role", "status");

  const usedOn = element("section", "used-on");
  usedOn.className = "used-on";
  const usedOnBody = element("div", "used-on-body");
  usedOn.append(element("h3", undefined, PANEL.usedOnTitle), usedOnBody);

  selection.append(title, keyLine, sharedNotice, description, section, toolbar, toolbarHint, rows, actions, status, usedOn);
  editor.append(placeholder, selection);

  /*
   * The Page pane: the address being edited, what to show of it, and one row
   * per Marker. Everything in it is derived from the scan and from the panel's
   * own drafts, so it costs no request and can never be out of step with the
   * page.
   */
  const page = element("section", "page");
  page.className = "page";

  const pageHead = element("div");
  pageHead.className = "page-head";
  const pageUrl = element("code", "page-url");
  pageUrl.className = "page-url";
  pageUrl.setAttribute("aria-label", PAGE.urlLabel);
  const pageUnsaved = element("span", "page-unsaved");
  pageUnsaved.className = "page-unsaved";
  pageUnsaved.hidden = true;
  pageHead.append(pageUrl, pageUnsaved);

  const pageTools = element("div");
  pageTools.className = "page-tools";
  const pageScopes = element("div", "page-scopes");
  pageScopes.className = "page-scopes";
  pageScopes.setAttribute("role", "group");
  pageScopes.setAttribute("aria-label", PAGE.scopeLabel);

  function buildScope(name: PageScope): HTMLButtonElement {
    const button = element("button", "page-scope");
    button.type = "button";
    button.className = "page-scope";
    button.dataset.scope = name;
    button.addEventListener("click", () => {
      pageScope = name;
      paintPage();
    });
    return button;
  }

  const scopeAll = buildScope("all");
  const scopeUnsaved = buildScope("unsaved");
  pageScopes.append(scopeAll, scopeUnsaved);

  // One bordered group: a box to type in, and the order as its trailing addon.
  const pageFind = element("div");
  pageFind.className = "page-find";
  const pageSearchBox = element("input", "page-search");
  pageSearchBox.type = "search";
  pageSearchBox.placeholder = PAGE.searchPlaceholder;
  pageSearchBox.setAttribute("aria-label", PAGE.searchLabel);
  pageSearchBox.addEventListener("input", () => {
    pageSearch = pageSearchBox.value;
    paintPage();
  });
  const pageSortBox = element("select", "page-sort");
  pageSortBox.className = "page-sort";
  pageSortBox.setAttribute("aria-label", PAGE.sortLabel);
  for (const [value, label] of [
    ["page", PAGE.sortPage],
    ["key", PAGE.sortKey],
  ] as [PageSort, string][]) {
    const option = element("option", undefined, label);
    option.value = value;
    pageSortBox.append(option);
  }
  pageSortBox.addEventListener("change", () => {
    pageSort = pageSortBox.value === "key" ? "key" : "page";
    paintPage();
  });
  pageFind.append(pageSearchBox, pageSortBox);
  pageTools.append(pageScopes, pageFind);

  const pageList = element("div", "page-list");
  pageList.className = "page-list";
  const pageFoot = element("p", "page-foot", PAGE.footer);
  pageFoot.className = "page-foot";
  page.append(pageHead, pageTools, pageList, pageFoot);

  const logSection = element("section", "diagnostics");
  logSection.className = "log-pane";
  const copyButton = element("button", "copy", DIAGNOSTICS.copy);
  copyButton.type = "button";
  const clearButton = element("button", "clear", DIAGNOSTICS.clear);
  clearButton.type = "button";
  const logButtons = element("div");
  logButtons.className = "log-actions";
  logButtons.append(copyButton, clearButton);
  const logPane = element("pre", "log");
  logPane.tabIndex = 0;
  logSection.append(logButtons, logPane);

  const panes: readonly [TabName, HTMLElement][] = [
    ["translation", editor],
    ["page", page],
    ["log", logSection],
  ];
  const buttons: readonly [TabName, HTMLButtonElement][] = [
    ["translation", translationTab],
    ["page", pageTab],
    ["log", logTab],
  ];
  const buttonOf = (name: TabName): HTMLButtonElement => buttons.find(([candidate]) => candidate === name)?.[1] ?? translationTab;

  for (const [name, pane] of panes) {
    pane.id = nextId();
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", buttonOf(name).id);
    buttonOf(name).setAttribute("aria-controls", pane.id);
  }

  /** Brings a section on screen. Reading the Log is what clears its mark. */
  function show(next: TabName): void {
    tab = next;
    if (next === "log") flagged = false;
    paintTabs();
    // The Page list counts drafts, which change on every keystroke: it is built
    // when it comes on screen rather than under the Editor's hands.
    if (next === "page") paintPage();
  }

  /** Which tab is current, which pane is on screen, and the two things the bar counts. */
  function paintTabs(): void {
    for (const [name, button] of buttons) {
      const current = name === tab;
      button.dataset.current = String(current);
      button.setAttribute("aria-selected", String(current));
      // A tablist is one stop in the Tab order; the arrows move inside it.
      button.tabIndex = current ? 0 : -1;
    }
    logTab.dataset.flagged = String(flagged);
    if (flagged) logTab.title = TABS.logFlagged;
    else logTab.removeAttribute("title");
    for (const [name, pane] of panes) pane.hidden = name !== tab;
  }

  container.replaceChildren(header, tabs, editor, page, logSection);

  // ---------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------

  const controls = (): Control[] => [...rows.querySelectorAll<Control>('[data-role="control"]')];
  const findControl = (locale: string, column: string) => controls().find((control) => control.dataset.locale === locale && control.dataset.column === column);

  /**
   * Pushes every rendered control into the store. The store is the single
   * source of truth and the rendered controls are only its visible slice, so
   * this runs before any repaint that could otherwise drop typed text. A
   * control that shows what the store already holds is left alone: harvesting
   * must never turn something the Editor did not type into an edit.
   */
  function harvest(): void {
    for (const control of controls()) {
      const { locale, column } = control.dataset;
      if (locale === undefined || column === undefined) continue;
      if (control.value === fieldText(store.getState().draft[locale]?.[column])) continue;
      if (column === VALUE) store.editValue(locale, control.value);
      else store.editField(locale, column, control.value);
    }
  }

  function push(control: Control): void {
    const { locale, column } = control.dataset;
    if (locale === undefined || column === undefined) return;
    if (column === VALUE) store.editValue(locale, control.value);
    else store.editField(locale, column, control.value);
    // Never a full repaint on a keystroke: focus would leave the control mid-word.
    paintGuard();
  }

  function describe(control: Control, ...notes: HTMLElement[]): void {
    control.setAttribute("aria-describedby", notes.map((note) => note.id).join(" "));
  }

  function note(role: string, column: string, className: string): HTMLElement {
    const created = element("p", role);
    created.id = nextId();
    created.dataset.column = column;
    created.className = className;
    created.hidden = true;
    return created;
  }

  function fieldControl(field: Exclude<FieldDef, { type: "readonly" }>, text: string): Control {
    if (field.type === "select") {
      const select = element("select");
      const none = element("option", undefined, PANEL.selectNone);
      none.value = "";
      select.append(none);
      for (const choice of field.options) {
        const option = element("option", undefined, choice.label);
        option.value = choice.value;
        select.append(option);
      }
      if (text !== "" && !field.options.some((choice) => choice.value === text)) {
        // A stored value outside the declared options is kept, so showing the row never changes it.
        const stray = element("option", undefined, text);
        stray.value = text;
        select.append(stray);
      }
      select.value = text;
      return select;
    }
    if (field.type === "textarea") {
      const area = element("textarea");
      area.rows = 2;
      area.value = text;
      return area;
    }
    const input = element("input");
    input.type = "text";
    input.value = text;
    return input;
  }

  /**
   * One Locale: a label line, then one bordered group holding every control.
   *
   * The label line is outside the group so the group contains nothing but
   * things you type in, which is what lets the group's own border read as the
   * input's border. A Field's label is an addon on the left of its own row
   * rather than a block above it; at 360px that is the difference between a
   * Schema of four Fields being readable and not.
   */
  function buildRow(state: PanelState, locale: string): HTMLElement {
    const draft = state.draft[locale];
    // Shown in words, with the code beside it: the code is what an Editor compares against a configuration.
    const language = languageName(locale);
    const row = element("div", "row");
    row.className = "row";
    row.dataset.locale = locale;
    const current = locale === state.selection?.locale;
    row.dataset.current = String(current);

    const head = element("div");
    head.className = "row-head";
    head.append(element("span", "language", language), element("code", "locale", locale));
    // The Source Locale is marked and nothing more: its row is as editable as any other.
    if (current) head.append(element("span", "current-cue", PANEL.currentLocale));
    else if (locale === state.sourceLocale) head.append(element("span", "source-cue", PANEL.sourceLocale));
    // Both cues are rendered and toggled by the guard, so typing never rebuilds the row.
    const emptyCue = element("span", "empty-cue", PANEL.emptyCue);
    emptyCue.hidden = true;
    const dirtyCue = element("span", "dirty-cue", PANEL.dirtyCue);
    dirtyCue.hidden = true;
    head.append(emptyCue, dirtyCue);
    row.append(head);

    const group = element("div", "group");
    group.className = "group";

    const value = state.schema?.valueField?.type === "textarea" ? element("textarea") : element("input");
    if (value instanceof HTMLTextAreaElement) value.rows = 2;
    else value.type = "text";
    value.value = fieldText(draft?.[VALUE]);
    value.dataset.role = "control";
    value.dataset.locale = locale;
    value.dataset.column = VALUE;
    value.setAttribute("aria-label", PANEL.valueLabel(language));
    // Always rendered, hidden while empty, so they can be filled and cleared in place without rebuilding the row.
    const tagError = note("tag-error", VALUE, "note");
    const valueConflict = note("conflict", VALUE, "note");
    describe(value, tagError, valueConflict);
    group.append(value, tagError, valueConflict);

    for (const field of state.schema?.fields ?? []) {
      const label = field.label ?? field.name;
      const wrap = element("div");
      wrap.className = "field";
      wrap.dataset.type = field.type;
      // The label's own text is a span of its own: the label is a flex row, and
      // a bare text node beside the required mark is a second flex item that
      // shrinks and breaks "Workflow" across two lines.
      const labelText = element("span", "field-label-text", label);
      if (field.type === "readonly") {
        const readonly = element("span", "field-label");
        readonly.append(labelText);
        // No control and no box: a Read-only Field is never written, so an input
        // would be a lie. A key the website has nothing to say about gets a dash
        // rather than a labelled blank, which reads as something failing to load.
        const shown = fieldText(draft?.[field.name]);
        wrap.append(readonly, element("div", "readonly", shown === "" ? PANEL.emptyValue : shown));
        group.append(wrap);
        continue;
      }
      const labelElement = element("label", "field-label");
      labelElement.append(labelText);
      if (field.required === true) {
        const mark = element("span", "required-mark", PANEL.requiredMark);
        mark.setAttribute("aria-label", PANEL.requiredMarkLabel);
        labelElement.append(mark);
      }
      const control = fieldControl(field, fieldText(draft?.[field.name]));
      control.id = nextId();
      labelElement.htmlFor = control.id;
      control.dataset.role = "control";
      control.dataset.locale = locale;
      control.dataset.column = field.name;
      control.setAttribute("aria-label", PANEL.fieldLabel(language, label));
      const required = note("required", field.name, "note");
      required.textContent = PANEL.required;
      const conflict = note("conflict", field.name, "note");
      describe(control, required, conflict);
      wrap.append(labelElement, control);
      // The notes are full-width strips under the Field's row, inside the same border.
      group.append(wrap, required, conflict);
    }

    row.append(group);
    return row;
  }

  /**
   * The Locales on screen: what the Core's search and Schema filters leave,
   * narrowed to the Editor's chosen set. The Current Locale survives both —
   * `visibleLocales` returns it unconditionally and the intersection keeps it,
   * so "None" means "only the language on this page", never an empty panel.
   */
  const visible = (state: PanelState): string[] => {
    const shown = visibleLocales({ order: state.rowOrder, current: state.selection?.locale, rows: state.draft, search, selected, filters });
    if (chosen === undefined) return shown;
    const current = state.selection?.locale;
    return shown.filter((locale) => locale === current || chosen?.has(locale) === true);
  };

  /** Whether a Locale's box is ticked: everything is, until the Editor narrows it. */
  const isChosen = (locale: string, current: string | undefined) => locale === current || chosen === undefined || chosen.has(locale);
  const isEmptyValue = (state: PanelState, locale: string) => fieldText(state.draft[locale]?.[VALUE]) === "";

  /** Rebuilds the rows from the store, keeping focus and the caret where the Editor had them. */
  function paintRows(): void {
    const state = store.getState();
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && rows.contains(active) && active.dataset.role === "control"
        ? {
            locale: active.dataset.locale,
            column: active.dataset.column,
            start: "selectionStart" in active ? (active as HTMLInputElement).selectionStart : null,
            end: "selectionEnd" in active ? (active as HTMLInputElement).selectionEnd : null,
          }
        : undefined;

    rows.replaceChildren(...visible(state).map((locale) => buildRow(state, locale)));

    // Focus is restored, never taken: nothing happens when nothing in the rows had it.
    if (focused?.locale !== undefined && focused.column !== undefined) {
      const again = findControl(focused.locale, focused.column);
      if (again !== undefined) {
        again.focus();
        if (focused.start !== null && focused.end !== null && !(again instanceof HTMLSelectElement)) {
          try {
            again.setSelectionRange(focused.start, focused.end);
          } catch {
            // The control type has no caret.
          }
        }
      }
    }
    paintGuard();
    paintPicker();
  }

  /** Updates the Save button, the inline errors, the conflict notices and the toolbar hint. Touches no input's value. */
  function paintGuard(): void {
    const state = store.getState();
    const fields = state.schema?.fields ?? [];
    saveButton.disabled = state.saving || Object.keys(state.requiredErrors).length > 0 || Object.keys(state.tagErrors).length > 0;

    for (const row of rows.children) {
      if (!(row instanceof HTMLElement)) continue;
      const locale = row.dataset.locale ?? "";
      const invalid = new Set<string>();
      for (const item of row.querySelectorAll<HTMLElement>("[data-role=tag-error], [data-role=required], [data-role=conflict]")) {
        const column = item.dataset.column ?? "";
        if (item.dataset.role === "tag-error") {
          const reason = state.tagErrors[locale];
          item.textContent = reason ?? "";
          item.hidden = reason === undefined;
          if (reason !== undefined) invalid.add(column);
        } else if (item.dataset.role === "required") {
          const missing = state.requiredErrors[locale]?.includes(column) === true;
          item.hidden = !missing;
          if (missing) invalid.add(column);
        } else {
          const conflicting = state.conflicts[locale]?.includes(column) === true;
          item.textContent = conflicting
            ? conflictNotice(
                state.baseline[locale]?.[column],
                fields.find((field) => field.name === column),
              )
            : "";
          item.hidden = !conflicting;
        }
      }
      for (const control of row.querySelectorAll<HTMLElement>('[data-role="control"]')) {
        if (invalid.has(control.dataset.column ?? "")) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      }

      // The label line's cues. Never both: "edited" says more than "empty".
      const dirty = state.dirty.locales.includes(locale);
      const dirtyCue = row.querySelector<HTMLElement>('[data-role="dirty-cue"]');
      if (dirtyCue !== null) dirtyCue.hidden = !dirty;
      const emptyCue = row.querySelector<HTMLElement>('[data-role="empty-cue"]');
      if (emptyCue !== null) emptyCue.hidden = dirty || fieldText(state.draft[locale]?.[VALUE]) !== "";
    }

    // Counting every Locale, not only the shown ones: it says how much work the key has left.
    const total = state.rowOrder.length;
    const emptyCount = state.rowOrder.filter((locale) => fieldText(state.draft[locale]?.[VALUE]) === "").length;
    sectionCount.textContent = total === 0 ? "" : PANEL.localeCount(total, emptyCount);
    section.hidden = total === 0;

    // A disabled button always has an on-screen cause: name the Locales the toolbar is hiding.
    const shown = visible(state);
    const sentences = [
      ...[hiddenErrors(state.requiredErrors, shown)].filter((locales) => locales.length > 0).map(PANEL.hintRequired),
      ...[hiddenErrors(state.tagErrors, shown)].filter((locales) => locales.length > 0).map(PANEL.hintTags),
    ];
    toolbarHint.textContent = sentences.join(PANEL.hintJoin);
    toolbarHint.hidden = sentences.length === 0;
  }

  // ---------------------------------------------------------------------
  // Everything else
  // ---------------------------------------------------------------------

  function paintStatus(): void {
    const state = store.getState();
    status.textContent = state.status.text;
    status.dataset.kind = state.status.kind;
    // Announced politely for success and assertively for failure.
    status.setAttribute("aria-live", state.status.kind === "error" ? "assertive" : "polite");
  }

  function paintHeading(): void {
    const state = store.getState();
    const open = state.selection !== undefined;
    placeholder.hidden = open;
    selection.hidden = !open;
    // The source message is the title: an Editor should see "Deploy now", not a hash.
    const titled = open && state.title !== state.selection?.key;
    title.textContent = titled ? state.title : "";
    title.hidden = !titled;
    key.textContent = state.selection?.key ?? "";
    key.className = titled ? "key-small" : "key-chip";
    sharedBadge.hidden = !state.shared;
    sharedNotice.hidden = !state.shared;
    // A note for translators, when the website supplies one.
    const note = state.meta?.description ?? "";
    description.textContent = note;
    description.hidden = note === "";
  }

  /** Replaces the chosen set and repaints everything that counts Locales. */
  function choose(next: Set<string> | undefined): void {
    harvest();
    chosen = next;
    // paintRows repaints the picker too, so its counts follow the rows.
    paintRows();
  }

  /** The trigger's count, the quick sets and one row per Locale. */
  function paintPicker(): void {
    const state = store.getState();
    const current = state.selection?.locale;
    const order = state.rowOrder;
    // The list is rebuilt under the Editor's hands when a box is ticked, so the
    // box they ticked has to be given back its focus.
    const active = document.activeElement;
    const refocus = active instanceof HTMLElement && pickerList.contains(active) ? active.closest("[data-locale]")?.getAttribute("data-locale") : undefined;
    picker.hidden = order.length === 0;
    if (order.length === 0) return;

    const shown = visible(state).length;
    pickerCount.textContent = shown === order.length ? PANEL.languagesAll(order.length) : PANEL.languagesSome(shown, order.length);
    picker.dataset.narrowed = String(shown < order.length);
    pickerSummary.textContent = PANEL.languagesShown(shown, order.length - shown);

    const empties = order.filter((locale) => isEmptyValue(state, locale));
    const edited = state.dirty.locales;
    const sets: [string, () => Set<string> | undefined][] = [
      [PANEL.languagesSetAll(order.length), () => undefined],
      [PANEL.languagesSetNone, () => new Set()],
      [PANEL.languagesSetEmpty(empties.length), () => new Set(empties)],
      [PANEL.languagesSetEdited(edited.length), () => new Set(edited)],
    ];
    pickerSets.replaceChildren(
      ...sets.map(([label, build]) => {
        const button = element("button", "picker-set", label);
        button.type = "button";
        button.addEventListener("click", () => choose(build()));
        return button;
      }),
    );

    const needle = languageSearch.trim().toLowerCase();
    const listed = order.filter((locale) => needle === "" || locale.toLowerCase().includes(needle) || languageName(locale).toLowerCase().includes(needle));
    pickerList.replaceChildren(
      ...listed.map((locale) => {
        const row = element("label", "picker-item");
        row.className = "picker-item";
        row.dataset.locale = locale;
        const box = element("input");
        box.type = "checkbox";
        box.checked = isChosen(locale, current);
        // The Core returns the Current Locale whatever the filters say, so its
        // box is ticked and disabled rather than quietly ignoring a click.
        box.disabled = locale === current;
        box.addEventListener("change", () => {
          const next = new Set(order.filter((candidate) => isChosen(candidate, current)));
          if (box.checked) next.add(locale);
          else next.delete(locale);
          choose(next);
        });
        row.append(box, element("span", "picker-name", languageName(locale)), element("code", "picker-code", locale));
        if (locale === current) {
          row.title = PANEL.languagesPinned;
          row.append(element("span", "picker-cue", PANEL.currentLocale));
        } else if (locale === state.sourceLocale) {
          row.append(element("span", "picker-cue", PANEL.sourceLocale));
        } else if (isEmptyValue(state, locale)) {
          row.append(element("span", "picker-cue", PANEL.emptyCue));
        }
        return row;
      }),
    );

    if (refocus !== undefined && refocus !== null) {
      const again = [...pickerList.children].find((row) => row instanceof HTMLElement && row.dataset.locale === refocus);
      if (again instanceof HTMLElement) again.querySelector("input")?.focus();
    }
  }

  function paintToolbar(): void {
    const state = store.getState();
    filters = resolveToolbarFilters(state.schema, () => undefined);
    // Choices are kept where the same filter still exists.
    selected = Object.fromEntries(filters.map(({ field }) => [field.name, selected[field.name] ?? ""]).filter(([, value]) => value !== ""));
    const parts: HTMLElement[] = [];
    if (shouldRenderToolbar(state.schema)) {
      if (state.schema?.toolbar?.search === true) {
        const box = element("input", "search");
        box.type = "search";
        box.placeholder = PANEL.searchPlaceholder;
        box.setAttribute("aria-label", PANEL.searchLabel);
        box.value = search;
        box.addEventListener("input", () => {
          harvest();
          search = box.value;
          paintRows();
        });
        parts.push(box);
      } else {
        search = "";
      }
      for (const { field, label } of filters) {
        const select = element("select", "filter");
        select.id = nextId();
        select.dataset.field = field.name;
        const all = element("option", undefined, PANEL.filterAll);
        all.value = "";
        select.append(all);
        for (const choice of field.options) {
          const option = element("option", undefined, choice.label);
          option.value = choice.value;
          select.append(option);
        }
        select.value = selected[field.name] ?? "";
        select.addEventListener("change", () => {
          harvest();
          selected = { ...selected, [field.name]: select.value };
          paintRows();
        });
        // Named on screen, not only to a screen reader: a lone dropdown reading
        // "All" says nothing about what it is filtering.
        const labelElement = element("label", "filter-label", label);
        labelElement.htmlFor = select.id;
        const wrap = element("div");
        wrap.className = "filter";
        wrap.append(labelElement, select);
        parts.push(wrap);
      }
    } else {
      search = "";
    }
    // Row (b): which Locales to show is the Editor's choice, not the
    // Developer's, so it sits between search and the Schema's filters whatever
    // the configuration declared.
    parts.splice(state.schema?.toolbar?.search === true ? 1 : 0, 0, picker);
    toolbar.replaceChildren(...parts);
    toolbar.hidden = false;
    paintPicker();
  }

  function paintUsedOn(): void {
    const state = store.getState();
    const site = options.site?.();
    const items: HTMLElement[] = [];
    for (const usage of state.usages) {
      // A usage with no address (a source-file reference) is not rendered.
      if (!("url" in usage) || typeof usage.url !== "string" || usage.url === "") continue;
      const url = usage.url;
      const row = element("button", "usage");
      row.type = "button";
      row.title = url;
      let path = usagePath(url);
      let elsewhere = false;
      try {
        const parsed = new URL(url);
        elsewhere = site !== undefined && parsed.origin !== site;
        if (elsewhere) path = `${parsed.host}${parsed.pathname}`;
      } catch {
        // Not an address: shown as it is, and navigating to it is refused later.
      }
      row.append(element("span", "usage-path", path));
      if (elsewhere) row.append(" ", element("span", "usage-new-tab", PANEL.usedOnNewTab));
      if (usage.count > 1) row.append(" ", element("span", "usage-count", PANEL.usedOnCount(usage.count)));
      const seen = relativeTime(usage.lastSeen, now());
      if (seen !== "") row.append(" ", element("span", "usage-time", seen));
      row.addEventListener("click", () => callbacks.navigate(url));
      const item = element("li");
      item.append(row);
      items.push(item);
    }
    if (state.usagesLoading || state.usagesError || items.length === 0) {
      const text = state.usagesLoading ? PANEL.usedOnLoading : state.usagesError ? PANEL.usedOnFailed : PANEL.usedOnNone;
      usedOnBody.replaceChildren(element("p", "used-on-state", text));
      return;
    }
    const list = element("ul");
    list.append(...items);
    usedOnBody.replaceChildren(list);
  }

  /**
   * The page's inventory: everything the last scan found. The Core publishes
   * the Hidden subset on its own, so that stands in until a scan is reported —
   * a panel seeded after the fact has one and not yet the other.
   */
  const inventory = (state: PanelState): readonly PageMarker[] =>
    markers.length > 0
      ? markers
      : state.hidden.map((item) => ({ id: item.id, key: item.key, value: item.value, attribute: item.attribute }));

  /** One row of the Page list: what the page says, what key says it, and what is true of the key. */
  function buildPageItem(item: PageMarker, current: boolean, unsaved: boolean): HTMLElement {
    const row = element("button", "page-item");
    row.type = "button";
    row.className = "page-item";
    row.dataset.id = item.id;
    row.dataset.key = item.key;
    row.dataset.current = String(current);
    row.title = item.attribute === undefined ? item.key : PANEL.hiddenTooltip(item.attribute, item.key);

    const body = element("span");
    body.className = "page-body";
    // A translation whose text is empty on the page still has a row: the dash says so.
    body.append(element("span", "page-text", item.value === "" ? PANEL.emptyValue : item.value), element("code", "page-key", item.key));

    const marks = element("span");
    marks.className = "page-marks";
    if (isSharedKey(item.key)) marks.append(element("span", "page-shared", PANEL.sharedBadge));
    // Which attribute holds it, for a translation that has no text of its own.
    if (item.attribute !== undefined) marks.append(element("code", "page-attribute", item.attribute));
    if (unsaved) {
      const dot = element("span", "page-dot");
      dot.className = "page-dot";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", PAGE.unsavedMark);
      marks.append(dot);
    }

    row.append(body, marks);
    // Pointing at a row finds it on the page; activating it opens it, exactly as a click there would.
    row.addEventListener("mouseenter", () => callbacks.flash(item.id));
    row.addEventListener("click", () => callbacks.openMarker(item.id));
    return row;
  }

  /** A group heading with its own count: the page's own split, not a filter. */
  function buildPageGroup(label: string, count: number): HTMLElement {
    const head = element("div", "page-group");
    head.className = "page-group";
    head.append(element("span", "page-group-name", label), element("span", "page-group-count", String(count)));
    return head;
  }

  function paintPage(): void {
    const state = store.getState();
    const items = inventory(state);
    const unsaved = new Set(state.unsavedKeys);
    const openKey = state.selection?.key;

    pageUrl.textContent = markersUrl ?? "";
    pageUrl.hidden = markersUrl === undefined;
    pageTabCount.textContent = String(items.length);
    pageTabCount.hidden = items.length === 0;

    const unsavedHere = items.filter((item) => unsaved.has(item.key));
    pageUnsaved.textContent = PAGE.unsaved(unsavedHere.length);
    pageUnsaved.hidden = unsavedHere.length === 0;
    scopeAll.textContent = PAGE.scopeAll(items.length);
    scopeUnsaved.textContent = PAGE.scopeUnsaved(unsavedHere.length);
    for (const [name, button] of [
      ["all", scopeAll],
      ["unsaved", scopeUnsaved],
    ] as [PageScope, HTMLButtonElement][]) {
      button.setAttribute("aria-pressed", String(pageScope === name));
      button.dataset.current = String(pageScope === name);
    }

    const needle = pageSearch.trim().toLowerCase();
    const matching = items.filter(
      (item) =>
        (pageScope === "all" || unsaved.has(item.key)) &&
        (needle === "" || item.key.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle)),
    );
    const shown = pageSort === "key" ? [...matching].sort((left, right) => left.key.localeCompare(right.key)) : matching;
    const row = (item: PageMarker) => buildPageItem(item, item.key === openKey, unsaved.has(item.key));

    if (items.length === 0 || shown.length === 0) {
      pageList.replaceChildren(element("p", "page-state", items.length === 0 ? PAGE.none : PAGE.noMatch));
      return;
    }
    // Visible text first, then what lives in an attribute: the second group is
    // the only part of a page an Editor cannot point at.
    const visibleItems = shown.filter((item) => item.attribute === undefined);
    const hiddenItems = shown.filter((item) => item.attribute !== undefined);
    const parts: HTMLElement[] = [];
    if (visibleItems.length > 0) parts.push(buildPageGroup(PAGE.groupVisible, visibleItems.length), ...visibleItems.map(row));
    if (hiddenItems.length > 0) parts.push(buildPageGroup(PAGE.groupHidden, hiddenItems.length), ...hiddenItems.map(row));
    pageList.replaceChildren(...parts);
  }

  function paintLog(): void {
    logPane.textContent = log.text();
    logPane.scrollTop = logPane.scrollHeight;
    copyButton.textContent = DIAGNOSTICS.copy;
  }

  // ---------------------------------------------------------------------
  // The Editor's input
  // ---------------------------------------------------------------------

  rows.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.role === "control") push(target as Control);
  });
  rows.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.role === "control") push(target as Control);
  });

  saveButton.addEventListener("click", () => {
    if (store.getState().selection === undefined) return;
    harvest();
    const saving = store.save();
    if (!store.getState().saving) {
      // Nothing was sent: nothing changed, or errors stand. Repaint so the inline errors appear.
      paintRows();
      paintStatus();
      return;
    }
    // What the store set synchronously is painted at once, not when the save settles.
    paintGuard();
    paintStatus();
    void saving.finally(() => {
      // After a conflict the rows are repainted from the store WITHOUT harvesting: the refused
      // Locale's draft took the stored value of every column the Editor had left alone, and the
      // controls still show what was loaded. Harvesting would write those old values back.
      if (Object.keys(store.getState().conflicts).length > 0) paintRows();
      else paintGuard();
      paintStatus();
      paintPage();
    });
  });

  cancelButton.addEventListener("click", () => {
    store.cancel();
    paintRows();
    paintStatus();
    paintPage();
  });

  copyButton.addEventListener("click", () => {
    const clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
    const done = (text: string) => {
      copyButton.textContent = text;
    };
    try {
      void Promise.resolve(clipboard.writeText(log.text())).then(
        () => done(DIAGNOSTICS.copied),
        () => done(DIAGNOSTICS.copyFailed),
      );
    } catch {
      done(DIAGNOSTICS.copyFailed);
    }
  });
  clearButton.addEventListener("click", () => log.clear());
  log.subscribe(paintLog);

  paintTabs();
  paintHeading();
  paintPage();
  paintLog();

  // ---------------------------------------------------------------------
  // The driver
  // ---------------------------------------------------------------------

  return {
    setSignIn(status) {
      const name = editingAs(status);
      editingAsLine.textContent = name ?? "";
      editingAsLine.hidden = name === undefined;
    },

    open(openedKey, locale, onPageValue) {
      harvest();
      store.open(openedKey, locale, onPageValue);
      // A translation was clicked: that is what the Editor is now looking at.
      show("translation");
      log.add("open", DIAGNOSTICS.open(openedKey, locale), onPageValue);
      const { locales } = store.getState();
      // While no configuration has arrived there is nothing to compare against.
      if (locales.length > 0 && !locales.includes(locale)) {
        log.add("open", DIAGNOSTICS.unconfiguredLocale(locale, locales), DIAGNOSTICS.unconfiguredLocaleDetail);
        failure();
      }
      // A fresh key starts with every Locale shown.
      search = "";
      selected = {};
      paintHeading();
      paintToolbar();
      paintRows();
      paintStatus();
      paintUsedOn();
      paintPage();
    },

    setValues(valuesKey, values, error) {
      if (store.getState().selection?.key !== valuesKey) return;
      // The store keeps what the Editor changed, and can only keep what it has been told.
      harvest();
      store.setValues(valuesKey, values, error);
      if (error) {
        log.add("values", DIAGNOSTICS.valuesFailed(valuesKey));
        failure();
      } else {
        log.add("values", DIAGNOSTICS.values(valuesKey, Object.keys(values.locales)));
      }
      paintHeading();
      paintRows();
      paintStatus();
    },

    setUsage(usageKey, usages, error) {
      store.setUsage(usageKey, usages, error);
      paintUsedOn();
    },

    setConfig(config) {
      harvest();
      store.setConfig(config);
      log.add("config", DIAGNOSTICS.config(config.locales ?? [], config.sourceLocale, config.schema !== undefined));
      paintToolbar();
      paintRows();
    },

    setHidden(items) {
      store.setHidden(items);
      paintPage();
    },

    setMarkers(items, url) {
      markers = items;
      markersUrl = url;
      paintPage();
    },
  };
}
