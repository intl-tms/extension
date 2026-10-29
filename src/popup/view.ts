import { isHttpUrl } from "@intl-tms/core/tools";
import { editingAs, readSignInStatus, signInLine } from "../shared/sign-in.js";
import { accessPattern, siteOf } from "../shared/site.js";
import { STORAGE, readSettings } from "../shared/storage.js";
import { POPUP, PRODUCT, SIGN_IN } from "../shared/strings.js";
import { addSite, canSwitchOn, checkAddress, hintFor, isOn, removeSite, siteLine, type PopupFacts } from "./logic.js";

/**
 * What the Popup needs from the browser. There is deliberately no way to
 * message the Worker or a page: the Popup writes settings and asks for a
 * permission, and everything else follows from storage and permission events.
 * That is what makes it safe to be closed mid-click.
 */
export interface PopupPorts {
  /** The active tab's address. Available without standing access because the Editor invoked the Popup on that tab. */
  activeTabUrl(): Promise<string | undefined>;
  /** The synchronised settings, raw. Untrusted: validated here. */
  readSettings(): Promise<unknown>;
  /** Writes the given settings in one write. */
  writeSettings(values: Record<string, unknown>): Promise<void>;
  /** Whether the browser has Granted this access pattern. */
  isGranted(pattern: string): Promise<boolean>;
  /**
   * Asks the browser for access to one pattern. Must be called inside the
   * Editor's click. The browser's prompt can close the Popup, so nothing may
   * depend on code that runs after this resolves.
   */
  requestAccess(pattern: string): Promise<boolean>;
  /** The active tab's page status as the Worker stashed it, raw. Untrusted: validated here. */
  tabStatus(): Promise<unknown>;
  /** Called with the active tab's page status, raw, whenever the stash changes while the Popup is open. */
  onTabStatus(listener: (status: unknown) => void): void;
  /** Opens an address in a new tab. */
  openTab(url: string): void;
}

/** What {@link mountPopup} is built from. */
export interface PopupOptions {
  container: HTMLElement;
  ports: PopupPorts;
}

/** Renders the Popup into its container, once the active tab's Site, the settings and the grant are known. */
export async function mountPopup({ container, ports }: PopupOptions): Promise<void> {
  const document = container.ownerDocument;
  const site = siteOf(await ports.activeTabUrl().catch(() => undefined));
  const settings = readSettings(await ports.readSettings().catch(() => undefined));
  let sites = settings.sites;
  let granted = site === undefined ? false : await ports.isGranted(accessPattern(site)).catch(() => false);

  const title = document.createElement("h1");
  title.textContent = PRODUCT.name;

  const siteElement = document.createElement("p");
  siteElement.dataset.role = "site";
  siteElement.textContent = siteLine(site);

  const group = document.createElement("div");
  group.className = "switch";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", POPUP.switchLabel);
  const on = document.createElement("button");
  on.type = "button";
  on.textContent = POPUP.on;
  const off = document.createElement("button");
  off.type = "button";
  off.textContent = POPUP.off;
  group.append(on, off);

  const label = document.createElement("label");
  label.htmlFor = "config-url";
  label.textContent = POPUP.addressLabel;
  const field = document.createElement("input");
  field.id = "config-url";
  field.type = "url";
  field.spellcheck = false;
  field.placeholder = POPUP.addressPlaceholder;
  field.value = settings.configUrl;

  const hint = document.createElement("p");
  hint.dataset.role = "hint";
  hint.className = "hint";
  hint.setAttribute("role", "status");

  // What the website said about letting the Editor in, from the page status.
  const signInSection = document.createElement("section");
  signInSection.dataset.role = "sign-in";
  signInSection.className = "sign-in";
  const signInText = document.createElement("p");
  signInText.dataset.role = "sign-in-line";
  signInText.setAttribute("role", "status");
  const signInHelp = document.createElement("p");
  signInHelp.dataset.role = "sign-in-help";
  signInHelp.className = "help";
  const signInButton = document.createElement("button");
  signInButton.type = "button";
  signInButton.textContent = SIGN_IN.signIn;
  signInSection.append(signInText, signInHelp, signInButton);
  const editingAsLine = document.createElement("p");
  editingAsLine.dataset.role = "editing-as";
  editingAsLine.className = "editing-as";
  let signInAddress: string | undefined;

  function showStatus(raw: unknown): void {
    const status = readSignInStatus((raw as { signIn?: unknown } | undefined)?.signIn);
    const line = signInLine(status);
    signInSection.hidden = line === undefined;
    signInText.textContent = line?.text ?? "";
    // The website's words are text, never markup or a link.
    signInHelp.textContent = line?.help ?? "";
    signInHelp.hidden = line?.help === undefined;
    signInAddress = line?.signIn;
    signInButton.hidden = signInAddress === undefined;
    const name = editingAs(status);
    editingAsLine.textContent = name ?? "";
    editingAsLine.hidden = name === undefined;
  }

  signInButton.addEventListener("click", () => {
    // Checked immediately before opening, whatever was checked earlier. Never fetched by the Extension.
    if (signInAddress !== undefined && isHttpUrl(signInAddress)) ports.openTab(signInAddress);
  });

  const facts = (): PopupFacts => ({ site, address: field.value, listed: site !== undefined && sites.includes(site), granted });

  function render(): void {
    const now = facts();
    const showOn = isOn(now);
    on.setAttribute("aria-pressed", String(showOn));
    off.setAttribute("aria-pressed", String(!showOn));
    on.disabled = !canSwitchOn(now);
    const text = hintFor(now);
    hint.textContent = text ?? "";
    hint.hidden = text === undefined;
  }

  // The switch and the hint follow the field as the Editor types.
  field.addEventListener("input", render);
  // Committed: focus left the field, or Enter.
  field.addEventListener("change", () => {
    void ports.writeSettings({ [STORAGE.configUrl]: field.value.trim() }).catch(() => undefined);
  });

  on.addEventListener("click", () => {
    const address = checkAddress(field.value);
    if (site === undefined || !address.ok) return;
    sites = addSite(sites, site);
    // Intent is stored before the browser is asked, and not awaited: the
    // prompt can close the Popup, and the request must stay inside the click.
    void ports.writeSettings({ [STORAGE.sites]: sites, [STORAGE.configUrl]: address.address }).catch(() => undefined);
    let request: Promise<boolean>;
    try {
      request = ports.requestAccess(accessPattern(site));
    } catch {
      request = Promise.resolve(false);
    }
    void request
      .catch(() => false)
      .then((answer) => {
        granted = answer === true;
        render();
      });
    render();
  });

  off.addEventListener("click", () => {
    if (site === undefined || !sites.includes(site)) return;
    sites = removeSite(sites, site);
    void ports.writeSettings({ [STORAGE.sites]: sites }).catch(() => undefined);
    render();
  });

  container.replaceChildren(title, siteElement, group, label, field, hint, signInSection, editingAsLine);
  render();
  // The status is a nicety: a Popup that cannot read it still works.
  showStatus(await Promise.resolve().then(ports.tabStatus).catch(() => undefined));
  try {
    ports.onTabStatus(showStatus);
  } catch {
    // No updates while open.
  }
}
