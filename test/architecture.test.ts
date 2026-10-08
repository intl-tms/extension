import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url);
const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((name) => name.endsWith(".ts")).sort();
const read = (name: string) => readFileSync(new URL(name, SRC), "utf8");
/** Source with comments removed, so a rule about code is not tripped by prose. */
const code = (name: string) => read(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const offenders = (pattern: RegExp, among = files) => among.filter((name) => pattern.test(code(name)));

const bootstraps = files.filter((name) => name.endsWith("/main.ts"));
const wiring = files.filter((name) => name.endsWith("/start.ts"));
const logic = files.filter((name) => !bootstraps.includes(name) && !wiring.includes(name));

describe("structure", () => {
  it("has one bootstrap per context", () => {
    expect(bootstraps).toEqual(["page/main.ts", "panel/main.ts", "popup/main.ts", "worker/main.ts"]);
  });

  it("no logic module touches a browser extension API", () => {
    expect(offenders(/\bchrome\s*\./, logic)).toEqual([]);
  });

  it("only the bootstraps name the browser's global", () => {
    expect(offenders(/\(\s*chrome\b|[,{]\s*runtime:\s*chrome\b/, [...logic, ...wiring])).toEqual([]);
  });

  it("the bootstraps contain no decisions", () => {
    expect(offenders(/\b(if|else|switch|for|while)\b|\?|&&|\|\|/, bootstraps)).toEqual([]);
  });

  it("PO27 nothing in the Popup can message the Worker or a page", () => {
    expect(offenders(/sendMessage|connect\(|runtime\b/, files.filter((name) => name.startsWith("popup/")))).toEqual([]);
  });

  it("the Extension has no runtime dependency other than the Core", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies)).toEqual(["@intl-tms/core"]);
  });

  it("source imports nothing but the Core and its own modules", () => {
    const foreign = files.flatMap((name) => [...code(name).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "").filter((from) => !from.startsWith(".") && !from.startsWith("@intl-tms/core")));
    expect(foreign).toEqual([]);
  });
});

describe("security", () => {
  it("nothing is ever inserted into a document as markup", () => {
    expect(offenders(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/)).toEqual([]);
  });

  it("no string is evaluated as code", () => {
    expect(offenders(/\beval\s*\(|new\s+Function\b|setTimeout\s*\(\s*["'`]/)).toEqual([]);
  });

  it("no style is generated in script", () => {
    expect(offenders(/\.style\b|createElement\(\s*"style"|setAttribute\(\s*"style"/)).toEqual([]);
  });

  it("no selector is built from data", () => {
    expect(offenders(/querySelector(All)?(<[^>]*>)?\(\s*`[^`]*\$\{/)).toEqual([]);
  });

  it("no credential is stored or attached to a request", () => {
    expect(offenders(/authorization|bearer|api[-_]?key|password|\btoken\b/i)).toEqual([]);
  });
});

describe("strings", () => {
  it("every stylesheet rule uses named tokens, never a literal colour", () => {
    const sheets = ["popup.css", "panel.css"].map((name) => readFileSync(new URL(`../static/${name}`, import.meta.url), "utf8"));
    expect(sheets.flatMap((sheet) => sheet.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [])).toEqual([]);
  });

  it("the views carry no literal user-facing text", () => {
    const literal = /(textContent|placeholder|title)\s*=\s*"[^"]+"|element\(\s*"[a-z0-9]+"\s*,\s*(undefined|"[^"]*")\s*,\s*"[^"]+"/;
    expect(offenders(literal, ["panel/view.ts", "popup/view.ts"])).toEqual([]);
  });
});
