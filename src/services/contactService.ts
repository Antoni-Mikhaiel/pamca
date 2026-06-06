import { ContactSubmission } from "../models/types.js";
import { sendBrevoEmail } from "./emailService.js";

const recaptchaSecret = process.env.RECAPTCHA_SECRET ?? "";
// reCAPTCHA v3 returns a 0.0–1.0 score; reject submissions below this. Ignored for
// v2 responses (which carry no score). Override with RECAPTCHA_MIN_SCORE.
const recaptchaMinScore = Number(process.env.RECAPTCHA_MIN_SCORE ?? "0.5") || 0.5;
const toEmail = process.env.CONTACT_TO_EMAIL ?? "sales@pamca.net";

/**
 * Verifies a reCAPTCHA token via Google's siteverify. Works for both v3 (score
 * based) and v2 (challenge): the token must be valid, and — when a score is
 * present (v3) — it must meet the minimum threshold. Skipped entirely when no
 * secret is configured.
 */
export async function validateRecaptcha(token: string, remoteIp?: string): Promise<boolean> {
  if (!recaptchaSecret) return true;
  if (!token) return false;

  const body = new URLSearchParams({
    secret: recaptchaSecret,
    response: token,
  });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) return false;

  const json = (await response.json()) as { success?: boolean; score?: number };
  if (!json.success) return false;
  // v3 only: enforce the score threshold (v2 responses have no score).
  if (typeof json.score === "number" && json.score < recaptchaMinScore) return false;
  return true;
}

export async function sendContactEmail(input: ContactSubmission): Promise<void> {
  const fullName = `${input.firstName} ${input.lastName}`.trim();
  const subject = `New contact message from ${fullName}`;
  const text = [
    `Name: ${input.firstName} ${input.lastName}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone}`,
    "",
    "Message:",
    input.message,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">
      <p><strong>Name:</strong> ${escapeHtmlBasic(input.firstName)} ${escapeHtmlBasic(input.lastName)}</p>
      <p><strong>Email:</strong> ${escapeHtmlBasic(input.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtmlBasic(input.phone || "—")}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap;">${escapeHtmlBasic(input.message)}</p>
    </div>`;

  await sendBrevoEmail({
    to: [{ email: toEmail }],
    subject,
    html,
    text,
    replyTo: input.email ? { email: input.email, name: fullName } : undefined,
  });
}

function escapeHtmlBasic(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
