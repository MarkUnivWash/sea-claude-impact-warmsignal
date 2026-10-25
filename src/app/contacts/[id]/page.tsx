import Link from "next/link";
import { notFound } from "next/navigation";
import { addNoteAction, enrichContactAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { defaultEvalDate } from "@/lib/briefing";
import { db, must } from "@/lib/supabase";
import type { Contact, Enrichment, Interaction, Signal } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const supabase = db();
  const { data: contact } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle<Contact>();
  if (!contact) notFound();

  const [interactions, signals] = await Promise.all([
    supabase
      .from("interactions")
      .select("*")
      .eq("contact_id", id)
      .order("date", { ascending: false })
      .then((r) => must<Interaction[]>(r)),
    supabase.from("signals").select("*").eq("contact_id", id).then((r) => must<Signal[]>(r)),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/contacts" className="text-sm text-stone-500 hover:underline">
          ← Contacts
        </Link>
        <h1 className="font-serif text-3xl font-semibold">{contact.name}</h1>
        <p className="text-stone-600">
          {[
            [contact.title, contact.company].filter(Boolean).join(", "),
            contact.industry,
            `relationship ${contact.relationship_strength}/5`,
            `last interaction ${contact.last_interaction_date ?? "unknown"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {contact.introduction_preferences && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Intro preferences: {contact.introduction_preferences}
          </p>
        )}
      </div>

      <WebProfile contact={contact} />

      <form action={addNoteAction} className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold">Log a conversation</h2>
        <input type="hidden" name="contact_id" value={contact.id} />
        <textarea
          name="notes"
          required
          rows={5}
          placeholder={`What did you learn from ${contact.name.split(" ")[0]}? Goals, challenges, what they're looking for, what they could offer others…`}
          className="w-full rounded-md border border-stone-300 p-3 text-sm"
        />
        <div className="flex items-center gap-3">
          <input
            type="date"
            name="date"
            defaultValue={defaultEvalDate()}
            className="rounded-md border border-stone-300 px-2 py-1 text-sm"
          />
          <SubmitButton pendingText="Extracting with Claude…" className="bg-amber-600 text-white hover:bg-amber-700">
            Save &amp; extract
          </SubmitButton>
        </div>
      </form>

      <section className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">Conversations</h2>
        {interactions.length === 0 && <p className="text-sm text-stone-500">No conversations logged yet.</p>}
        {interactions.map((it) => {
          const mine = signals.filter((s) => s.interaction_id === it.id);
          return (
            <article key={it.id} className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{it.date}</div>
              <p className="mt-2 whitespace-pre-wrap text-stone-800">{it.raw_notes}</p>
              {it.context?.summary && <p className="mt-3 italic text-stone-600">{it.context.summary}</p>}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <SignalList title="Needs" items={mine.filter((s) => s.type === "need")} />
                <SignalList title="Offers" items={mine.filter((s) => s.type === "offer")} />
              </div>
              {!!it.context?.uncertainties?.length && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Uncertain / sensitive</h3>
                  <ul className="mt-1 list-disc pl-5 text-stone-600">
                    {it.context.uncertainties.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function SignalList({ title, items }: { title: string; items: Signal[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      {items.length === 0 && <p className="mt-1 text-stone-400">None stated</p>}
      <ul className="mt-1 space-y-2">
        {items.map((s) => (
          <li key={s.id} className="rounded-md bg-stone-50 p-2">
            <div className="font-medium">
              {s.description}{" "}
              <span className="text-xs font-normal text-stone-500">
                [{s.category}] {Math.round(s.confidence * 100)}%
              </span>
            </div>
            <div className="text-xs text-stone-500">
              “{s.supporting_text}”{s.is_inferred && <span className="ml-1 text-amber-700">· inferred</span>}
              {!s.quote_verified && <span className="ml-1 text-amber-700">· not verbatim</span>}
              {s.time_sensitive && <span className="ml-1">· time-sensitive</span>}
              {s.relevant_until && <span className="ml-1">· until {s.relevant_until}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebProfile({ contact }: { contact: Contact }) {
  const e: Enrichment | null = contact.enrichment;
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold">
          Public web profile <span className="text-xs font-normal text-stone-500">via Tavily · unverified</span>
        </h2>
        <form action={enrichContactAction}>
          <input type="hidden" name="contact_id" value={contact.id} />
          <SubmitButton pendingText="Searching the web…" className="border border-stone-300 hover:bg-stone-100">
            {contact.enriched_at ? "Refresh" : "Enrich"}
          </SubmitButton>
        </form>
      </div>
      {!e && (
        <p className="mt-2 text-stone-500">
          Not enriched yet. New contacts are enriched in the background, so refresh in a few seconds.
        </p>
      )}
      {e?.status === "no_confident_match" && (
        <p className="mt-2 text-stone-500">No confident match found online. {e.identity_notes}</p>
      )}
      {e?.status === "matched" && (
        <div className="mt-2 space-y-3">
          <p>
            {e.summary} <span className="text-xs text-stone-500">({e.identity_confidence} confidence: {e.identity_notes})</span>
          </p>
          {e.recent_signals.length > 0 && (
            <ul className="space-y-1">
              {e.recent_signals.map((x) => (
                <li key={x.source_url + x.text}>
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">{x.kind.replace("_", " ")}</span>{" "}
                  {x.text} {x.date && <span className="text-stone-500">({x.date})</span>}{" "}
                  <a href={x.source_url} target="_blank" rel="noreferrer" className="text-xs text-amber-700 hover:underline">
                    source
                  </a>
                </li>
              ))}
            </ul>
          )}
          {e.possible_offers.length > 0 && (
            <p className="text-stone-600">
              <span className="font-medium">Could offer:</span> {e.possible_offers.map((o) => o.text).join("; ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
