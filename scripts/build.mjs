// Builds the Extension: four single-file bundles plus the static files, into a
// directory that is by itself a loadable extension.
//
//   node scripts/build.mjs            production build into dist/
//   node scripts/build.mjs --watch    rebuild bundles and re-copy static files on change
//   node scripts/build.mjs --e2e      test build into dist-e2e/ (see below)
import { context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";

const flags = new Set(process.argv.slice(2));
const e2e = flags.has("--e2e");
const watching = flags.has("--watch");
const root = new URL("../", import.meta.url);
const out = new URL(e2e ? "dist-e2e/" : "dist/", root);
const staticDir = new URL("static/", root);

async function copyStatic() {
  await cp(staticDir, out, { recursive: true });
  if (!e2e) return;
  // The browser's permission prompt cannot be clicked by a test, so the test build is granted the
  // fixture website's host at install. Everything after the grant is the shipped code. The
  // manifest test pins that the shipped manifest holds no such access.
  const manifestUrl = new URL("manifest.json", out);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  manifest.host_permissions = ["http://localhost/*"];
  await writeFile(manifestUrl, JSON.stringify(manifest, null, 2));
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const bundles = await context({
  entryPoints: {
    popup: "src/popup/main.ts",
    worker: "src/worker/main.ts",
    page: "src/page/main.ts",
    panel: "src/panel/main.ts",
  },
  absWorkingDir: new URL(".", root).pathname,
  outdir: out.pathname,
  bundle: true,
  // A script the browser injects into a page cannot rely on a module loader.
  format: "iife",
  // The minimum browser version of the manifest, and no lower.
  target: "chrome116",
  minify: true,
  sourcemap: true,
  logLevel: "info",
});

await copyStatic();
if (watching) {
  await bundles.watch();
  watch(staticDir.pathname, { recursive: true }, () => void copyStatic().catch((error) => console.error(error)));
} else {
  await bundles.rebuild();
  await bundles.dispose();
}
