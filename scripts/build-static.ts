/**
 * Build step (run by `npm run build` on Vercel): copies public/ to dist/ — the
 * deployed static output (vercel.json `outputDirectory`) — and inlines the shared
 * header/footer partials into every page, so crawlers and first paint get the
 * full navigation without JavaScript. public/ itself is never modified.
 */
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inlinePartials } from "../src/lib/partials.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public");
const out = path.join(root, "dist");

await rm(out, { recursive: true, force: true });
await cp(src, out, { recursive: true });

const partials = {
  header: await readFile(path.join(src, "partials", "header.html"), "utf8"),
  footer: await readFile(path.join(src, "partials", "footer.html"), "utf8"),
};

let pages = 0;
for (const entry of await readdir(out, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const file = path.join(out, entry.name);
  const html = await readFile(file, "utf8");
  const inlined = await inlinePartials(html, async (name) => partials[name]);
  if (inlined !== html) {
    await writeFile(file, inlined);
    pages++;
  }
}
console.log(`build-static: copied public/ -> dist/, inlined header/footer into ${pages} pages`);
