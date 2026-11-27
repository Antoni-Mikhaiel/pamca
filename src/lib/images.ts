const STORAGE_PREFIX = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//;

/**
 * Product photos are stored full-size (often 1000-1500px) in Supabase Storage.
 * On Vercel, serve them through Vercel Image Optimization (vercel.json `images`)
 * resized to the slot and as AVIF/WebP. Widths must be listed in vercel.json
 * `images.sizes`. Mirrors optimizedImage() in public/shared-scripts.js exactly, so a
 * server preload and the page request the same URL.
 */
export function optimizedImage(src: string, width: number): string {
  if (!src || process.env.VERCEL !== "1" || !STORAGE_PREFIX.test(src)) return src;
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${width}&q=75`;
}
