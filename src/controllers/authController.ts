import { ApiRequest, ApiResponse } from "../lib/http.js";
import { readJsonBody } from "../lib/adminAuth.js";
import { createConfirmedUser, isValidEmail, validatePassword } from "../services/authService.js";

/** Verification-free sign-up: creates a pre-confirmed account and returns success. */
export async function handleSignup(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = readJsonBody<{ email?: string; password?: string }>(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!isValidEmail(email)) {
    res.status(400).json({ success: false, message: "Enter a valid email address." });
    return;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    res.status(400).json({ success: false, message: passwordError });
    return;
  }

  try {
    await createConfirmedUser(email, password);
    res.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign up failed";
    const friendly = /registered|already|exists/i.test(message)
      ? "An account with this email already exists."
      : message;
    res.status(400).json({ success: false, message: friendly });
  }
}
