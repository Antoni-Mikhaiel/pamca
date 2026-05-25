import { supabase } from "../lib/supabase.js";

/** Allowed singleton content keys edited by the admin. */
export const CONTENT_KEYS = ["pillars", "incident_report"] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

export function isContentKey(key: string): key is ContentKey {
  return (CONTENT_KEYS as readonly string[]).includes(key);
}

export async function getContent(key: ContentKey): Promise<unknown | null> {
  const { data, error } = await supabase
    .from("site_content")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as { value: unknown }).value : null;
}

export async function setContent(key: ContentKey, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("site_content")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}
