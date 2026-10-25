import { FAST_MODEL, textCall } from "./claude";
import { buildBriefing, type Candidate } from "./briefing";
import { must, type Ctx } from "./supabase";
import type { DraftKind } from "./types";

// FR-08: drafts Alonso can edit and send himself. One per step of a double opt-in:
// 1) ask the recipient, 2) ask the proposed contact, 3) introduce them.

export function draftKindFor(c: Candidate): DraftKind {
  if (c.opp.consent_status === "approved") return "intro";
  if (c.opp.consent_status === "pending") return "ask_proposed";
  return "ask_recipient";
}

const SYSTEM = `You draft short messages for Alonso, a fractional CMO who helps people in his network by making introductions. Write in his voice: warm, brief, plain, specific. No sales tone, buzzwords, emojis, or subject line. Use only the facts provided: never invent personality traits, achievements, or details. Never reveal private context or sensitivities the other person wouldn't want shared. Output only the message text.`;

const first = (name: string) => name.split(" ")[0];

function prompt(c: Candidate, kind: DraftKind): string {
  const facts = `Recipient (has the need): ${c.recipient.name}, ${c.recipient.title ?? ""} at ${c.recipient.company ?? ""}
Their need: ${c.need.description} (they said: "${c.need.supporting_text}" on ${c.need.note_date})
Person who can help: ${c.proposed.name}, ${c.proposed.title ?? ""} at ${c.proposed.company ?? ""}
Why them: ${c.opp.why_proposed}
${c.reciprocal.length ? `It also helps ${first(c.proposed.name)}: ${c.reciprocal.map((r) => r.need.description).join("; ")}` : ""}
Sensitivities to respect: ${c.opp.concerns ?? "none recorded"}`;

  switch (kind) {
    case "ask_recipient":
      return `${facts}

Write a 50-90 word message to ${first(c.recipient.name)} asking whether they'd like an introduction to someone who fits their need. Describe the person enough to be compelling, but do not share their name or details unless the sensitivities allow it. Make clear Alonso will check with the other person first.`;
    case "ask_proposed":
      return `${facts}

${first(c.recipient.name)} has said yes. Write a 50-90 word message to ${first(c.proposed.name)} asking whether they'd be open to meeting ${first(c.recipient.name)}, explaining what's in it for ${first(c.proposed.name)}. Make it easy to say no.`;
    case "intro":
      return `${facts}

Both have agreed. Write a 70-120 word double opt-in introduction email addressed to both, saying who each is, why they should talk, and then stepping back ("I'll let you two take it from here").`;
  }
}

export async function draftOutreach(c: Candidate, kind: DraftKind = draftKindFor(c)): Promise<string> {
  return textCall({ system: SYSTEM, user: prompt(c, kind), model: FAST_MODEL });
}

/** Returns the stored draft for the card's current step, generating and saving it if missing. */
export async function getOrCreateDraft(ctx: Ctx, c: Candidate): Promise<string> {
  const kind = draftKindFor(c);
  if (c.opp.draft_message && c.opp.draft_kind === kind) return c.opp.draft_message;
  const draft_message = await draftOutreach(c, kind);
  must(
    await ctx.db
      .from("opportunities")
      .update({ draft_message, draft_kind: kind })
      .eq("owner_id", ctx.ownerId)
      .eq("id", c.opp.id),
  );
  return draft_message;
}

/** Pre-generates drafts for today's recommendations so the briefing opens instantly. */
export async function ensureDrafts(ctx: Ctx, evalDate: string): Promise<void> {
  const { recommendations } = await buildBriefing(ctx, evalDate);
  await Promise.all(recommendations.map((c) => getOrCreateDraft(ctx, c)));
}
