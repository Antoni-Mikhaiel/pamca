import { createHash } from "node:crypto";

/**
 * Cache-busting for static assets. Every same-origin `src="/…"` / `href="/…"`
 * reference to a JS/CSS/image file gets `?v=<content hash>`, so browsers and the
 * CDN can cache those URLs for a year (`immutable`, see vercel.json) and a changed
 * file is fetched again only because its URL changed. Used by the build
 * (scripts/build-static.ts) and the server-rendered pages, both hashing the file in
 * public/, so they always produce the same URL for the same content.
 */
export type AssetHasher = (publicPath: string) => Promise<string | null>;

const ASSET_REF = /(\s(?:src|href)=")(\/(?!\/)[^"?#\s]+\.(?:js|css|webp|png|jpe?g|gif|svg|ico))(")/g;

export function contentHash(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 10);
}

export async function versionAssets(html: string, hashOf: AssetHasher): Promise<string> {
  const paths = new Set([...html.matchAll(ASSET_REF)].map((m) => m[2]));
  const hashes = new Map<string, string>();
  for (const p of paths) {
    const h = await hashOf(p);
    if (h) hashes.set(p, h);
  }
  return html.replace(ASSET_REF, (all, pre: string, p: string, post: string) =>
    hashes.has(p) ? `${pre}${p}?v=${hashes.get(p)}${post}` : all,
  );
}
