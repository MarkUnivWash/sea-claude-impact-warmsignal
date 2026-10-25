import { tavily, type TavilySearchResponse } from "@tavily/core";
import { z } from "zod";
import { FAST_MODEL, structuredCall, structuredStream } from "./claude";
import { must, type Ctx } from "./supabase";
import type { Contact, Enrichment } from "./types";

// Automatic contact enrichment: Tavily web search -> Claude identity check + summary.
// Public-web facts are stored separately from Alonso's notes and labeled unverified.
// Only name/company/title leave the system (never note contents).

const EnrichmentSchema = z.object({
  identity_confidence: z
    .enum(["high", "medium", "low", "none"])
    .describe("How sure you are the results are about THIS person/company, not a namesake"),
  identity_notes: z.string().describe("One short sentence explaining the identity judgment"),
  summary: z.string().describe("1-2 sentences on who they are and what their company does. Empty if not confident."),
  recent_signals: z
    .array(
      z.object({
        kind: z.enum(["funding", "hiring", "launch", "leadership_change", "partnership", "press", "other"]),
        text: z.string().describe("Max 15 words"),
        date: z.string().nullable().describe("YYYY-MM-DD if known"),
        source_url: z.string(),
      }),
    )
    .describe("Notable events from the past ~12 months that could create a reason to reach out"),
  possible_offers: z
    .array(z.object({ text: z.string().describe("Max 12 words"), date: z.string().nullable(), source_url: z.string() }))
    .describe("Expertise, access, or resources this person demonstrably has, per the sources"),
});

const SYSTEM = `You enrich a contact record for a relationship-intelligence tool using web search results. Accuracy matters more than coverage: attaching a stranger's news to a contact would embarrass the user.

- First decide whether the results are about this exact person/company. Same name alone is not enough; company and role should line up. If unsure, use "low" or "none" and leave everything else empty.
- Only state what the sources say. Every signal and offer needs a source_url copied from the results.
- Be terse.`;

let client: ReturnType<typeof tavily> | null = null;
function search() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY");
  return (client ??= tavily({ apiKey }));
}

/** Progress reported while enriching, for live UIs. `partial` is Claude's unfinished output: display only. */
export type EnrichEvent =
  | { type: "searching"; queries: { group: "person" | "company"; query: string }[] }
  | { type: "sources"; group: "person" | "company"; sources: { title: string; url: string; date: string | null }[] }
  | { type: "reading"; count: number }
  | { type: "partial"; data: unknown }
  | { type: "verifying" }
  | { type: "result"; enrichment: Enrichment };

