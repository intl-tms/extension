// Renders the shipped icon PNGs from icon/icon.svg, and a preview sheet to
// eyeball the small sizes with.
//
//   pnpm icons
//
// Chrome wants a PNG per size; the SVG is the only source that is edited. The
// browser that builds the extension does the rasterising, so there is no image
// toolchain to install.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 128];
/** Below this, the stripped artwork is the one that still reads. */
const SMALL_BELOW = 48;
const root = new URL("../", import.meta.url);
const master = await readFile(new URL("icon/icon.svg", root), "utf8");
const small = await readFile(new URL("icon/icon-small.svg", root), "utf8");
const sourceFor = (size) => (size < SMALL_BELOW ? small : master);

const browser = await chromium.launch();

async function render(svg, size, out) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;padding:0}svg{display:block}</style>${svg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`)}`);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
}

for (const size of SIZES) {
  await render(sourceFor(size), size, fileURLToPath(new URL(`static/icons/icon-${size}.png`, root)));
  console.log(`static/icons/icon-${size}.png  (icon${size < SMALL_BELOW ? "-small" : ""}.svg)`);
}

// A sheet at the sizes a toolbar actually shows, on both page backgrounds. It
// is for looking at, not for shipping, so it is not kept in the repository.
const sheet = await browser.newPage({ viewport: { width: 520, height: 200 }, deviceScaleFactor: 2 });
const row = (bg, label) => `<div style="background:${bg};padding:16px;display:flex;gap:24px;align-items:center">
  <span style="font:11px system-ui;color:${bg === "#ffffff" ? "#333" : "#ddd"};width:52px">${label}</span>
  ${SIZES.map((s) => `<img src="icon-${s}.png" width="${s}" height="${s}" style="image-rendering:auto">`).join("")}
  <img src="icon-128.png" width="24" height="24">
</div>`;
await sheet.setContent(`<style>body{margin:0;font:12px system-ui}</style><base href="${new URL("static/icons/", root).href}">${row("#ffffff", "light")}${row("#202124", "dark")}`);
await sheet.waitForTimeout(200);
await sheet.screenshot({ path: fileURLToPath(new URL("icon/preview.png", root)), fullPage: true });
console.log("icon/preview.png");

await browser.close();
