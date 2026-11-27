import { readFile } from "node:fs/promises";
import path from "node:path";
import { contentHash } from "./assets.js";

/**
 * Reads an HTML template from public/ for server-rendered pages. On Vercel the
 * files are bundled into the function via `functions.includeFiles` in vercel.json;
 * if that ever fails, falls back to fetching the same file from the site's CDN so
 * the page still renders. Cached per warm instance.
 */
const cache = new Map<string, string>();
const SITE_URL = (process.env.SITE_URL ?? "https://www.pamca.net").replace(/\/$/, "");

export async function readPublicFile(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit != null) return hit;

  let html: string | null = null;
  for (const dir of [path.join(process.cwd(), "public"), path.join(process.cwd(), "..", "public")]) {
    try {
      html = await readFile(path.join(dir, name), "utf8");
      break;
    } catch {
      // try the next location
    }
  }

  if (html == null) {
    const res = await fetch(`${SITE_URL}/${name}`);
    if (!res.ok) throw new Error(`Template ${name} unavailable (${res.status})`);
    html = await res.text();
  }

  cache.set(name, html);
  return html;
}

const hashCache = new Map<string, string | null>();

/**
 * Content hash of a public/ asset (e.g. "/shared-scripts.js") for cache-busting
 * ?v= stamps; null when the file isn't available to this function. Cached per
 * warm instance. Must hash the same bytes as scripts/build-static.ts (the source).
 */
export async function hashPublicFile(publicPath: string): Promise<string | null> {
  if (hashCache.has(publicPath)) return hashCache.get(publicPath) ?? null;
  let hash: string | null = null;
  for (const dir of [path.join(process.cwd(), "public"), path.join(process.cwd(), "..", "public")]) {
    try {
      hash = contentHash(await readFile(path.join(dir, publicPath)));
      break;
    } catch {
      // try the next location
    }
  }
  hashCache.set(publicPath, hash);
  return hash;
}
