// Side-effect import: loads .env into process.env before the shared router (and
// thus src/lib/supabase.ts) is evaluated. Must stay first.
import "./load-env.js";

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiRequest, ApiResponse } from "../src/lib/http.js";
import { dispatch } from "../src/lib/routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT ?? "3000");
const staticAliases: Record<string, string> = {
  "/about-us": "/pamca_about.html",
  "/contact-us": "/contact-us.html",
  "/pharmacy-products": "/pharmacy-products.html",
  "/minor-ailments-prescribing-solution": "/pamca_minor_ailments.html",
};

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
  const normalized = staticAliases[pathname] ?? (pathname === "/" ? "/index.html" : pathname);
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
