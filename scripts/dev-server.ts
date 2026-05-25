import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiRequest, ApiResponse } from "../src/lib/http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT ?? "3000");

type RouteHandler = (req: ApiRequest, res: ApiResponse) => Promise<void>;
type RouteModule = { default: RouteHandler };

type RouteDefinition = {
  method: string;
  pattern: RegExp;
  modulePath: string;
};

const routes: Array<RouteDefinition> = [
  { method: "POST", pattern: /^\/api\/ajax$/, modulePath: "../api/ajax.js" },
  { method: "GET", pattern: /^\/api\/cart\/get$/, modulePath: "../api/cart/get.js" },
  { method: "POST", pattern: /^\/api\/contact\/submit$/, modulePath: "../api/contact/submit.js" },
  { method: "GET", pattern: /^\/api\/products$/, modulePath: "../api/products/index.js" },
  { method: "GET", pattern: /^\/api\/products\/([^/]+)$/, modulePath: "../api/products/[slug].js" },
  // Verification-free sign-up (creates a pre-confirmed account)
  { method: "POST", pattern: /^\/api\/auth\/signup$/, modulePath: "../api/auth/signup.js" },
  // Public content read (key captured as match[1] -> query.slug)
  { method: "GET", pattern: /^\/api\/content\/([^/]+)$/, modulePath: "../api/content/[key].js" },
  // Admin endpoints (gated server-side by requireAdmin)
  { method: "GET", pattern: /^\/api\/admin\/session$/, modulePath: "../api/admin/session.js" },
  { method: "POST", pattern: /^\/api\/admin\/content$/, modulePath: "../api/admin/content.js" },
  { method: "PUT", pattern: /^\/api\/admin\/content$/, modulePath: "../api/admin/content.js" },
  { method: "GET", pattern: /^\/api\/admin\/products$/, modulePath: "../api/admin/products.js" },
  { method: "POST", pattern: /^\/api\/admin\/products$/, modulePath: "../api/admin/products.js" },
  { method: "PUT", pattern: /^\/api\/admin\/products$/, modulePath: "../api/admin/products.js" },
  { method: "DELETE", pattern: /^\/api\/admin\/products$/, modulePath: "../api/admin/products.js" },
  { method: "POST", pattern: /^\/api\/admin\/upload$/, modulePath: "../api/admin/upload.js" },
  // Square hosted checkout: create a payment link, and receive payment webhooks
  { method: "POST", pattern: /^\/api\/checkout\/create$/, modulePath: "../api/checkout/create.js" },
  { method: "POST", pattern: /^\/api\/checkout\/webhook$/, modulePath: "../api/checkout/webhook.js" },
];

function loadDotEnvFile(filePath: string): void {
  let text = "";

  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnvFile(path.join(rootDir, ".env"));

const routeHandlers = new Map<string, Promise<RouteHandler>>();

async function getRouteHandler(modulePath: string): Promise<RouteHandler> {
  const existing = routeHandlers.get(modulePath);
  if (existing) return existing;

  const promise = import(modulePath)
    .then((mod: RouteModule) => mod.default)
    .catch((error) => {
      routeHandlers.delete(modulePath);
      throw error;
    });
  routeHandlers.set(modulePath, promise);
  return promise;
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
    const file = await readFile(candidate);
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

  for (const route of routes) {
    if (req.method !== route.method) continue;
    const match = url.pathname.match(route.pattern);
    if (!match) continue;

    const body = req.method === "GET" || req.method === "HEAD" ? "" : await readRequestBody(req);
    const apiReq = toApiRequest(req, body);

    if (match[1]) {
      apiReq.query = { ...apiReq.query, slug: decodeURIComponent(match[1]) };
    }

    try {
      const handler = await getRouteHandler(route.modulePath);
      await handler(apiReq, createResponse(res));
    } catch (error) {
      sendApiError(res, error);
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end("Not found");
    }
    return;
  }

  const handled = await serveStaticFile(res, url.pathname);
  if (handled) return;

  res.statusCode = 404;
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`Local server running at http://localhost:${port}`);
});