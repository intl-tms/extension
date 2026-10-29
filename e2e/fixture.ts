import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, createMemoryAdapter, isEditingRequest, markCatalog, resolveConfig, sessionCheck, TOGGLE_COOKIE_NAME, TOGGLE_ON_VALUE, type Authorize } from "@intl-tms/core";

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
  /** With a login: the sign-in page. `?as=ada` signs in with the Editor role, `?as=sam` without it. */
  signInUrl: string;
  /** With a login: ends every session at once, as when one runs out. */
  endSessions(): void;
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

const ACCOUNTS: Record<string, { id: string; name: string; editor: boolean }> = {
  ada: { id: "ada", name: "Ada Jensen", editor: true },
  sam: { id: "sam", name: "Sam Berg", editor: false },
};

export const HELP = { unauthenticated: "Sign in with your company account.", forbidden: "Ask IT for the Editor role." };

export async function startFixture(options: { alwaysMarked?: boolean; login?: boolean } = {}): Promise<Fixture> {
  const adapter = createMemoryAdapter();
  const mounted: { handler?: ReturnType<typeof createHandler> } = {};
  let origin = "";
  // A login for Editors: sessions by identifier, in a cookie scripts cannot read.
  const sessions = new Map<string, (typeof ACCOUNTS)[string]>();
  const sessionOf = (cookie: string | null) => {
    const id = (cookie ?? "").split(";").map((pair) => pair.trim()).find((pair) => pair.startsWith("editor-session="))?.slice("editor-session=".length);
    return id === undefined ? undefined : sessions.get(id);
  };
  const authorize: Authorize =
    options.login === true
      ? sessionCheck({ user: (request) => sessionOf(request.headers.get("cookie")), may: (user) => user.editor, signIn: "/editors/sign-in", help: HELP })
      : () => true;

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

      if (url.pathname === "/editors/sign-in") {
        const account = ACCOUNTS[url.searchParams.get("as") ?? ""];
        const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
        if (account !== undefined) {
          const id = crypto.randomUUID();
          sessions.set(id, account);
          headers["set-cookie"] = `editor-session=${id}; HttpOnly; SameSite=Lax; Path=/`;
        }
        response.writeHead(200, headers);
        response.end(`<!doctype html><title>Sign in</title><p id="signed-in">${account === undefined ? "Choose an account" : `Signed in as ${escape(account.name)}`}</p>`);
        return;
      }

      const toggled = (request.headers.cookie ?? "").split(";").some((pair) => pair.trim() === `${TOGGLE_COOKIE_NAME}=${TOGGLE_ON_VALUE}`);
      const asRequest = new Request(url, { headers: request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie } });
      const editing = options.alwaysMarked === true || (toggled && (options.login !== true || (await isEditingRequest(asRequest, authorize))));
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
  mounted.handler = createHandler({ config, adapter, authorize });
  // The rich message is stored, so the panel loads it whole instead of the first text node on the page.
  await adapter.saveValue("rich.text", { locale: "en", value: DEFAULTS.rich.text });

  return {
    origin,
    configUrl: `${origin}/api/tms/config`,
    stored: async (key) => (await adapter.getValues(key)).en?.value,
    write: async (key, value) => void (await adapter.saveValue(key, { locale: "en", value })),
    signInUrl: `${origin}/editors/sign-in`,
    endSessions: () => sessions.clear(),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
