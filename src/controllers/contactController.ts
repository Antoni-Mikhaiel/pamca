import { parseBody, ApiRequest, ApiResponse, getClientIp } from "../lib/http.js";
import { allowRequest } from "../services/rateLimitService.js";
import { sendContactEmail, validateRecaptcha } from "../services/contactService.js";

function redirect(res: ApiResponse, location: string): void {
  res.status(302);
  res.setHeader("Location", location);
  res.end();
}

export async function handleContactSubmit(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }

  const body = await parseBody(req);

  if ((body.website_hp ?? "").trim() !== "") {
    redirect(res, "/contact-us?status=error&reason=spam");
    return;
  }

  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const message = (body.message ?? "").trim();
  const recaptchaResponse = (body["g-recaptcha-response"] ?? "").trim();

  if (!firstName || !lastName || !email || !message) {
    redirect(res, "/contact-us?status=error&reason=required");
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    redirect(res, "/contact-us?status=error&reason=email");
    return;
  }

  // Budget per IP even when reCAPTCHA passes (or isn't configured): each accepted
  // submission sends an email to the shop.
  const remoteIp = getClientIp(req);
  if (!(await allowRequest("contact", remoteIp))) {
    redirect(res, "/contact-us?status=error&reason=rate");
    return;
  }

  const captchaOk = await validateRecaptcha(recaptchaResponse, remoteIp);
  if (!captchaOk) {
    redirect(res, "/contact-us?status=error&reason=captcha");
    return;
  }

  try {
    await sendContactEmail({
      firstName,
      lastName,
      email,
      phone,
      message,
      recaptchaResponse,
      websiteHp: body.website_hp ?? "",
    });

    redirect(res, "/contact-us?status=success");
  } catch {
    redirect(res, "/contact-us?status=error&reason=send");
  }
}
