import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export type UploadInput = { dataBase64: string; filename?: string; contentType?: string };

/** Decodes a base64 (or data-URL) image and stores it in Supabase Storage, returning its public URL. */
export async function uploadImage({ dataBase64, filename, contentType }: UploadInput): Promise<string> {
  let base64 = dataBase64 || "";
  let type = contentType || "";

  const match = base64.match(/^data:([^;]+);base64,(.*)$/s);
  if (match) {
    type = type || match[1];
    base64 = match[2];
  }
  if (!base64) throw new Error("No image data provided");
  if (type && !ALLOWED.has(type)) throw new Error(`Unsupported image type: ${type}`);

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Image data could not be decoded");
  if (buffer.length > MAX_BYTES) throw new Error("Image exceeds the 5 MB upload limit");

  const ext =
    filename && filename.includes(".")
      ? filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")
      : (type.split("/")[1] || "bin");
  const objectPath = `${new Date().getFullYear()}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;

  return supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}
