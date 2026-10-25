import { db, must } from "./supabase";
import { ineligibleReason, scoreOpportunity, type ScoreBreakdown } from "./scoring";
import type { Contact, Opportunity, Signal } from "./types";

// Stage E/F (PRD §8): assemble the morning briefing from stored assessments.

export const MAX_RECOMMENDATIONS = 5;

export type Candidate = {
  opp: Opportunity;
  recipient: Contact;
  proposed: Contact;
  need: Signal & { note_date: string };
  offer: (Signal & { note_date: string }) | null;
  score: ScoreBreakdown;
  excludedReason: string | null;
  /** Needs of the proposed contact that the recipient addresses (same intro, other direction). */
  reciprocal: Candidate[];
};

export type Briefing = {
  evalDate: string;
  recommendations: Candidate[];
  /** Eligible but not shown (lower-ranked or redundant with a shown recipient/need). */
  alsoConsidered: Candidate[];
  filteredOut: Candidate[];
};

/** YYYY-MM-DD; DEMO_EVAL_DATE pins the date so demos and scores are reproducible. */
export function defaultEvalDate(): string {
  return process.env.DEMO_EVAL_DATE ?? new Date().toISOString().slice(0, 10);
}

type SignalWithDate = Signal & { interactions: { date: string } };

export async function buildBriefing(evalDate: string): Promise<Briefing> {
  const supabase = db();
  const [opps, contacts, signals] = await Promise.all([
    supabase.from("opportunities").select("*").then((r) => must<Opportunity[]>(r)),
    supabase.from("contacts").select("*").then((r) => must<Contact[]>(r)),
    supabase.from("signals").select("*, interactions(date)").then((r) => must<SignalWithDate[]>(r)),
  ]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const signalById = new Map(signals.map((s) => [s.id, { ...s, note_date: s.interactions.date }]));

  const candidates: Candidate[] = opps.flatMap((opp) => {
    const recipient = contactById.get(opp.recipient_contact_id);
    const proposed = contactById.get(opp.proposed_contact_id);
    const need = signalById.get(opp.matched_need_id);
    if (!recipient || !proposed || !need) return [];
    const offer = opp.matched_offer_id ? (signalById.get(opp.matched_offer_id) ?? null) : null;
    return [
      {
        opp,
        recipient,
        proposed,
        need,
        offer,
        score: scoreOpportunity({ opp, recipient, proposed, need, needDate: need.note_date, evalDate }),
        excludedReason: ineligibleReason(opp, need, need.note_date, evalDate, proposed),
        reciprocal: [],
      },
    ];
  });

  // Highest score first; id breaks ties so ordering is reproducible.
  const byScore = (a: Candidate, b: Candidate) => b.score.total - a.score.total || a.opp.id.localeCompare(b.opp.id);
  const eligible = candidates.filter((c) => !c.excludedReason).sort(byScore);

  // Avoid redundant recommendations: at most one per recipient, and one per pair of
  // people (A<-B and B<-A are the same introduction; the reverse is shown as two-way value).
  const pairKey = (c: Candidate) => [c.recipient.id, c.proposed.id].sort().join("|");
  const recommendations: Candidate[] = [];
  const seenRecipients = new Set<string>();
  const seenPairs = new Map<string, Candidate>();
  for (const c of eligible) {
    if (recommendations.length >= MAX_RECOMMENDATIONS) break;
    if (seenRecipients.has(c.recipient.id) || seenPairs.has(pairKey(c))) continue;
    recommendations.push(c);
    seenRecipients.add(c.recipient.id);
    seenPairs.set(pairKey(c), c);
  }
  const alsoConsidered: Candidate[] = [];
  for (const c of eligible) {
    if (recommendations.includes(c)) continue;
    const shown = seenPairs.get(pairKey(c));
    if (shown && shown.recipient.id !== c.recipient.id) shown.reciprocal.push(c);
    else alsoConsidered.push(c);
  }

  return {
    evalDate,
    recommendations,
    alsoConsidered,
    filteredOut: candidates.filter((c) => c.excludedReason).sort(byScore),
  };
}
