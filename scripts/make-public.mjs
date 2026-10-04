// Scaffold a clean-history copy of the repo for public sharing.
// Copies the working tree into a sibling folder, EXCLUDING git history, build
// artifacts, node_modules, generated decks, and the private local profile.
// Usage: npm run make-public  [destination]   (default: ../fire-model-public)
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const dest = resolve(process.argv[2] || "../fire-model-public");

const EXCLUDE = new Set([".git", "node_modules", "dist", ".claude"]);
// Analysis/one-off scripts reference the private household; only this script
// itself is generic (and package.json's "make-public" entry needs it).
const SCRIPTS_KEEP = new Set([join("scripts", "make-public.mjs")]);
const EXCLUDE_SUFFIX = [".pptx", ".pdf"];
const EXCLUDE_EXACT = new Set([
  join("src", "data", "profile.local.ts"), // the private profile — never copy
]);

if (existsSync(dest)) {
  console.error(`Refusing to overwrite existing ${dest}. Remove it first.`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });

cpSync(root, dest, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(root.length + 1);
    if (!rel) return true;
    const top = rel.split(/[\\/]/)[0];
    if (EXCLUDE.has(top)) return false;
    if (top === "scripts" && rel !== "scripts" && !SCRIPTS_KEEP.has(rel)) return false;
    if (EXCLUDE_EXACT.has(rel)) return false;
    if (EXCLUDE_SUFFIX.some((s) => rel.endsWith(s))) return false;
    return true;
  },
});

// Remove the private profile if it somehow slipped through (belt and braces).
const leaked = join(dest, "src", "data", "profile.local.ts");
if (existsSync(leaked)) rmSync(leaked);

console.log(`Clean public copy written to: ${dest}`);
console.log("Next:");
console.log(`  cd ${dest}`);
console.log('  git init && git add -A && git commit -m "Initial public release"');
console.log("  gh repo create fire-model --public --source=. --push");
