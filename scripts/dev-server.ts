// Side-effect import: loads .env into process.env before the shared router (and
// thus src/lib/supabase.ts) is evaluated. Must stay first.
import "./load-env.js";

import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiRequest, ApiResponse } from "../src/lib/http.js";
import { dispatch } from "../src/lib/routes.js";
import { inlinePartials } from "../src/lib/partials.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
// `--dist` serves the production build output (npm run preview) instead of public/.
const publicDir = path.join(rootDir, process.argv.includes("--dist") ? "dist" : "public");
const port = Number(process.env.PORT ?? "3000");
type VercelRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: Array<{ type: string; key: string; value?: string }>;
};

// Mirror vercel.json's redirects + rewrites locally so dev behaves like production
// (one source of truth: clean URLs, legacy redirects, /products/:slug, /sitemap.xml).
const vercelConfig = JSON.parse(readFileSync(path.join(rootDir, "vercel.json"), "utf8")) as {
  redirects?: VercelRule[];
  rewrites?: VercelRule[];
};

/** Compiles a Vercel path pattern ("/products/:slug", "/api/:path*") to a RegExp + param names. */
function compilePattern(source: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const body = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)(\*)?/g, (_m, name: string, star?: string) => {
    names.push(name);
    return star ? "(.*)" : "([^/]+)";
  });
  return { re: new RegExp(`^${body}$`), names };
}

/** Matches a rule (path + optional `has` query conditions) and fills its destination params. */
function applyRule(rule: VercelRule, pathname: string, search: URLSearchParams): string | null {
  const { re, names } = compilePattern(rule.source);
  const m = pathname.match(re);
  if (!m) return null;
  const params: Record<string, string> = {};
  names.forEach((n, i) => (params[n] = m[i + 1] ?? ""));
  for (const cond of rule.has ?? []) {
    if (cond.type !== "query") return null;
    const value = search.get(cond.key);
    if (value == null) return null;
    if (cond.value) {
      const cm = value.match(new RegExp(`^(?:${cond.value})$`));
      if (!cm) return null;
      Object.assign(params, cm.groups ?? {});
    }
  }
  return rule.destination.replace(/:(\w+)\*?/g, (_m, n: string) => params[n] ?? "");
}

function sendApiError(res: http.ServerResponse, error: unknown): void {
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    }),
  );
}

function createResponse(res: http.ServerResponse): ApiResponse {
  let statusCode = 200;

  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      res.setHeader(name, value);
    },
    json(value: unknown) {
      if (!res.headersSent) {
        res.statusCode = statusCode;
        if (!res.getHeader("Content-Type")) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
      }
      res.end(JSON.stringify(value));
    },
    send(value: string) {
      if (!res.headersSent) {
        res.statusCode = statusCode;
      }
      res.end(value);
    },
    end(value?: string) {
      if (!res.headersSent) {
        res.statusCode = statusCode;
      }
      res.end(value);
    },
  };
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function toApiRequest(req: http.IncomingMessage, body: string): ApiRequest {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value : value ?? undefined]),
  ) as Record<string, string | string[] | undefined>;

  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  return {
    method: req.method,
    headers,
    body: body || undefined,
    query,
  };
}

function getContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (filePath.endsWith(".xml")) return "application/xml; charset=utf-8";
  return "application/octet-stream";
}

async function serveStaticFile(res: http.ServerResponse, pathname: string): Promise<boolean> {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const candidate = path.resolve(publicDir, `.${normalized}`);

  if (!candidate.startsWith(publicDir)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return true;
  }

  try {
    let file: Buffer | string = await readFile(candidate);
    // Inline the header/footer like the production build (scripts/build-static.ts).
    if (candidate.endsWith(".html") && !candidate.includes(`${path.sep}partials${path.sep}`)) {
      file = await inlinePartials(file.toString("utf8"), (name) => readFile(path.join(publicDir, "partials", `${name}.html`), "utf8"));
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(candidate));
    res.end(file);
    return true;
  } catch {
    return false;
  }
}

async function handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  const body = req.method === "GET" || req.method === "HEAD" ? "" : await readRequestBody(req);
  const apiReq = toApiRequest(req, body);

  try {
    // The shared router (src/lib/routes.ts) matches method + path, injects any
    // dynamic segment into req.query, and catches handler errors itself. It is
    // the same dispatcher the Vercel catch-all function uses.
    return await dispatch(apiReq, createResponse(res), url.pathname);
  } catch (error) {
    sendApiError(res, error);
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // 1) Redirects (permanent 308s), exactly as vercel.json declares them.
  for (const rule of vercelConfig.redirects ?? []) {
    const target = applyRule(rule, url.pathname, url.searchParams);
    if (target != null) {
      res.statusCode = rule.permanent === false ? 307 : 308;
      res.setHeader("Location", target + (target.includes("?") ? "" : url.search));
      res.end();
      return;
    }
  }

  // 2) Real files win over rewrites (same as Vercel's filesystem-first routing).
  if (!url.pathname.startsWith("/api/") && (await serveStaticFile(res, url.pathname))) return;

  // 3) Rewrites. "/api/[...path]?path=x/y" means "the API route /api/x/y".
  let target = url.pathname;
  for (const rule of vercelConfig.rewrites ?? []) {
    const dest = applyRule(rule, url.pathname, url.searchParams);
    if (dest == null) continue;
    const [destPath, destQuery] = dest.split("?");
    target =
      destPath === "/api/[...path]"
        ? "/api/" + (new URLSearchParams(destQuery ?? "").get("path") ?? url.pathname.replace(/^\/api\//, ""))
        : destPath;
    break;
  }

  if (target.startsWith("/api/")) {
    req.url = target + url.search;
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end("Not found");
    }
    return;
  }

  if (await serveStaticFile(res, target)) return;

  // 4) Same custom 404 page Vercel serves.
  try {
    const notFound = await inlinePartials(await readFile(path.join(publicDir, "404.html"), "utf8"), (name) =>
      readFile(path.join(publicDir, "partials", `${name}.html`), "utf8"),
    );
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(notFound);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Local server running at http://localhost:${port}`);
});
