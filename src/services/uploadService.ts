import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
// Raster formats only: SVG can carry script, so it's refused here and by the bucket's
// own allowed_mime_types (docs/supabase-schema.sql), which mirrors this list + limit.
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadUrlInput = { contentType?: string; size?: number };
export type UploadUrlResult = { uploadUrl: string; publicUrl: string };

/**
 * Issues a one-time signed URL the admin's browser uploads the file to directly
 * (PUT to Supabase Storage), plus the public URL it will be served from. The file
 * never passes through the serverless function, so Vercel's 4.5 MB request-body
 * limit doesn't apply; the bucket enforces the 5 MB / image-type rules itself.
 */
export async function createImageUploadUrl({ contentType, size }: UploadUrlInput): Promise<UploadUrlResult> {
  const type = String(contentType ?? "").toLowerCase();
  const ext = EXTENSIONS[type];
  if (!ext) throw new Error("Unsupported image type. Use PNG, JPEG, WebP or GIF.");
  if (typeof size === "number" && size > MAX_BYTES) throw new Error("Image exceeds the 5 MB upload limit");

  const objectPath = `${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(objectPath);
  if (error) throw error;

  return {
    uploadUrl: data.signedUrl,
    publicUrl: supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl,
  };
}
