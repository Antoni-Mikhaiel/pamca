import { readFile } from "node:fs/promises";
import path from "node:path";

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
