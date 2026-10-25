import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side only: uses the service role key, which bypasses RLS.
// Never import this from a client component.
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Unwraps a Supabase response, throwing on error. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
