import { CustomerDetails } from "../models/types.js";

/**
 * Normalizes a phone input to `+1` + exactly 10 digits (Canada only). Strips any
 * formatting and a leading country code; returns null when there aren't 10 usable
 * digits. Storing one canonical form lets guest order lookup compare phones exactly.
 */
export function normalizePhone(input: unknown): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  // Drop a leading '1' country code if the shopper typed it.
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return `+1${national}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export type CustomerValidation =
  | { ok: true; value: CustomerDetails }
  | { ok: false; error: string };

/** Validates + normalizes the checkout/profile customer fields. */
export function validateCustomerDetails(input: Record<string, unknown>): CustomerValidation {
  const firstName = String(input.firstName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const streetNumber = String(input.streetNumber ?? "").trim();
  const streetName = String(input.streetName ?? "").trim();
  const province = String(input.province ?? "").trim().toUpperCase();
  const postalCode = String(input.postalCode ?? "").trim().toUpperCase();
  const phone = normalizePhone(input.phone);

  if (!firstName) return { ok: false, error: "First name is required." };
  if (!lastName) return { ok: false, error: "Last name is required." };
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!streetNumber) return { ok: false, error: "Street number is required." };
  if (!streetName) return { ok: false, error: "Street name is required." };
  if (!province || province.length !== 2) return { ok: false, error: "Enter a valid province code (2 letters)." };
  if (!postalCode) return { ok: false, error: "Postal code is required." };
  if (!phone) return { ok: false, error: "Enter a valid 10-digit Canadian phone number." };

  return { ok: true, value: { firstName, lastName, email, streetNumber, streetName, province, postalCode, phone } };
}
