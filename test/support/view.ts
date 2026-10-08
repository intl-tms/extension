import type { PanelConfig, PanelWrite, PersistOutcome } from "@intl-tms/core/tools";
import { vi } from "vitest";
import { createLog } from "../../src/panel/log.js";
import { createPanelView, type PanelViewOptions } from "../../src/panel/view.js";
import { PANEL } from "../../src/shared/strings.js";

export const STATUS = {
  type: "select" as const,
  name: "status",
  label: "Status",
  options: [
    { label: "Draft", value: "draft" },
    { label: "Approved", value: "approved" },
  ],
};

export const CONFIG: PanelConfig = { locales: ["en", "da"], sourceLocale: "en" };
export const NOW = Date.parse("2026-01-10T12:00:00.000Z");

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type SaveAnswer = PersistOutcome | undefined | Error | Promise<PersistOutcome | undefined>;

export const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

export interface PanelSetup {
  config?: PanelConfig | false;
  /** What the save callback answers. Defaults to success for every Locale sent. */
  answer?: (key: string, writes: Record<string, PanelWrite>) => SaveAnswer;
  view?: Partial<PanelViewOptions>;
}

/** A panel view in a simulated document, with spies for its callbacks. */
export function panel(setup: PanelSetup = {}) {
  document.body.innerHTML = "";
  const container = document.createElement("main");
  document.body.append(container);
  const saves: { key: string; writes: Record<string, PanelWrite> }[] = [];
  const save = vi.fn(async (key: string, writes: Record<string, PanelWrite>) => {
    saves.push({ key, writes: structuredClone(writes) });
    if (setup.answer) {
      const answer = await setup.answer(key, writes);
      if (answer instanceof Error) throw answer;
      return answer;
    }
    return { ok: true, results: Object.fromEntries(Object.keys(writes).map((locale) => [locale, { ok: true, status: 200 }])) };
  });
  const callbacks = { save, navigate: vi.fn(), flash: vi.fn(), openHidden: vi.fn() };
  const log = createLog({ now: () => new Date(2026, 0, 10, 9, 5, 3) });
  const driver = createPanelView({ callbacks, container, log, now: () => NOW, ...setup.view });
  if (setup.config !== false) driver.setConfig(setup.config ?? CONFIG);

  const role = <T extends HTMLElement = HTMLElement>(name: string) => container.querySelector<T>(`[data-role="${name}"]`);
  const roles = <T extends HTMLElement = HTMLElement>(name: string) => [...container.querySelectorAll<T>(`[data-role="${name}"]`)];
  const shown = (element: HTMLElement | null | undefined) => element !== null && element !== undefined && element.closest("[hidden]") === null;
  const rows = () => roles("row");
  const row = (locale: string) => rows().find((candidate) => candidate.dataset.locale === locale);
  const control = <T extends Control = HTMLInputElement>(locale: string, column = "value") =>
    roles<T>("control").find((candidate) => candidate.dataset.locale === locale && candidate.dataset.column === column) as T;
  const within = (locale: string, name: string, column?: string) =>
    [...(row(locale)?.querySelectorAll<HTMLElement>(`[data-role="${name}"]`) ?? [])].find((element) => column === undefined || element.dataset.column === column);
  const type = (target: Control, text: string, event = "input") => {
    target.value = text;
    target.dispatchEvent(new Event(event, { bubbles: true }));
  };
  const button = (name: string) => role<HTMLButtonElement>(name)!;
  const press = async (name: string) => {
    button(name).click();
    await settle();
  };
  const status = () => role("status")!;
  const diagnostics = () => role<HTMLDetailsElement>("diagnostics")!;

  return { container, driver, callbacks, saves, log, role, roles, shown, rows, row, control, within, type, button, press, status, diagnostics };
}

/** A panel with `hero.title` open on a page showing `en`, values loaded for `en` and `da`. */
export function opened(setup: PanelSetup = {}, values: Record<string, Record<string, unknown>> = { en: { value: "Deploy now" }, da: { value: "Udrul nu" } }) {
  const view = panel(setup);
  view.driver.open("hero.title", "en", "Deploy now");
  view.driver.setValues("hero.title", { locales: values as never }, false);
  return view;
}

export const usage = (url: string, count = 1) => ({ key: "hero.title", source: "runtime" as const, url, count, lastSeen: "2026-01-10T11:00:00.000Z" });
export const hiddenItem = { id: "a1:aria-label", attribute: "aria-label", key: "icon.close", value: "Close" };
export { PANEL };
