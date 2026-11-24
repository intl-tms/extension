// Renders the Side Panel in an ordinary browser tab, with a fixture selection
// already open, so the UI can be looked at without loading the extension,
// reloading it in chrome://extensions and reopening the panel.
//
//   node scripts/preview.mjs         build once and print the address
//   node scripts/preview.mjs --watch rebuild on change
//
// It is a development tool: nothing in src/ imports it and nothing tests it.
import { context } from "esbuild";
import { cp, mkdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL(".preview/out/", root);
const watching = new Set(process.argv.slice(2)).has("--watch");

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Panel preview</title>
    <link rel="stylesheet" href="tokens.css" />
    <link rel="stylesheet" href="panel.css" />
    <style>
      /* The Side Panel's own width, on a ground that is not the panel's, so its edges show. */
      body { margin: 0; background: #d4d4d8; }
      #frame { width: 360px; height: 100vh; background: var(--surface); overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="frame"><main id="app" style="height: 100%"></main></div>
    <script src="preview.js"></script>
  </body>
</html>
`;

await mkdir(out, { recursive: true });
await writeFile(new URL("index.html", out), page);

async function copyStyles() {
  for (const name of ["tokens.css", "panel.css"]) {
    await cp(new URL(`static/${name}`, root), new URL(name, out));
  }
}

const bundle = await context({
  entryPoints: { preview: ".preview/preview.ts" },
  absWorkingDir: new URL(".", root).pathname,
  outdir: out.pathname,
  bundle: true,
  format: "iife",
  target: "chrome116",
  logLevel: "info",
});

await copyStyles();
if (watching) {
  await bundle.watch();
} else {
  await bundle.rebuild();
  await bundle.dispose();
}
console.log(`\nOpen: ${new URL("index.html", out).href}`);
