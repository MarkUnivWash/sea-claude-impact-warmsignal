import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Two kinds of client:
// - user client (src/lib/auth.ts): the signed-in user's session, so RLS limits it to their rows.
// - service client (here): bypasses RLS. Only for scripts, background jobs, and admin auth calls.
//   Every query made with it must filter by owner_id explicitly.

export type Ctx = { db: SupabaseClient; ownerId: string };

export function supabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
  }
  return { url, anonKey, serviceKey };
}

let service: SupabaseClient | null = null;

export function serviceDb(): SupabaseClient {
  if (service) return service;
  const { url, serviceKey } = supabaseEnv();
  service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return service;
}

/** Context for background work on behalf of a user (bypasses RLS; queries filter by ownerId). */
export function serviceCtx(ownerId: string): Ctx {
  return { db: serviceDb(), ownerId };
}

/** Unwraps a Supabase response, throwing on error. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
