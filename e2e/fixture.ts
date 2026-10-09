import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, createMemoryAdapter, markCatalog, resolveConfig, TOGGLE_COOKIE_NAME, TOGGLE_ON_VALUE } from "@intl-tms/core";

/**
 * A minimal website built on the real Core server: it marks its Catalog when
 * the Toggle is set, serves the configuration and the editing endpoints, and
 * reads translations per request, so a reload always shows what was saved.
 */
export interface Fixture {
  origin: string;
  configUrl: string;
  /** The stored `en` value of a key, as the website holds it. */
  stored(key: string): Promise<string | undefined>;
  /** Another Editor writing straight to the website. */
  write(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

const DEFAULTS = {
  hero: { title: "Deploy now" },
  rich: { text: "Read the <b>docs</b>" },
  icon: { close: "Close" },
  nav: { docs: "Docs" },
  lang: { en: "English", da: "Dansk" },
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The website's formatter: text is escaped, and `<b>` is the one tag it has a handler for. */
const format = (message: string) => escape(message).replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, "<b>$1</b>");

export async function startFixture(options: { alwaysMarked?: boolean } = {}): Promise<Fixture> {
  const adapter = createMemoryAdapter();
  const mounted: { handler?: ReturnType<typeof createHandler> } = {};
  let origin = "";

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname.startsWith("/api/tms/")) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
        const method = request.method ?? "GET";
        const answer = await mounted.handler!(new Request(url, { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }) }));
        response.writeHead(answer.status, Object.fromEntries(answer.headers));
        response.end(Buffer.from(await answer.arrayBuffer()));
        return;
      }

      const editing = options.alwaysMarked === true || (request.headers.cookie ?? "").split(";").some((pair) => pair.trim() === `${TOGGLE_COOKIE_NAME}=${TOGGLE_ON_VALUE}`);
      const catalog: Record<string, Record<string, string>> = structuredClone(DEFAULTS);
      for (const [group, messages] of Object.entries(catalog)) {
        for (const name of Object.keys(messages)) {
          const row = (await adapter.getValues(`${group}.${name}`)).en;
          if (row !== undefined) messages[name] = row.value;
        }
      }
      const t = (editing ? markCatalog(catalog) : catalog) as typeof DEFAULTS;

      if (url.pathname === "/catalog.json") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(t));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Fixture</title></head>
  <body>
    <h1 id="title">${format(t.hero.title)}</h1>
    <p id="rich">${format(t.rich.text)}</p>
    <p id="plain">Not a translation</p>
    <a id="link" href="#docs">${format(t.nav.docs)}</a>
    <select id="lang"><option value="en">${format(t.lang.en)}</option><option value="da">${format(t.lang.da)}</option></select>
  </body>
</html>`);
    })().catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // The browser reaches it as localhost, the one host the test build is granted.
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  const config = resolveConfig({ locales: ["en", "da"], basePath: `${origin}/api/tms`, sourceLocale: "en" });
  mounted.handler = createHandler({ config, adapter, authorize: () => true });
  // The rich message is stored, so the panel loads it whole instead of the first text node on the page.
  await adapter.saveValue("rich.text", { locale: "en", value: DEFAULTS.rich.text });

  return {
    origin,
    configUrl: `${origin}/api/tms/config`,
    stored: async (key) => (await adapter.getValues(key)).en?.value,
    write: async (key, value) => void (await adapter.saveValue(key, { locale: "en", value })),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
