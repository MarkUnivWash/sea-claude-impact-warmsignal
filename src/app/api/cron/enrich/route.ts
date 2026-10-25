import { refreshStaleEnrichment } from "@/lib/enrich";

// Daily job (vercel.json) that keeps web enrichment fresh: each run re-enriches contacts whose
// enrichment is older than REFRESH_AFTER_DAYS, so every contact is refreshed about every two weeks.
// New contacts are enriched on creation (src/app/actions.ts); this catches anything that failed then.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret configured, refuse.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await refreshStaleEnrichment());
}
