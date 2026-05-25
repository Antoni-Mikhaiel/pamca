import { supabase } from "./supabase.js";
import { ApiRequest, ApiResponse, getHeader } from "./http.js";

export type AdminUser = { id: string; email: string; role: string };

/**
 * Verifies the `Authorization: Bearer <jwt>` on the request against Supabase Auth
 * and confirms the user has role 'admin' in user_profiles. Returns null otherwise.
 */
export async function getAdminUser(req: ApiRequest): Promise<AdminUser | null> {
  const header = getHeader(req, "authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("email, role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile || profile.role !== "admin") return null;

  return { id: data.user.id, email: profile.email, role: profile.role };
}

/**
 * Guard for write endpoints. Sends 401 and returns null if the caller is not an admin;
 * callers should `return` immediately when the result is null.
 */
export async function requireAdmin(req: ApiRequest, res: ApiResponse): Promise<AdminUser | null> {
  const user = await getAdminUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: "Admin authentication required" });
    return null;
  }
  return user;
}

/** Reads a JSON request body, tolerating both raw-string (dev server) and pre-parsed (Vercel) bodies. */
export function readJsonBody<T = Record<string, unknown>>(req: ApiRequest): T {
  const body = req.body;
  if (!body) return {} as T;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as T;
    } catch {
      return {} as T;
    }
  }
  if (typeof body === "object") return body as T;
  return {} as T;
}
