import { ApiRequest, ApiResponse } from "../lib/http.js";
import { requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import { getHSTPercent, setHSTPercent } from "../services/taxService.js";

/**
 * Get the current HST percent setting.
 */
export async function handleGetHST(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const hstPercent = await getHSTPercent();
  res.status(200).json({ success: true, data: { hstPercent } });
}

/**
 * Set the HST percent setting.
 * Body: { hstPercent: number }
 */
export async function handleSetHST(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = readJsonBody<Record<string, unknown>>(req);
  const percent = Number(body.hstPercent ?? 13);

  if (typeof percent !== "number" || percent < 0 || percent > 100) {
    res.status(400).json({ success: false, message: "HST percent must be between 0 and 100" });
    return;
  }

  const hstPercent = await setHSTPercent(percent);
  res.status(200).json({ success: true, data: { hstPercent } });
}
