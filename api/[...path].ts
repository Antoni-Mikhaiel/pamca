import { ApiRequest, ApiResponse } from "../src/lib/http";
import { dispatch } from "../src/lib/routes";

/**
 * The entire API as a single Vercel Serverless Function. Vercel routes every
 * `/api/*` request here and exposes the path segments as `req.query.path`; we
 * rebuild the pathname and hand off to the shared router in src/lib/routes.ts
 * (the same router the local dev server uses).
 *
 * One function instead of one-per-endpoint keeps us within the Hobby plan's
 * 12-function-per-deployment limit.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const raw = req.query?.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const pathname = "/api/" + segments.map((s) => encodeURIComponent(s)).join("/");

  const handled = await dispatch(req, res, pathname);
  if (!handled) {
    res.status(404).json({ success: false, message: "Not found" });
  }
}
