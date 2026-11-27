import { ApiRequest, ApiResponse } from "../lib/http.js";
import { requireCron } from "../lib/cronAuth.js";
import { expireAbandonedCheckouts, pruneRateLimits, pruneStaleCarts } from "../services/cleanupService.js";

/**
 * GET /api/cron/cleanup — daily Vercel cron (vercel.json). Deletes abandoned
 * checkouts (and their Square payment links), carts whose cookie has expired, and
 * old rate-limit counters. Each step runs independently so one failure doesn't
 * stop the others; the result is returned (and visible in the Vercel cron logs).
 */
export async function handleCleanup(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!requireCron(req, res)) return;

  const run = async <T>(name: string, step: () => Promise<T>) => {
    try {
      return await step();
    } catch (error) {
      console.error(`[cleanup] ${name} failed:`, error);
      return { error: true };
    }
  };

  const result = {
    abandonedCheckouts: await run("abandoned checkouts", expireAbandonedCheckouts),
    staleCartLines: await run("stale carts", pruneStaleCarts),
    rateLimitRows: await run("rate limits", pruneRateLimits),
  };
  console.log("[cleanup]", JSON.stringify(result));
  res.status(200).json({ success: true, data: result });
}
