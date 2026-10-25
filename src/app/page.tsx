import { Suspense } from "react";
import { advanceAction, findIntroductionsAction, redraftAction, setEvalDateAction, setStatusAction } from "@/app/actions";
import { DraftBox } from "@/components/draft-box";
import { SubmitButton } from "@/components/submit-button";
import { buildBriefing, defaultEvalDate, type Candidate } from "@/lib/briefing";
import { draftKindFor, getOrCreateDraft } from "@/lib/draft";
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
            <input type="hidden" name="eval_date" value={evalDate} />
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

      <ol className="space-y-5">
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

const first = (name: string) => name.split(" ")[0];

function RecommendationCard({ rank, c, evalDate }: { rank: number; c: Candidate; evalDate: string }) {
  const r = first(c.recipient.name);
  const p = first(c.proposed.name);
  const kind = draftKindFor(c);
  const step = {
    ask_recipient: { n: 1, label: `Ask ${r} if they want the intro`, yes: "recipient_yes", yesLabel: `${r} said yes →` },
    ask_proposed: { n: 2, label: `Check ${p} is open to it`, yes: "proposed_yes", yesLabel: `${p} said yes →` },
    intro: { n: 3, label: `Introduce ${r} and ${p}`, yes: "intro_sent", yesLabel: "Intro sent ✓" },
  }[kind];

  return (
    <li className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold leading-snug">
            {rank}. Introduce {c.recipient.name} → {c.proposed.name}
          </h2>
          <p className="text-xs text-stone-500">
            {c.recipient.title}, {c.recipient.company} · {c.proposed.title}, {c.proposed.company}
          </p>
        </div>
        <div className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 font-mono text-sm font-semibold text-amber-800">
          {Math.round(c.score.total)}
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        <li>
          <span className="font-medium">{r} needs:</span> {c.need.description}
          {c.need.is_inferred && <Badge>inferred</Badge>}
        </li>
        <li>
          <span className="font-medium">Why {p}:</span> {c.opp.why_proposed}
          {c.opp.match_basis === "profile_inference" && <Badge>profile only</Badge>}
        </li>
        {c.reciprocal.length > 0 && (
          <li>
            <span className="font-medium">Two-way:</span> helps {p} too ({c.reciprocal[0].need.description})
          </li>
        )}
        {c.opp.why_now && (
          <li>
            <span className="font-medium">Why now:</span> {c.opp.why_now}
          </li>
        )}
        {c.opp.concerns && (
          <li className="text-amber-800">
            <span className="font-medium">⚠</span> {c.opp.concerns}
          </li>
        )}
      </ul>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-stone-900 px-2 py-0.5 text-xs font-medium text-white">Step {step.n}/3</span>
          <span className="font-medium">{step.label}</span>
        </div>
        <Suspense
          fallback={<div className="h-28 animate-pulse rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Drafting message…</div>}
        >
          <Draft c={c} label={kind === "intro" ? `To ${r} & ${p}` : `To ${kind === "ask_recipient" ? r : p}`} />
        </Suspense>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={advanceAction} className="flex gap-2">
          <input type="hidden" name="id" value={c.opp.id} />
          <SubmitButton name="step" value={step.yes} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {step.yesLabel}
          </SubmitButton>
          {kind !== "intro" && (
            <SubmitButton name="step" value="declined" className="text-stone-500 hover:bg-stone-100">
              Not interested
            </SubmitButton>
          )}
        </form>
        <form action={setStatusAction} className="ml-auto flex gap-1 text-stone-500">
          <input type="hidden" name="id" value={c.opp.id} />
          <input type="hidden" name="eval_date" value={evalDate} />
          <SubmitButton name="status" value="deferred" className="!px-2 text-xs hover:bg-stone-100">
            Defer 7d
          </SubmitButton>
          <SubmitButton name="status" value="dismissed" className="!px-2 text-xs hover:bg-stone-100">
            Not relevant
          </SubmitButton>
          <SubmitButton name="status" value="completed" className="!px-2 text-xs hover:bg-stone-100">
            Already handled
          </SubmitButton>
        </form>
        <form action={redraftAction}>
          <input type="hidden" name="id" value={c.opp.id} />
          <SubmitButton className="!px-2 text-xs text-stone-500 hover:bg-stone-100">Redraft</SubmitButton>
        </form>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-stone-500">Evidence &amp; score</summary>
        <div className="mt-3 space-y-3">
          <Evidence label={`${r}, ${c.need.note_date}`} text={c.need.supporting_text} verified={c.need.quote_verified} />
          {c.offer && (
            <Evidence label={`${p}, ${c.offer.note_date}`} text={c.offer.supporting_text} verified={c.offer.quote_verified} />
          )}
          {c.opp.missing_evidence && <p className="text-xs text-stone-500">Unknown: {c.opp.missing_evidence}</p>}
          <ScoreBars c={c} />
        </div>
      </details>
    </li>
  );
}

async function Draft({ c, label }: { c: Candidate; label: string }) {
  const result = await getOrCreateDraft(c).then(
    (draft) => ({ draft, error: null }),
    (e: Error) => ({ draft: null, error: e.message }),
  );
  if (result.draft == null) {
    return <p className="text-sm text-red-700">Couldn&apos;t draft a message: {result.error}</p>;
  }
  return <DraftBox key={result.draft} draft={result.draft} label={label} />;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{children}</span>;
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
