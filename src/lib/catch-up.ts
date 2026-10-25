import { assessOutreach } from "./classify";
import { FAST_MODEL, textCall } from "./claude";
import { buildBriefing, type Briefing } from "./briefing";
import { enrichmentLine } from "./enrich";
import { coolingScore, daysBetween, MIN_PROPOSED_STRENGTH, STALE_AFTER_DAYS } from "./scoring";
import { must, type Ctx } from "./supabase";
import type { Contact, Interaction, OutreachAssessment, Signal } from "./types";

// Catch-up deck: people Alonso should meet with to keep the relationship warm, one card at a time.
// Claude (classify.ts) judges each due contact: how worthwhile reaching out is now, the hook,
// timeliness, and evidence strength. The deck score is computed from that here, deterministically,
// so the same assessments and evaluation date always give the same order.

export const DECK_SIZE = 10;
export const SNOOZE_DAYS = 14;
/** Don't re-suggest someone he just messaged; give them time to reply and meet. */
export const RECENT_OUTREACH_DAYS = 21;
/** Below this, it's too soon since the last conversation to suggest another. */
export const MIN_DAYS_SINCE_MET = 30;
/** Only the top candidates by the provisional score are sent to Claude on each deck build. */
export const CLASSIFY_LIMIT = 20;
/** A job change this recent is a reason to reach out. */
const JOB_CHANGE_DAYS = 90;
/** A meeting that went badly this recently halves the score. Cooling already handles recency. */
const NEGATIVE_FOLLOWUP_DAYS = 90;
const NEGATIVE_FOLLOWUP_FACTOR = 0.5;

/** Priority = 100 × (0.35·cooling + 0.30·value + 0.15·timeliness + 0.10·relationship + 0.10·confidence) × follow-up factor. */
export const DECK_WEIGHTS = { cooling: 0.35, value: 0.3, timeliness: 0.15, relationship: 0.1, confidence: 0.1 } as const;

export type ReasonKind = "give" | "need" | "job_change" | "news" | "last_time";
export type Reason = { kind: ReasonKind; text: string };

/** What a deck card renders. Shaped for the client, not raw rows. */
export type CatchUpCard = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  relationshipStrength: number;
  daysSinceMet: number | null;
  reasons: Reason[];
  /** Claude's one-line reason to reach out now, if assessed. */
  whyNow: string | null;
  score: number;
};

type Needs = (Signal & { interactions: { date: string } })[];
type InteractionRow = Pick<Interaction, "contact_id" | "date" | "context" | "kind" | "outcome">;

async function loadInputs(ctx: Ctx, evalDate: string, briefing?: Briefing) {
  const { db, ownerId } = ctx;
  const [contacts, needs, interactions, b] = await Promise.all([
    db.from("contacts").select("*").eq("owner_id", ownerId).then((r) => must<Contact[]>(r)),
    db
      .from("signals")
      .select("*, interactions(date)")
      .eq("owner_id", ownerId)
      .eq("type", "need")
      .eq("status", "active")
      .then((r) => must<Needs>(r)),
    db
      .from("interactions")
      .select("contact_id, date, context, kind, outcome")
      .eq("owner_id", ownerId)
      .order("date", { ascending: false })
      .then((r) => must<InteractionRow[]>(r)),
    briefing ?? buildBriefing(ctx, evalDate),
  ]);
  return { contacts, needs, interactions, briefing: b };
}

type Inputs = Awaited<ReturnType<typeof loadInputs>>;

function reasonsFor(c: Contact, { needs, interactions, briefing }: Omit<Inputs, "contacts">, evalDate: string): Reason[] {
  const reasons: Reason[] = [];
  const first = (name: string) => name.split(" ")[0];

  // An introduction he could offer them is the best reason to get in touch.
  const intro = [...briefing.recommendations, ...briefing.alsoConsidered].find((x) => x.recipient.id === c.id);
  if (intro) {
    reasons.push({ kind: "give", text: `You could introduce them to ${intro.proposed.name} (${intro.need.description})` });
  } else {
    const need = needs
      .filter(
        (s) =>
          s.contact_id === c.id &&
          (!s.relevant_until || s.relevant_until >= evalDate) &&
          daysBetween(s.interactions.date, evalDate) <= STALE_AFTER_DAYS,
      )
      .sort((a, b) => Number(b.time_sensitive) - Number(a.time_sensitive) || b.interactions.date.localeCompare(a.interactions.date))[0];
    if (need) reasons.push({ kind: "need", text: `${first(c.name)} mentioned: ${need.description}` });
  }

  const change = latestJobChange(c, evalDate);
  if (change) {
    reasons.push({ kind: "job_change", text: `New role: ${[change.title, change.company].filter(Boolean).join(" at ")}` });
  }

  if (c.enrichment?.status === "matched" && c.enrichment.recent_signals[0]) {
    reasons.push({ kind: "news", text: c.enrichment.recent_signals[0].text });
  }

  const last = interactions.find((i) => i.contact_id === c.id && i.context?.summary);
  if (last?.context?.summary) reasons.push({ kind: "last_time", text: last.context.summary });

  return reasons;
}

