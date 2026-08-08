/**
 * Fold `dist/` into one self-contained HTML file with no external requests.
 *
 * Run after `vite build`. Emits two flavors from the same bundle:
 *
 *   dist/standalone.html — a complete document. Open it over file://, mail it,
 *                          drop it on any static host.
 *   dist/artifact.html   — the same page as a <body> fragment, for hosts that
 *                          supply their own document skeleton (Claude
 *                          Artifacts) and would otherwise nest <html> tags.
 *
 * The Monte Carlo worker is already inlined by Vite (`?worker&inline` in
 * App.tsx), so a stray asset chunk here means something regressed — we fail
 * loudly rather than ship a page that 404s at runtime.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const html = readFileSync(join(dist, "index.html"), "utf8");

/** Neutralize `</script` inside JS so it can't terminate the host <script>. */
const escapeForScript = (js) => js.replace(/<\/script/gi, "<\\/script");

const read = (src) => readFileSync(join(dist, src.replace(/^\//, "")), "utf8");

const used = new Set();

let out = html
  .replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (_m, src) => {
    used.add(src.replace(/^\//, ""));
    return `<script type="module">${escapeForScript(read(src))}</script>`;
  })
  .replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi, (_m, href) => {
    used.add(href.replace(/^\//, ""));
    return `<style>${read(href)}</style>`;
  });

// Every emitted asset must have been folded in; anything left would be a
// runtime 404 on a host that only receives the single file.
const orphans = readdirSync(join(dist, "assets")).filter((f) => !used.has(`assets/${f}`));
if (orphans.length) {
  console.error(`inline-build: ${orphans.length} asset(s) not inlined: ${orphans.join(", ")}`);
  console.error("The page would 404 on these. Check that the worker import still uses ?worker&inline.");
  process.exit(1);
}

writeFileSync(join(dist, "standalone.html"), out);

// Fragment flavor: strip the document scaffolding but keep everything that
// carries content. Vite emits the module script into <head>, so pull title and
// style from there, then the mount point, then the script last.
const head = out.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const body = out.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? "";
const pick = (src, tag) => [...src.matchAll(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi"))].map((m) => m[0]);

const fragment = [
  ...pick(head, "title"),
  ...pick(head, "style"),
  body.replace(/<script[\s\S]*?<\/script>/gi, "").trim(),
  ...pick(head, "script"),
  ...pick(body, "script"),
].filter(Boolean);

if (!fragment.some((part) => part.startsWith("<script"))) {
  console.error("inline-build: no script survived into artifact.html — the page would be blank.");
  process.exit(1);
}
writeFileSync(join(dist, "artifact.html"), `${fragment.join("\n")}\n`);

const kb = (name) => (readFileSync(join(dist, name), "utf8").length / 1024).toFixed(0);
console.log(`inline-build: standalone.html ${kb("standalone.html")} kB, artifact.html ${kb("artifact.html")} kB`);
