import { ContactSubmission } from "../models/types.js";

// Transactional email is sent through Brevo (the domain is already authenticated
// there). Only the API key is needed — we call Brevo's REST API directly.
const brevoApiKey = process.env.BREVO_API_KEY ?? "";
const recaptchaSecret = process.env.RECAPTCHA_SECRET ?? "";
const toEmail = process.env.CONTACT_TO_EMAIL ?? "sales@pamca.net";
const fromEmail = process.env.CONTACT_FROM_EMAIL ?? "noreply@pamca.net";
const fromName = process.env.CONTACT_FROM_NAME ?? "PAMCA Website";

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

  const json = (await response.json()) as { success?: boolean };
  return Boolean(json.success);
}

export async function sendContactEmail(input: ContactSubmission): Promise<void> {
  if (!brevoApiKey) {
    throw new Error("BREVO_API_KEY is not configured");
  }

  const subject = `New Inquiry: ${input.inquiryType} from ${input.firstName} ${input.lastName}`;
  const text = [
    `Name: ${input.firstName} ${input.lastName}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone}`,
    `Inquiry Type: ${input.inquiryType}`,
    "",
    "Message:",
    input.message,
  ].join("\n");

  // Brevo transactional email API. `sender.email` must be an authenticated sender
  // / domain in the Brevo account; replyTo is the person who filled the form.
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: toEmail }],
      replyTo: { email: input.email, name: `${input.firstName} ${input.lastName}`.trim() },
      subject,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Brevo email send failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
}
