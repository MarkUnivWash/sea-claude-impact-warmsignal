import {
  draftMessageAction,
  findIntroductionsAction,
  setConsentAction,
  setEvalDateAction,
  setStatusAction,
} from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { buildBriefing, defaultEvalDate, suggestedAction, type Candidate } from "@/lib/briefing";
import { WEIGHTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function BriefingPage({ searchParams }: PageProps<"/">) {
  const { date } = await searchParams;
  const evalDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : defaultEvalDate();
  const briefing = await buildBriefing(evalDate);
  const n = briefing.recommendations.length;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-stone-500">
            {new Date(evalDate + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <h1 className="font-serif text-3xl font-semibold">
            {n === 0 ? "No opportunities to give today" : `Your ${n} ${n === 1 ? "opportunity" : "opportunities"} to give today`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <form action={setEvalDateAction} className="flex items-center gap-1">
            <input
              type="date"
              name="date"
              defaultValue={evalDate}
              className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
            />
            <SubmitButton className="border border-stone-300 bg-white hover:bg-stone-100">Go</SubmitButton>
          </form>
          <form action={findIntroductionsAction}>
            <SubmitButton
              pendingText="Claude is reviewing your network…"
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Find introductions
            </SubmitButton>
          </form>
        </div>
      </section>

      {n === 0 && (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-stone-600">
          Nothing qualifies right now. That&apos;s fine: WarmSignal never pads the list. Log new conversations on the
          Contacts page, then click <em>Find introductions</em>.
        </p>
      )}

      <ol className="space-y-6">
        {briefing.recommendations.map((c, i) => (
          <RecommendationCard key={c.opp.id} rank={i + 1} c={c} evalDate={evalDate} />
        ))}
      </ol>

      {briefing.alsoConsidered.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Also eligible ({briefing.alsoConsidered.length}): lower-ranked or a second option for someone above
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {briefing.alsoConsidered.map((c) => (
              <li key={c.opp.id} className="flex justify-between gap-4">
                <span>
                  {c.recipient.name} ← {c.proposed.name}: {c.need.description}
                </span>
                <span className="font-mono text-stone-500">{c.score.total}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {briefing.filteredOut.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Filtered out ({briefing.filteredOut.length}): why these weren&apos;t recommended
          </summary>
          <ul className="mt-3 space-y-3 text-sm">
            {briefing.filteredOut.map((c) => (
              <li key={c.opp.id}>
                <div>
                  {c.recipient.name} ← {c.proposed.name}: {c.need.description}
                </div>
                <div className="text-stone-500">{c.excludedReason}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RecommendationCard({ rank, c, evalDate }: { rank: number; c: Candidate; evalDate: string }) {
  const first = c.recipient.name.split(" ")[0];
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-serif text-xl font-semibold">
          {rank}. Reconnect with {c.recipient.name}
          <span className="ml-2 text-sm font-normal text-stone-500">
            {c.recipient.title}, {c.recipient.company}
          </span>
        </h2>
        <div className="shrink-0 rounded-full bg-amber-100 px-3 py-1 font-mono text-sm font-semibold text-amber-800">
          {Math.round(c.score.total)}/100
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="font-medium text-stone-500">Opportunity</dt>
        <dd>
          Introduce {first} to <strong>{c.proposed.name}</strong> ({c.proposed.title}, {c.proposed.company}).{" "}
          {c.opp.value_proposition}
        </dd>

        <dt className="font-medium text-stone-500">What {first} needs</dt>
        <dd>
          {c.need.description}
          {c.need.is_inferred && <Badge tone="amber">inferred, not stated</Badge>}
        </dd>

        <dt className="font-medium text-stone-500">Why {c.proposed.name.split(" ")[0]}</dt>
        <dd>
          {c.opp.why_proposed}
          {c.opp.match_basis === "profile_inference" && <Badge tone="amber">based on profile only</Badge>}
        </dd>

        {c.reciprocal.length > 0 && (
          <>
            <dt className="font-medium text-stone-500">Two-way value</dt>
            <dd>
              It helps {c.proposed.name.split(" ")[0]} too: {c.reciprocal.map((r) => r.need.description).join("; ")}.
            </dd>
          </>
        )}

        {c.opp.why_now && (
          <>
            <dt className="font-medium text-stone-500">Why now</dt>
            <dd>{c.opp.why_now}</dd>
          </>
        )}

        <dt className="font-medium text-stone-500">Relationship</dt>
        <dd>
          {first}: {c.recipient.relationship_strength}/5
          {c.score.daysSinceInteraction != null && `, last spoke ${c.score.daysSinceInteraction} days ago`} ·{" "}
          {c.proposed.name.split(" ")[0]}: {c.proposed.relationship_strength}/5
        </dd>

        {(c.opp.concerns || c.opp.missing_evidence) && (
          <>
            <dt className="font-medium text-stone-500">Watch out</dt>
            <dd className="text-stone-700">{[c.opp.concerns, c.opp.missing_evidence].filter(Boolean).join(" ")}</dd>
          </>
        )}

        <dt className="font-medium text-stone-500">Suggested action</dt>
        <dd className="font-medium">{suggestedAction(c)}</dd>
      </dl>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-stone-600">Evidence &amp; score breakdown</summary>
        <div className="mt-3 space-y-3">
          <Evidence label={`${first}, ${c.need.note_date}`} text={c.need.supporting_text} verified={c.need.quote_verified} />
          {c.offer && (
            <Evidence
              label={`${c.proposed.name.split(" ")[0]}, ${c.offer.note_date}`}
              text={c.offer.supporting_text}
              verified={c.offer.quote_verified}
            />
          )}
          <ScoreBars c={c} />
        </div>
      </details>

      {c.opp.draft_message && (
        <div className="mt-4 rounded-lg bg-stone-50 p-4 text-sm whitespace-pre-wrap">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">Draft message to {first} (edit before sending)</div>
          {c.opp.draft_message}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
        <form action={setStatusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={c.opp.id} />
          <input type="hidden" name="eval_date" value={evalDate} />
          <SubmitButton name="status" value="useful" className={c.opp.status === "useful" ? "bg-emerald-600 text-white" : "border border-emerald-600 text-emerald-700 hover:bg-emerald-50"}>
            {c.opp.status === "useful" ? "✓ Useful" : "Useful"}
          </SubmitButton>
          <SubmitButton name="status" value="deferred" className="border border-stone-300 hover:bg-stone-100">
            Defer 7 days
          </SubmitButton>
          <SubmitButton name="status" value="dismissed" className="border border-stone-300 hover:bg-stone-100">
            Dismiss
          </SubmitButton>
          <SubmitButton name="status" value="completed" className="border border-stone-300 hover:bg-stone-100">
            Already handled
          </SubmitButton>
        </form>
        <form action={draftMessageAction}>
          <input type="hidden" name="id" value={c.opp.id} />
          <input type="hidden" name="eval_date" value={evalDate} />
          <SubmitButton pendingText="Drafting…" className="border border-amber-600 text-amber-700 hover:bg-amber-50">
            {c.opp.draft_message ? "Redraft message" : "Draft message"}
          </SubmitButton>
        </form>
        <form action={setConsentAction} className="ml-auto flex items-center gap-1 text-xs text-stone-500">
          <input type="hidden" name="id" value={c.opp.id} />
          Consent:
          {(["not_requested", "pending", "approved", "declined"] as const).map((s) => (
            <SubmitButton
              key={s}
              name="consent"
              value={s}
              className={`!px-2 !py-0.5 !text-xs ${c.opp.consent_status === s ? "bg-stone-800 text-white" : "hover:bg-stone-100"}`}
            >
              {s.replace("_", " ")}
            </SubmitButton>
          ))}
        </form>
      </div>
    </li>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "amber" }) {
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tone === "amber" ? "bg-amber-100 text-amber-800" : ""}`}>
      {children}
    </span>
  );
}

function Evidence({ label, text, verified }: { label: string; text: string; verified: boolean }) {
  return (
    <blockquote className="border-l-2 border-amber-300 pl-3">
      <div className="text-stone-800">&ldquo;{text}&rdquo;</div>
      <div className="text-xs text-stone-500">
        {label} · {verified ? "quote found in note" : "⚠ paraphrase, not found verbatim in note"}
      </div>
    </blockquote>
  );
}

function ScoreBars({ c }: { c: Candidate }) {
  const rows = [
    ["Give value", c.score.give, WEIGHTS.give, `${c.opp.give_value}/5`],
    ["Connection cooling", c.score.cooling, WEIGHTS.cooling, c.score.daysSinceInteraction != null ? `${c.score.daysSinceInteraction}d since contact` : "unknown"],
    ["Timeliness", c.score.timeliness, WEIGHTS.timeliness, `need noted ${c.score.daysSinceNote}d ago`],
    ["Relationship strength", c.score.relationship, WEIGHTS.relationship, "avg of both"],
    ["Match confidence", c.score.confidence, WEIGHTS.confidence, c.opp.match_basis.replace("_", " ")],
  ] as const;
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(([label, value, weight, note]) => (
          <tr key={label}>
            <td className="w-40 py-0.5 text-stone-600">{label}</td>
            <td className="py-0.5">
              <div className="h-2 w-full rounded bg-stone-100">
                <div className="h-2 rounded bg-amber-500" style={{ width: `${value * 100}%` }} />
              </div>
            </td>
            <td className="w-16 py-0.5 text-right font-mono">+{(value * weight * 100).toFixed(1)}</td>
            <td className="w-44 py-0.5 pl-3 text-stone-500">{note}</td>
          </tr>
        ))}
        <tr>
          <td className="pt-1 font-medium">Priority</td>
          <td />
          <td className="pt-1 text-right font-mono font-semibold">{c.score.total}</td>
          <td className="pl-3 pt-1 text-stone-500">of 100</td>
        </tr>
      </tbody>
    </table>
  );
}
