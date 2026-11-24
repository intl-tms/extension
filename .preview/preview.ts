// Throwaway harness: mounts the real panel view in a real browser so the
// rendered result can be looked at and compared with the design boards.
// Not shipped, not tested, not imported by anything in src/.
import { createPanelView } from "../src/panel/view.js";

const container = document.getElementById("app") as HTMLElement;

const driver = createPanelView({
  callbacks: {
    save: async () => ({ ok: true, results: {} }),
    navigate: () => undefined,
    flash: () => undefined,
    openHidden: () => undefined,
  },
  container,
  version: "preview",
  site: () => "http://localhost:3000",
});

driver.setConfig({
  locales: ["en", "da", "es", "de", "fr"],
  sourceLocale: "en",
  schema: {
    valueField: { type: "textarea" },
    fields: [
      {
        type: "select",
        name: "workflow",
        label: "Workflow",
        required: true,
        options: [
          { label: "Needs copy", value: "needs-copy" },
          { label: "With legal", value: "legal" },
          { label: "Signed off", value: "signed" },
        ],
      },
      { type: "text", name: "glossary", label: "Glossary" },
      { type: "readonly", name: "charLimit", label: "Char limit" },
    ],
    toolbar: { search: true, filters: [{ field: "workflow" }] },
  },
});

driver.open("shared.actions.saveAll", "da", "Gem alle ændringer");
driver.setValues(
  "shared.actions.saveAll",
  {
    meta: {
      sourceMessage: "Save all changes",
      description: "Button under the basket. Keep it under 20 characters.",
    },
    locales: {
      da: { value: "Gem alle ændringer i din indkøbskurv", workflow: "legal", glossary: "cart = indkøbskurv", charLimit: "36 — set by the design system" },
      en: { value: "Save all changes", workflow: "signed", glossary: "", charLimit: "36 — set by the design system" },
      es: { value: "Guardar todos los cambios de la cesta", workflow: "needs-copy", glossary: "", charLimit: "36 — set by the design system" },
      de: { value: "Alle Änderungen speichern", workflow: "", glossary: "", charLimit: "36 — set by the design system" },
      fr: { value: "", workflow: "needs-copy", glossary: "", charLimit: "" },
    },
  } as never,
  false,
);

driver.setUsage(
  "shared.actions.saveAll",
  [{ key: "shared.actions.saveAll", source: "runtime", url: "http://localhost:3000/en/checkout", count: 4, lastSeen: new Date().toISOString() }],
  false,
);

driver.setHidden([{ id: "a1:aria-label", attribute: "aria-label", key: "icon.close", value: "Close" }]);

driver.setMarkers(
  [
    { id: "t1", key: "shared.actions.saveAll", value: "Gem alle ændringer" },
    { id: "t2", key: "checkout.empty.title", value: "Din indkøbskurv er tom" },
    { id: "t3", key: "shared.actions.pay", value: "Fortsæt til betaling" },
    { id: "t4", key: "checkout.summary.heading", value: "Ordreoversigt" },
    { id: "t5", key: "checkout.giftcard.apply", value: "Brug gavekort" },
    { id: "t6", key: "checkout.delivery.note", value: "" },
    { id: "a1:aria-label", key: "common.actions.close", value: "Luk", attribute: "aria-label" },
    { id: "a2:placeholder", key: "checkout.discount.placeholder", value: "Indtast din rabatkode", attribute: "placeholder" },
    { id: "a3:alt", key: "checkout.card.alt", value: "Kreditkort", attribute: "alt" },
  ],
  "localhost:3000/da/checkout",
);

// Type into Danish so the "edited" cue and a dirty Save are on screen.
const danish = container.querySelector<HTMLTextAreaElement>('[data-role="control"][data-locale="da"][data-column="value"]');
if (danish !== null) {
  danish.value = "Gem alle ændringer i din kurv";
  danish.dispatchEvent(new Event("input", { bubbles: true }));
}
