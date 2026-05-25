import { supabase } from "../lib/supabase";

/** Single source of truth for password rules (mirrored on the client). */
export const PASSWORD_RULES = [
  { id: "len", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { id: "lower", label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { id: "upper", label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { id: "num", label: "A number", test: (p: string) => /[0-9]/.test(p) },
  { id: "sym", label: "A symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

/** Returns an error message if the password fails any rule, else null. */
export function validatePassword(password: string): string | null {
  if (typeof password !== "string") return "Password is required.";
  const failed = PASSWORD_RULES.find((rule) => !rule.test(password));
  return failed ? `Password needs: ${failed.label.toLowerCase()}.` : null;
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/**
 * Creates a Supabase auth user with the email pre-confirmed (no verification email),
 * then ensures a matching user_profiles row exists. Uses the service-role Admin API,
 * so it works regardless of the project's "Confirm email" setting.
 */
export async function createConfirmedUser(email: string, password: string): Promise<{ id: string }> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const user = data.user;
  if (!user) throw new Error("Could not create account");

  const { error: profileError } = await supabase
    .from("user_profiles")
    .upsert({ id: user.id, email, role: "user" }, { onConflict: "id" });
  if (profileError) throw profileError;

  return { id: user.id };
}