function latestJobChange(c: Contact, evalDate: string) {
  const last = c.profile_history?.at(-1);
  return last && daysBetween(last.seen_at.slice(0, 10), evalDate) <= JOB_CHANGE_DAYS ? last : null;
}

function lastFollowUp(c: Contact, interactions: InteractionRow[]) {
  return interactions.find((i) => i.contact_id === c.id && i.kind === "meeting_followup") ?? null;
}

/**
 * Everything the classifier sees about one contact, from the data contract. Dates, not day counts,
 * so the text (and its hash) only changes when the facts do. Never includes email or phone.
 */
function factsFor(c: Contact, reasons: Reason[], followUp: InteractionRow | null): string {
  const label: Record<ReasonKind, string> = {
    give: "Alonso can offer",
    need: "They mentioned needing",
    job_change: "Profile change",
    news: "Public web (unverified)",
    last_time: "Last conversation",
  };
  const web = enrichmentLine(c.enrichment);
  return [
    `Contact: ${c.name}, ${c.title ?? "?"} at ${c.company ?? "?"} (${c.industry ?? "?"})${c.location ? `, ${c.location}` : ""}`,
    `Relationship strength: ${c.relationship_strength}/5`,
    `Last conversation: ${c.last_interaction_date ?? "none logged"}`,
    `Alonso's last outreach: ${c.last_outreach_at ?? "none"}`,
    `Introduction preferences / sensitivities: ${c.introduction_preferences ?? "none recorded"}`,
    ...reasons.map((r) => `${label[r.kind]}: ${r.text}`),
    followUp
      ? `Last meeting follow-up (${followUp.date}): ${followUp.outcome ?? "no outcome"}${followUp.context?.summary ? `, ${followUp.context.summary}` : ""}`
      : null,
    web,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Without an assessment (not yet classified, or Claude unavailable), score from the reason kinds alone. */
function provisional(reasons: Reason[]): Pick<OutreachAssessment, "outreach_value" | "timeliness" | "confidence"> {
  const has = (k: ReasonKind) => reasons.some((r) => r.kind === k);
  const value = has("give") ? 5 : has("need") || has("job_change") ? 3.5 : has("news") ? 2 : 0;
  return { outreach_value: value, timeliness: 2.5, confidence: 0.5 };
}

function toCard(c: Contact, reasons: Reason[], evalDate: string, followUp: InteractionRow | null): CatchUpCard {
  const daysSinceMet = c.last_interaction_date ? daysBetween(c.last_interaction_date, evalDate) : null;
  const a = c.outreach_assessment ?? provisional(reasons);
  const recentBadMeeting =
    followUp?.outcome === "negative" && daysBetween(followUp.date, evalDate) <= NEGATIVE_FOLLOWUP_DAYS;
  const score =
    100 *
    (DECK_WEIGHTS.cooling * coolingScore(daysSinceMet) +
      DECK_WEIGHTS.value * (a.outreach_value / 5) +
      DECK_WEIGHTS.timeliness * (a.timeliness / 5) +
      DECK_WEIGHTS.relationship * (c.relationship_strength / 5) +
      DECK_WEIGHTS.confidence * a.confidence) *
    (recentBadMeeting ? NEGATIVE_FOLLOWUP_FACTOR : 1);
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    company: c.company,
    relationshipStrength: c.relationship_strength,
    daysSinceMet,
    reasons,
    whyNow: c.outreach_assessment?.why_now || null,
    score: Math.round(score * 10) / 10,
  };
}

function isDue(c: Contact, evalDate: string): boolean {
  if (c.relationship_strength < MIN_PROPOSED_STRENGTH) return false;
  if (c.outreach_snoozed_until && c.outreach_snoozed_until > evalDate) return false;
  if (c.last_outreach_at && daysBetween(c.last_outreach_at, evalDate) < RECENT_OUTREACH_DAYS) return false;
  if (c.last_interaction_date && daysBetween(c.last_interaction_date, evalDate) < MIN_DAYS_SINCE_MET) return false;
  // Claude flagged that reaching out now would be inappropriate (preference, sensitivity, bad meeting).
  if (c.outreach_assessment?.appropriate === false) return false;
  return true;
}

/**
 * Today's catch-up deck, highest priority first. Pass the briefing if it's already built.
 * With `classify` (default), the top CLASSIFY_LIMIT candidates are (re-)assessed by Claude when their
 * facts changed; otherwise stored assessments are used as-is (e.g. for the home-page nudge).
 */
export async function buildCatchUpDeck(
  ctx: Ctx,
  evalDate: string,
  briefing?: Briefing,
  opts: { classify?: boolean } = {},
): Promise<CatchUpCard[]> {
  const inputs = await loadInputs(ctx, evalDate, briefing);
  const rank = (cs: Contact[]) =>
    cs
      .filter((c) => isDue(c, evalDate))
      .map((c) => ({ c, reasons: reasonsFor(c, inputs, evalDate), followUp: lastFollowUp(c, inputs.interactions) }))
      .map((x) => ({ ...x, card: toCard(x.c, x.reasons, evalDate, x.followUp) }))
      .sort((a, b) => b.card.score - a.card.score || a.c.id.localeCompare(b.c.id));

  let ranked = rank(inputs.contacts);
  if (opts.classify !== false && ranked.length) {
    const top = ranked.slice(0, CLASSIFY_LIMIT);
    const assessed = new Map<string, OutreachAssessment>();
    for (let i = 0; i < top.length; i += 5) {
      await Promise.all(
        top.slice(i, i + 5).map(async ({ c, reasons, followUp }) => {
          try {
            assessed.set(c.id, await assessOutreach(ctx, c, factsFor(c, reasons, followUp), evalDate));
          } catch (e) {
            console.error(`Catch-up classification failed for ${c.id}:`, e); // falls back to the provisional score
          }
        }),
      );
    }
    ranked = rank(inputs.contacts.map((c) => (assessed.has(c.id) ? { ...c, outreach_assessment: assessed.get(c.id)! } : c)));
  }
  return ranked.slice(0, DECK_SIZE).map((x) => x.card);
}

// ---------- Drafts ----------

const SYSTEM = `You draft short messages for Alonso, a fractional CMO, suggesting he and someone in his network meet up (coffee, lunch, or a call). Write in his voice: warm, brief, plain, specific. No sales tone, buzzwords, emojis, or subject line. Use only the facts provided: never invent shared history, personality traits, or details. If he can offer an introduction, mention it as something he'd like to talk through, without naming the other person. Never reveal private context or sensitivities. Output only the message text.`;

function prompt(card: CatchUpCard, c: Contact): string {
  const when = card.daysSinceMet == null ? "unknown" : `${card.daysSinceMet} days ago`;
  const label: Record<ReasonKind, string> = {
    give: "Something Alonso can offer",
    need: "Something they mentioned needing",
    job_change: "A recent change in their role",
    news: "Recent public news about them (unverified; mention only if natural)",
    last_time: "Notes from their last conversation",
  };
  return `Contact: ${c.name}, ${c.title ?? ""} at ${c.company ?? ""}
Relationship strength: ${c.relationship_strength}/5
Last spoke: ${when}
${card.reasons.map((r) => `${label[r.kind]}: ${r.text}`).join("\n")}
${card.whyNow ? `Best reason to reach out now: ${card.whyNow}` : ""}
Sensitivities to respect: ${c.introduction_preferences ?? "none recorded"}

Write a 40-80 word message to ${c.name.split(" ")[0]} suggesting they catch up in person or on a call soon. Give one specific, genuine reason drawn from the facts above, and propose a concrete next step (e.g. "free for coffee in the next couple of weeks?").`;
}

/** Returns the cached catch-up draft for a contact, generating and saving it if missing. */
export async function getOrCreateCatchUpDraft(ctx: Ctx, contactId: string, evalDate: string, fresh = false): Promise<string> {
  const { db, ownerId } = ctx;
  const contact = must<Contact>(await db.from("contacts").select("*").eq("owner_id", ownerId).eq("id", contactId).single());
  if (contact.outreach_draft && !fresh) return contact.outreach_draft;

  const inputs = await loadInputs(ctx, evalDate);
  const card = toCard(contact, reasonsFor(contact, inputs, evalDate), evalDate, lastFollowUp(contact, inputs.interactions));
  const outreach_draft = await textCall({ system: SYSTEM, user: prompt(card, contact), model: FAST_MODEL });
  must(await db.from("contacts").update({ outreach_draft }).eq("owner_id", ownerId).eq("id", contactId));
  return outreach_draft;
}

// ---------- Decisions ----------

export type CatchUpDecision = "sent" | "snooze";

export async function recordDecision(ctx: Ctx, contactId: string, decision: CatchUpDecision, evalDate: string) {
  const patch =
    decision === "sent"
      ? { last_outreach_at: evalDate, outreach_snoozed_until: null, outreach_draft: null }
      : { outreach_snoozed_until: new Date(Date.parse(evalDate) + SNOOZE_DAYS * 86_400_000).toISOString().slice(0, 10) };
  must(await ctx.db.from("contacts").update(patch).eq("owner_id", ctx.ownerId).eq("id", contactId));
}
