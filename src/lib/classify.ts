import { createHash } from "node:crypto";
import { z } from "zod";
import { FAST_MODEL, structuredCall } from "./claude";
import { daysBetween } from "./scoring";
import { must, type Ctx } from "./supabase";
import type { Contact, OutreachAssessment } from "./types";

// Catch-up classifier: Claude (Haiku by default) judges whether reaching out to one contact is
// worthwhile now, and why. Like intro matching, only the assessment is stored; the deck score is
// computed from it deterministically in catch-up.ts. It never sees email or phone.

export const CLASSIFIER_MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL ?? FAST_MODEL;
/** Re-assess when the inputs change, or at least this often (timeliness drifts with the calendar). */
export const REASSESS_AFTER_DAYS = 7;

const AssessmentSchema = z.object({
  outreach_value: z.number().int().describe("0-5 rubric score"),
  hook: z.enum(["give", "need", "news", "job_change", "follow_up", "reconnect", "none"]),
  why_now: z.string().describe("Max 15 words, addressed to Alonso. Empty string if there is no current reason"),
  timeliness: z.number().int().describe("0-5: is there a reason to reach out now rather than next month?"),
  confidence: z.number().describe("0-1: how solid the evidence is"),
  appropriate: z.boolean().describe("false if reaching out now would ignore a preference, sensitivity, or a bad last meeting"),
  concern: z.string().nullable().describe("Max 12 words; null if none"),
});

const SYSTEM = `You help Alonso, a fractional CMO, decide who in his network is worth reaching out to this week to catch up (coffee, lunch, or a call). You assess one contact at a time from the facts given.

outreach_value rubric (0-5), for both of them:
0 nothing beyond time passing; 1 a generic check-in; 2 a light hook (public news, an old topic worth revisiting); 3 a concrete reason grounded in what they said or something Alonso can offer; 4 a strong, current reason (they asked for help Alonso can give, a job change, a promised follow-up); 5 specific, time-sensitive and high-impact (e.g. an intro they asked for, with a deadline).

hook: the single strongest reason. give = Alonso can offer an introduction or help; need = they mentioned needing something; news = recent public news; job_change = new role or company; follow_up = a next step from their last meeting; reconnect = mainly that the connection is cooling; none.

timeliness (0-5): deadlines, recent changes, or active processes make now better than next month.
confidence (0-1): Alonso's own notes are strong evidence; public-web lines are unverified; inferences from a job title are weak.
appropriate: false if reaching out now would ignore a stated preference or sensitivity, or if the last meeting went badly and nothing has changed since. Explain in concern.

Never invent facts. Public-web lines can support a news hook but never count as something the person said.`;

const hash = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);

/**
 * Returns the contact's catch-up assessment, re-running Claude only when `facts` changed or the
 * stored one is older than REASSESS_AFTER_DAYS. `facts` must not include day counts relative to
 * today (use dates), or every day would look like a change.
 */
export async function assessOutreach(ctx: Ctx, contact: Contact, facts: string, evalDate: string): Promise<OutreachAssessment> {
  const input_hash = hash(CLASSIFIER_MODEL, SYSTEM, facts);
  const prev = contact.outreach_assessment;
  if (
    prev?.input_hash === input_hash &&
    contact.outreach_assessed_at &&
    daysBetween(contact.outreach_assessed_at.slice(0, 10), evalDate) < REASSESS_AFTER_DAYS
  ) {
    return prev;
  }

  const out = await structuredCall({
    system: SYSTEM,
    user: `Today: ${evalDate}\n\n${facts}`,
    schema: AssessmentSchema,
    effort: "low",
    model: CLASSIFIER_MODEL,
  });
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const assessment: OutreachAssessment = {
    ...out,
    outreach_value: clamp(Math.round(out.outreach_value), 5),
    timeliness: clamp(Math.round(out.timeliness), 5),
    confidence: clamp(out.confidence, 1),
    model: CLASSIFIER_MODEL,
    input_hash,
  };
  must(
    await ctx.db
      .from("contacts")
      .update({ outreach_assessment: assessment, outreach_assessed_at: new Date().toISOString() })
      .eq("owner_id", ctx.ownerId)
      .eq("id", contact.id),
  );
  return assessment;
}
