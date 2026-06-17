import { supabase } from "../lib/supabase.js";
import { CustomerDetails, UserProfile } from "../models/types.js";

const PROFILE_COLUMNS = "id, email, first_name, last_name, contact_email, street_number, street_name, province, postal_code, phone";

/**
 * Reads a user's profile, falling back to the login email for the contact email
 * when the shopper hasn't set a separate one yet. Returns sensible empty strings
 * (never null) so the client can bind the values straight into form inputs.
 */
export async function getProfile(userId: string, loginEmail: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;

  const row = (data ?? {}) as Record<string, string | null>;
  return {
    id: userId,
    loginEmail,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.contact_email || loginEmail || "",
    streetNumber: row.street_number ?? "",
    streetName: row.street_name ?? "",
    province: row.province ?? "",
    postalCode: row.postal_code ?? "",
    phone: row.phone ?? "",
  };
}

/**
 * Persists the editable contact/delivery fields. The login email and role are
 * never touched. Updates the existing profile row (created at sign-up); if it is
 * somehow missing, inserts a minimal one rather than clobbering anything.
 */
export async function updateProfile(userId: string, loginEmail: string, details: CustomerDetails): Promise<void> {
  const editable = {
    first_name: details.firstName,
    last_name: details.lastName,
    contact_email: details.email,
    street_number: details.streetNumber,
    street_name: details.streetName,
    province: details.province,
    postal_code: details.postalCode,
    phone: details.phone,
  };

  const { data, error } = await supabase
    .from("user_profiles")
    .update(editable)
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  if (data && data.length > 0) return;

  const { error: insertError } = await supabase
    .from("user_profiles")
    .insert({ id: userId, email: loginEmail, role: "user", ...editable });
  if (insertError) throw insertError;
}
