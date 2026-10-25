import { textCall } from "./claude";
import type { Candidate } from "./briefing";

// FR-08: a short permission-first message Alonso can edit and send himself.
export async function draftOutreach(c: Candidate): Promise<string> {
  return textCall({
    system: `You draft short messages for Alonso, a fractional CMO who likes to help people in his network by making introductions. Write in his voice: warm, brief, plain, no sales tone, no buzzwords, no emojis. Never share the other person's contact details or private context, and never assume consent: the message asks whether the recipient would like the introduction. Output only the message text, 60-110 words.`,
    user: `Recipient: ${c.recipient.name} (${c.recipient.title ?? ""} at ${c.recipient.company ?? ""})
Their need: ${c.need.description} (they said: "${c.need.supporting_text}" on ${c.need.note_date})
Person Alonso could introduce: ${c.proposed.name}, ${c.proposed.title ?? ""} at ${c.proposed.company ?? ""}
Why them: ${c.opp.why_proposed}
Sensitivities to respect: ${c.opp.concerns ?? "none recorded"}`,
  });
}
