import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseEnv, type Ctx } from "./supabase";

/** Supabase client bound to the request's session cookies (RLS applies). */
export async function userDb() {
  const { url, anonKey } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components can't set cookies; src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** The signed-in user's context, or a redirect to /login. Cached per request. */
export const requireCtx = cache(async (): Promise<Ctx & { email: string | null }> => {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) redirect("/login");
  return { db, ownerId: sub, email: (data.claims.email as string | undefined) ?? null };
});

export async function currentUserEmail(): Promise<string | null> {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  return (data?.claims?.email as string | undefined) ?? null;
}
