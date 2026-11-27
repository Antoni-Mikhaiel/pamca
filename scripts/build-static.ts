/**
 * Build step (run by `npm run build` on Vercel): produces dist/ — the deployed
 * static output (vercel.json `outputDirectory`) — from public/, which itself is
 * never modified:
 *   1. copy public/ -> dist/
 *   2. inline the shared header/footer into every page (crawlable navigation)
 *   3. stamp asset references with a content hash (?v=…) so they can be cached
 *      for a year (see vercel.json headers)
 *   4. minify JS/CSS files and the pages' inline <style>/<script> blocks
 */
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { inlinePartials } from "../src/lib/partials.js";
import { contentHash, versionAssets } from "../src/lib/assets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public");
const out = path.join(root, "dist");

await rm(out, { recursive: true, force: true });
await cp(src, out, { recursive: true });

const partials = {
  header: await readFile(path.join(src, "partials", "header.html"), "utf8"),
  footer: await readFile(path.join(src, "partials", "footer.html"), "utf8"),
};

// Hash the *source* file (same as the server-rendered pages do), so a given
// version of a file gets the same ?v= everywhere.
const hashCache = new Map<string, string | null>();
async function hashOf(publicPath: string): Promise<string | null> {
  if (!hashCache.has(publicPath)) {
    try {
      hashCache.set(publicPath, contentHash(await readFile(path.join(src, publicPath))));
    } catch {
      hashCache.set(publicPath, null);
    }
  }
  return hashCache.get(publicPath) ?? null;
}

async function minifyJs(code: string): Promise<string> {
  // Top-level names are kept (esbuild never renames them without bundling), so
  // inline onclick="fn()" handlers and cross-script globals keep working.
  return (await transform(code, { loader: "js", minify: true, legalComments: "none" })).code.trim();
}
async function minifyCss(code: string): Promise<string> {
  return (await transform(code, { loader: "css", minify: true, legalComments: "none" })).code.trim();
}

/** Minifies inline <style> and classic inline <script> blocks (not JSON-LD etc.). */
async function minifyInline(html: string): Promise<string> {
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  for (const m of html.matchAll(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi)) {
    blocks.push({ start: m.index! + m[1].length, end: m.index! + m[1].length + m[2].length, text: await minifyCss(m[2]) });
  }
  for (const m of html.matchAll(/(<script(\s[^>]*)?>)([\s\S]*?)(<\/script>)/gi)) {
    const attrs = m[2] ?? "";
    if (/\bsrc=/i.test(attrs) || !m[3].trim()) continue;
    const type = (attrs.match(/\btype="([^"]*)"/i) ?? [])[1];
    if (type && !/^(text|application)\/javascript$/i.test(type)) continue; // e.g. application/ld+json
    blocks.push({ start: m.index! + m[1].length, end: m.index! + m[1].length + m[3].length, text: await minifyJs(m[3]) });
  }
  blocks.sort((a, b) => b.start - a.start);
  let outHtml = html;
  for (const b of blocks) outHtml = outHtml.slice(0, b.start) + b.text + outHtml.slice(b.end);
  return outHtml;
}

let assetBefore = 0;
let assetAfter = 0;
const pages: string[] = [];
async function processDir(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await processDir(file);
      continue;
    }
    const rel = path.relative(out, file);
    if (entry.name.endsWith(".js") || entry.name.endsWith(".css")) {
      const code = await readFile(file, "utf8");
      const min = entry.name.endsWith(".js") ? await minifyJs(code) : await minifyCss(code);
      assetBefore += code.length;
      assetAfter += min.length;
      await writeFile(file, min);
    } else if (entry.name.endsWith(".html") && !rel.startsWith(`partials${path.sep}`)) {
      const html = await readFile(file, "utf8");
      const built = await minifyInline(await versionAssets(await inlinePartials(html, async (n) => partials[n]), hashOf));
      await writeFile(file, built);
      pages.push(rel);
    }
  }
}
await processDir(out);

console.log(
  `build-static: public/ -> dist/; ${pages.length} pages inlined + versioned; ` +
    `JS/CSS minified ${Math.round(assetBefore / 1024)} KB -> ${Math.round(assetAfter / 1024)} KB`,
);
