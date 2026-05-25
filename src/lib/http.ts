import { randomUUID } from "node:crypto";

export type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
};

export type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string | string[]) => void;
  json: (value: unknown) => void;
  send: (value: string) => void;
  end: (value?: string) => void;
};

export function getHeader(req: ApiRequest, key: string): string {
  const value = req.headers?.[key.toLowerCase()] ?? req.headers?.[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parseCookies(req: ApiRequest): Record<string, string> {
  if (req.cookies) return req.cookies;
  const raw = getHeader(req, "cookie");
  if (!raw) return {};

  return raw.split(";").reduce<Record<string, string>>((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

export async function parseBody(req: ApiRequest): Promise<Record<string, string>> {
  if (!req.body) return {};

  if (typeof req.body === "string") {
    return parseBodyString(req.body, getHeader(req, "content-type"));
  }

  if (typeof req.body === "object" && req.body !== null) {
    const obj = req.body as Record<string, unknown>;
    return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
      if (v === undefined || v === null) return acc;
      acc[k] = String(v);
      return acc;
    }, {});
  }

  return {};
}

function parseBodyString(raw: string, contentType: string): Record<string, string> {
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
  }

  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function ensureCartToken(req: ApiRequest, res: ApiResponse): string {
  const cookies = parseCookies(req);
  if (cookies.cart_token) return cookies.cart_token;

  const token = randomUUID();
  const cookie = `cart_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  res.setHeader("Set-Cookie", cookie);
  return token;
}

export function toCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}
