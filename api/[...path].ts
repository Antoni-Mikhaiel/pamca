import type { IncomingMessage } from "node:http";
import { ApiRequest, ApiResponse } from "../src/lib/http.js";
import { dispatch } from "../src/lib/routes.js";

/**
 * Disable Vercel's automatic body parsing for this function. Vercel would
 * otherwise read the request stream and replace `req.body` with a parsed object,
 * which (a) destroys the exact bytes Square signed its webhook over — breaking
 * HMAC verification — and (b) diverges from the local dev server, which always
 * hands the router a raw-string body. We read the raw body ourselves below so
 * both runtimes behave identically and `parseBody`/`readJsonBody` (which already
 * accept a raw string) keep working for every other route.
 */
export const config = { api: { bodyParser: false } };

/** Reads the full request stream into a UTF-8 string (empty for GET/HEAD). */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

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
  // With bodyParser disabled, Vercel leaves the stream for us. Read it into a raw
  // string so the router sees the untouched payload (Square webhook signature
  // verification depends on the exact bytes). GET/HEAD carry no body.
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    try {
      const raw = await readRawBody(req as unknown as IncomingMessage);
      // Only overwrite when we actually captured bytes; if a future platform
      // change parses the body before us, don't clobber it with "".
      if (raw) req.body = raw;
    } catch {
      // Fall through with whatever body (if any) the platform provided.
    }
  }

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
