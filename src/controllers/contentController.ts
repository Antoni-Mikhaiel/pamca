import { ApiRequest, ApiResponse } from "../lib/http.js";
import { requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import { getContent, setContent, isContentKey } from "../services/contentService.js";

/** Public read of a singleton content document (pillars, incident_report). */
export async function handleGetContent(req: ApiRequest, res: ApiResponse): Promise<void> {
  const key = String(req.query?.key ?? req.query?.slug ?? "");
  if (!isContentKey(key)) {
    res.status(404).json({ success: false, message: "Unknown content key" });
    return;
  }
  const value = await getContent(key);
  res.status(200).json({ success: true, data: value });
}

/** Admin save of a content document. */
export async function handleSaveContent(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = readJsonBody<{ key?: string; value?: unknown }>(req);
  const key = String(body.key ?? "");
  if (!isContentKey(key)) {
    res.status(400).json({ success: false, message: "Unknown content key" });
    return;
  }
  await setContent(key, body.value ?? {});
  res.status(200).json({ success: true });
}
