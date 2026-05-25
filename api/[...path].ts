import { ApiRequest, ApiResponse } from "../src/lib/http.js";
import { dispatch } from "../src/lib/routes.js";

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
  // Vercel delivers the path either as an array of segments (native catch-all)
  // or, via the vercel.json rewrite, as a single "a/b/c" string. Join without
  // re-encoding so the embedded "/" separators survive for the route match;
  // dispatch() decodeURIComponent's the captured dynamic segment itself.
  const raw = req.query?.path;
  const joined = Array.isArray(raw) ? raw.join("/") : typeof raw === "string" ? raw : "";
  const pathname = "/api/" + joined;

  const handled = await dispatch(req, res, pathname);
  if (!handled) {
    res.status(404).json({ success: false, message: "Not found" });
  }
}
