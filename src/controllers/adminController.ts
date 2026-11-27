import { ApiRequest, ApiResponse } from "../lib/http.js";
import { getAdminUser, requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import { createImageUploadUrl } from "../services/uploadService.js";

/** Reports whether the bearer token belongs to an admin — used by the admin UI to gate access. */
export async function handleSession(req: ApiRequest, res: ApiResponse): Promise<void> {
  const user = await getAdminUser(req);
  res.status(200).json({ success: true, data: { isAdmin: !!user, email: user?.email ?? null } });
}

/**
 * Returns a signed URL the admin browser PUTs the image to directly, plus the
 * public URL it will live at. Images bypass the function (and Vercel's 4.5 MB
 * body limit) entirely.
 */
export async function handleUploadUrl(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = readJsonBody<{ contentType?: string; size?: number }>(req);
  try {
    const data = await createImageUploadUrl({ contentType: body.contentType, size: Number(body.size) || undefined });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Could not start upload" });
  }
}