export async function enrichContact(
  contact: Contact,
  opts: { onEvent?: (e: EnrichEvent) => void; signal?: AbortSignal } = {},
): Promise<Enrichment> {
  const emit = opts.onEvent ?? (() => {});
  const t = search();
  const personQuery = `"${contact.name}" ${contact.title ?? ""} ${contact.company ?? ""}`.trim();
  const companyQuery = contact.company ? `"${contact.company}" ${contact.industry ?? ""} news` : null;
  emit({
    type: "searching",
    queries: [
      { group: "person", query: personQuery },
      ...(companyQuery ? [{ group: "company" as const, query: companyQuery }] : []),
    ],
  });
  // Report each search as soon as it returns, rather than waiting for both.
  const reported = (group: "person" | "company") => (res: Pick<TavilySearchResponse, "results">) => {
    emit({
      type: "sources",
      group,
      sources: res.results.map((r) => ({ title: r.title, url: r.url, date: r.publishedDate || null })),
    });
    return res;
  };
  const [person, company] = await Promise.all([
    t.search(personQuery, { searchDepth: "basic", maxResults: 5 }).then(reported("person")),
    companyQuery
      ? t
          .search(companyQuery, { searchDepth: "basic", topic: "news", timeRange: "year", maxResults: 5 })
          .then(reported("company"))
      : Promise.resolve({ results: [] as TavilySearchResponse["results"] }),
  ]);

  const results = [...person.results, ...company.results].filter(
    (r, i, all) => all.findIndex((x) => x.url === r.url) === i,
  );
  if (results.length === 0) {
    const none: Enrichment = { status: "no_confident_match", identity_notes: "No web results found." };
    emit({ type: "result", enrichment: none });
    return none;
  }

  emit({ type: "reading", count: results.length });
  const call = {
    system: SYSTEM,
    user: `Contact: ${contact.name}, ${contact.title ?? "?"} at ${contact.company ?? "?"} (${contact.industry ?? "?"})

<search_results>
${results
  .map((r) => `<result url="${r.url}" date="${r.publishedDate ?? ""}">\n${r.title}\n${r.content.slice(0, 1200)}\n</result>`)
  .join("\n")}
</search_results>`,
    schema: EnrichmentSchema,
    model: FAST_MODEL,
    effort: "low" as const,
  };
  const out = opts.onEvent
    ? await structuredStream({ ...call, signal: opts.signal, onPartial: (data) => emit({ type: "partial", data }) })
    : await structuredCall(call);

  emit({ type: "verifying" });
  if (out.identity_confidence === "low" || out.identity_confidence === "none") {
    const none: Enrichment = { status: "no_confident_match", identity_notes: out.identity_notes };
    emit({ type: "result", enrichment: none });
    return none;
  }
  // Drop anything not traceable to a returned source.
  const urls = new Set(results.map((r) => r.url));
  const cited = <T extends { source_url: string }>(xs: T[]) => xs.filter((x) => urls.has(x.source_url));
  const recent_signals = cited(out.recent_signals);
  const possible_offers = cited(out.possible_offers);
  const usedUrls = new Set([...recent_signals, ...possible_offers].map((x) => x.source_url));
  const enrichment: Enrichment = {
    status: "matched",
    identity_confidence: out.identity_confidence,
    identity_notes: out.identity_notes,
    summary: out.summary,
    recent_signals,
    possible_offers,
    sources: results.filter((r) => usedUrls.has(r.url) || usedUrls.size === 0).slice(0, 5).map((r) => ({ title: r.title, url: r.url })),
  };
  emit({ type: "result", enrichment });
  return enrichment;
}

export async function enrichAndSave(
  ctx: Ctx,
  contactId: string,
  opts: Parameters<typeof enrichContact>[1] = {},
): Promise<Enrichment> {
  const { db: supabase, ownerId } = ctx;
  const contact = must<Contact>(
    await supabase.from("contacts").select("*").eq("owner_id", ownerId).eq("id", contactId).single(),
  );
  // Only the final, identity-gated result is saved; partial output never reaches the database.
  const enrichment = await enrichContact(contact, opts);
  must(
    await supabase
      .from("contacts")
      .update({ enrichment, enriched_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("id", contactId),
  );
  return enrichment;
}

/** Enriches contacts that have never been enriched (or all, with force). */
export async function enrichPending(
  ctx: Ctx,
  opts: { force?: boolean; concurrency?: number } = {},
): Promise<number> {
  if (!process.env.TAVILY_API_KEY) return 0;
  let query = ctx.db.from("contacts").select("id").eq("owner_id", ctx.ownerId).order("id");
  if (!opts.force) query = query.is("enriched_at", null);
  const ids = must<{ id: string }[]>(await query).map((c) => c.id);
  const size = opts.concurrency ?? 5;
  for (let i = 0; i < ids.length; i += size) {
    await Promise.all(
      ids.slice(i, i + size).map((id) =>
        enrichAndSave(ctx, id).catch((e) => console.error(`Enrichment failed for ${id}:`, e)),
      ),
    );
  }
  return ids.length;
}

/** One line for prompts. Clearly labeled as unverified public info. */
export function enrichmentLine(e: Enrichment | null): string | null {
  if (!e || e.status !== "matched") return null;
  const parts = [e.summary, ...e.recent_signals.map((s) => `${s.date ?? "recent"}: ${s.text}`)];
  if (e.possible_offers.length) parts.push(`can offer: ${e.possible_offers.map((o) => o.text).join("; ")}`);
  return `public web (unverified, ${e.identity_confidence} identity confidence): ${parts.join(" | ")}`;
}
