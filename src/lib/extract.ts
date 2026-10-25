import { z } from "zod";
import { structuredCall } from "./claude";
import { must, type Ctx } from "./supabase";
import type { Contact } from "./types";

// Stage A (PRD §8): raw conversation note -> structured needs/offers with evidence.

export const CATEGORIES = [
  "fundraising",
  "investing",
  "hiring",
  "job_search",
  "customers",
  "vendors",
  "advisors",
  "partnerships",
  "expertise",
  "marketing",
  "services",
  "other",
] as const;

const SignalSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().describe("Max 10 words, specific, e.g. 'Digital health seed investors'"),
  supporting_text: z.string().describe("Exact quote copied verbatim from the note that supports this item"),
  is_inferred: z.boolean().describe("true if this is an assumption rather than something the person said or clearly did"),
  confidence: z.number().describe("0-1. Explicitly stated = 0.85-1.0. Inferred = 0.5 or below."),
  time_sensitive: z.boolean().describe("true if tied to a deadline, active process, or current window"),
  relevant_until: z.string().nullable().describe("ISO date after which this likely no longer applies, if the note implies one; else null"),
});

const ExtractionSchema = z.object({
  summary: z.string().describe("One-sentence summary of the conversation"),
  needs: z.array(SignalSchema).describe("What this contact needs or is looking for"),
  offers: z.array(SignalSchema).describe("What this contact can give: expertise, access, capital, services, introductions"),
  uncertainties: z.array(z.string()).describe("Ambiguities, missing info, sensitivities, or claims about third parties"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You extract relationship intelligence from a fractional CMO's private conversation notes. The notes are about one contact. Your output is used to suggest introductions, so a fabricated need could damage a real relationship.

Rules:
- Only extract needs and offers that belong to THIS contact. If the note says someone else (a friend, colleague) needs something, put it in uncertainties, not needs.
- Prefer stated facts. If you include an inference (e.g. "is a startup CEO, so probably wants investors"), mark is_inferred=true and confidence <= 0.5. Do not invent needs from job titles alone; it is fine to return empty lists.
- supporting_text must be copied verbatim from the note.
- Capture sensitivities (confidentiality, "no intros of type X") in uncertainties.
- Split distinct needs into separate items.`;

export async function extractNote(contact: Contact, date: string, notes: string): Promise<Extraction> {
  return structuredCall({
    system: SYSTEM,
    user: `Contact: ${contact.name}, ${contact.title ?? "?"} at ${contact.company ?? "?"} (${contact.industry ?? "industry unknown"})
Conversation date: ${date}

<note>
${notes}
</note>`,
    schema: ExtractionSchema,
    effort: "medium",
  });
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Saves a note, runs extraction, stores needs/offers. Returns the interaction id. */
export async function ingestNote(ctx: Ctx, contactId: string, date: string, notes: string): Promise<string> {
  const { db: supabase, ownerId } = ctx;
  const contact = must<Contact>(
    await supabase.from("contacts").select("*").eq("owner_id", ownerId).eq("id", contactId).single(),
  );

  const interaction = must<{ id: string }>(
    await supabase
      .from("interactions")
      .insert({ owner_id: ownerId, contact_id: contactId, date, raw_notes: notes })
      .select("id")
      .single(),
  );

  const extraction = await extractNote(contact, date, notes);
  const noteNorm = normalize(notes);

  const rows = (["needs", "offers"] as const).flatMap((key) =>
    extraction[key].map((s) => ({
      owner_id: ownerId,
      contact_id: contactId,
      interaction_id: interaction.id,
      type: key === "needs" ? "need" : "offer",
      category: s.category,
      description: s.description,
      supporting_text: s.supporting_text,
      quote_verified: normalize(s.supporting_text).length > 0 && noteNorm.includes(normalize(s.supporting_text)),
      is_inferred: s.is_inferred,
      time_sensitive: s.time_sensitive,
      confidence: Math.min(1, Math.max(0, s.confidence)),
      relevant_until: /^\d{4}-\d{2}-\d{2}$/.test(s.relevant_until ?? "") ? s.relevant_until : null,
    })),
  );
  if (rows.length) must(await supabase.from("signals").insert(rows));

  must(
    await supabase
      .from("interactions")
      .update({
        context: { summary: extraction.summary, uncertainties: extraction.uncertainties },
        extracted_at: new Date().toISOString(),
      })
      .eq("owner_id", ownerId)
      .eq("id", interaction.id),
  );

  // A logged conversation is a meaningful interaction, and new context makes any cached catch-up draft stale.
  const newer = !contact.last_interaction_date || date > contact.last_interaction_date;
  must(
    await supabase
      .from("contacts")
      .update({ outreach_draft: null, ...(newer && { last_interaction_date: date }) })
      .eq("owner_id", ownerId)
      .eq("id", contactId),
  );

  return interaction.id;
}
