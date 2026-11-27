import { ApiRequest, ApiResponse, getHeader } from "./http.js";

/**
 * Guard for Vercel cron routes. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * when CRON_SECRET is set. Fails closed: with no secret configured the route
 * refuses to run, so it can never be triggered by the public. Returns false (and
 * has already responded) when the caller isn't the cron.
 */
export function requireCron(req: ApiRequest, res: ApiResponse): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    res.status(503).json({ success: false, message: "CRON_SECRET is not configured" });
    return false;
  }
  if (getHeader(req, "authorization") !== `Bearer ${secret}`) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return false;
  }
  return true;
}
