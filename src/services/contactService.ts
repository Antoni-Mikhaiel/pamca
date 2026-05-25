import { ContactSubmission } from "../models/types.js";
import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const recaptchaSecret = process.env.RECAPTCHA_SECRET ?? "";
const toEmail = process.env.CONTACT_TO_EMAIL ?? "sales@pamca.net";
const fromEmail = process.env.CONTACT_FROM_EMAIL ?? "noreply@pamca.net";

const resend = resendApiKey ? new Resend(resendApiKey) : null;

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
  if (!resend) {
    throw new Error("RESEND_API_KEY is not configured");
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

  await resend.emails.send({
    from: fromEmail,
    to: toEmail,
    subject,
    text,
    replyTo: input.email,
  });
}
