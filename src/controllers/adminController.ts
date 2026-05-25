import { ApiRequest, ApiResponse } from "../lib/http.js";
import { getAdminUser, requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import { uploadImage } from "../services/uploadService.js";

/** Reports whether the bearer token belongs to an admin — used by the admin UI to gate access. */
export async function handleSession(req: ApiRequest, res: ApiResponse): Promise<void> {
  const user = await getAdminUser(req);
  res.status(200).json({ success: true, data: { isAdmin: !!user, email: user?.email ?? null } });
}

/** Accepts a base64/data-URL image, stores it in Supabase Storage, returns the public URL. */
export async function handleUpload(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = readJsonBody<{ dataBase64?: string; filename?: string; contentType?: string }>(req);
  if (!body.dataBase64) {
    res.status(400).json({ success: false, message: "No image data provided" });
    return;
  }
  const url = await uploadImage({
    dataBase64: body.dataBase64,
    filename: body.filename,
    contentType: body.contentType,
  });
  res.status(200).json({ success: true, data: { url } });
}
