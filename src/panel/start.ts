import { message } from "../shared/protocol.js";
import { createController } from "./controller.js";
import { createPanelView } from "./view.js";

/** The parts of the browser's extension API the Side Panel uses. */
export type PanelApi = Pick<typeof chrome, "runtime" | "tabs">;

/**
 * Mounts the panel view, listens for inbound messages and sends panel-ready
 * once. The view is populated by whichever arrives first, the relayed push or
 * the reply to panel-ready; both carry the same data.
 */
export function startPanel(api: PanelApi, container: HTMLElement): void {
  const controller = createController({
    send: (outgoing) => api.runtime.sendMessage(outgoing),
    openTab: (url) => void api.tabs.create({ url }),
  });
  // The running build, so a panel that did not pick up a rebuild says so itself.
  const version = api.runtime.getManifest().version;
  controller.bind(createPanelView({ callbacks: controller.callbacks, container, site: controller.site, version }));

  api.runtime.onMessage.addListener((incoming: unknown) => {
    controller.handle(incoming);
    // The panel never replies: the Worker does.
    return false;
  });

  void Promise.resolve()
    .then(() => api.runtime.sendMessage(message("worker", "panel-ready", {})))
    .then(controller.seed, () => undefined);
}
