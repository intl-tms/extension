import { accessPattern, isSite, siteOf } from "../shared/site.js";
import { CONSOLE } from "../shared/strings.js";

/** The one identifier the Page Host is registered under. */
export const REGISTRATION_ID = "page-host";

/** The Page Host bundle, relative to the Extension's root. */
export const PAGE_HOST_FILE = "page.js";

/** The browser's registration of the Page Host. */
export interface Registration {
  id: string;
  js: string[];
  /** Exactly the access patterns of the Sites that are Listed and Granted. */
  matches: string[];
  /** Always false: the Page Host runs in the top frame only. */
  allFrames: false;
  runAt: "document_idle";
  /** Always true, so a restarted browser brings every On Site back without the Worker running first. */
  persistAcrossSessions: true;
}

/** What reconciliation needs from the browser. */
export interface ReconcilePorts {
  /** The stored Listed Sites, raw. Untrusted: it is validated here. */
  readSites(): Promise<unknown>;
  /** Whether the browser has Granted this access pattern. */
  isGranted(pattern: string): Promise<boolean>;
  /** The current registration under {@link REGISTRATION_ID}, or nothing. */
  getRegistration(): Promise<Registration | undefined>;
  register(registration: Registration): Promise<void>;
  update(registration: Registration): Promise<void>;
  unregister(): Promise<void>;
  /** Every open tab. `url` is absent when the browser does not disclose it. */
  listTabs(): Promise<{ id?: number | undefined; url?: string | undefined }[]>;
  /** Injects the Page Host into a tab. Rejects for a tab that refuses (discarded, mid-navigation, restricted). */
  inject(tabId: number): Promise<void>;
  /** Where a failed run is written. */
  logError(text: string): void;
}

const text = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Creates the one operation that keeps the browser's script registration in
 * step with the Sites that are Listed and Granted. Call the returned function
 * whenever either side may have changed.
 *
 * Runs are serialised: the Popup's write and the browser's grant are two
 * events a moment apart, and two interleaved runs would both find nothing
 * registered and both register. A run never rejects, and a failed run does not
 * prevent later ones.
 */
export function createReconciler(ports: ReconcilePorts): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    let doing = "reading the listed sites";
    try {
      const stored = await ports.readSites();
      // Only a string equal to its own origin ever becomes a pattern.
      const listed = Array.isArray(stored) ? [...new Set(stored.filter(isSite))] : [];

      doing = "asking which sites are granted";
      const on: string[] = [];
      for (const site of listed) {
        if (await ports.isGranted(accessPattern(site))) on.push(site);
      }

      doing = "reading the page script registration";
      const existing = await ports.getRegistration();
      if (on.length === 0) {
        if (existing !== undefined) {
          doing = "removing the page script registration";
          await ports.unregister();
        }
        return;
      }
      const registration: Registration = {
        id: REGISTRATION_ID,
        js: [PAGE_HOST_FILE],
        matches: on.map(accessPattern),
        allFrames: false,
        runAt: "document_idle",
        persistAcrossSessions: true,
      };
      if (existing === undefined) {
        doing = "registering the page script";
        await ports.register(registration);
      } else {
        doing = "updating the page script registration";
        await ports.update(registration);
      }

      // Registration first, then injection: a tab that loads in between is covered by one or the other.
      doing = "listing open tabs";
      const tabs = await ports.listTabs();
      for (const tab of tabs) {
        const site = siteOf(tab.url);
        // A grant covers every port of a host; only the exact origin is acted on.
        if (tab.id === undefined || site === undefined || !on.includes(site)) continue;
        // A tab can refuse. Its next load gets the registered script.
        await ports.inject(tab.id).catch(() => undefined);
      }
    } catch (error) {
      ports.logError(CONSOLE.reconcileFailed(`${doing}: ${text(error)}`));
    }
  }

  return () => {
    queue = queue.then(run, run);
    return queue;
  };
}
