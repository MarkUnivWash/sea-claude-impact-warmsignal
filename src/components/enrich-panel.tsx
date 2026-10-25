"use client";

import { Check, CircleAlert, Globe, LoaderCircle, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EnrichEvent } from "@/lib/enrich";
import { btn, Chip } from "./ui";

type Frame = EnrichEvent | { type: "saved" } | { type: "error"; message: string };
type Source = { title: string; url: string; date: string | null };
type Partial = {
  identity_confidence?: string;
  identity_notes?: string;
  summary?: string;
  recent_signals?: { kind?: string; text?: string }[];
  possible_offers?: { text?: string }[];
};
type Run = {
  phase: "searching" | "reading" | "verifying" | "done" | "error";
  queries: { group: string; query: string }[];
  sources: Record<string, Source[]>;
  readCount: number;
  partial: Partial;
  outcome: "matched" | "no_confident_match" | null;
  error: string | null;
  started: number;
};

const fresh = (): Run => ({
  phase: "searching",
  queries: [],
  sources: {},
  readCount: 0,
  partial: {},
  outcome: null,
  error: null,
  started: Date.now(),
});

/**
 * Web profile panel. Idle: shows the saved profile (children, server-rendered).
 * Running: streams the enrichment live from /api/contacts/[id]/enrich (SSE over fetch).
 */
export function EnrichPanel({
  contactId,
  name,
  company,
  enriched,
  children,
}: {
  contactId: string;
  name: string;
  company: string | null;
  enriched: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRun(fresh());
    const update = (fn: (r: Run) => Run) => setRun((r) => (r ? fn(r) : r));
    const fail = (message: string) => update((r) => ({ ...r, phase: "error", error: message }));

    try {
      const res = await fetch(`/api/contacts/${contactId}/enrich`, { method: "POST", signal: abort.signal });
      if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
        const body = await res.json().catch(() => null);
        return fail(body?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
            .join("\n");
          if (data) handle(JSON.parse(data) as Frame);
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) fail(e instanceof Error ? e.message : "Connection lost");
    }

    function handle(f: Frame) {
      switch (f.type) {
        case "searching":
          return update((r) => ({ ...r, queries: f.queries }));
        case "sources":
          return update((r) => ({ ...r, sources: { ...r.sources, [f.group]: f.sources } }));
        case "reading":
          return update((r) => ({ ...r, phase: "reading", readCount: f.count }));
        case "partial":
          return update((r) => ({ ...r, partial: (f.data ?? {}) as Partial }));
        case "verifying":
          return update((r) => ({ ...r, phase: "verifying" }));
        case "result":
          return update((r) => ({ ...r, outcome: f.enrichment.status }));
        case "saved":
          update((r) => ({ ...r, phase: "done" }));
          // Let the finished state register, then swap in the saved, server-rendered profile.
          setTimeout(() => {
            router.refresh();
            setRun(null);
          }, 1800);
          return;
        case "error":
          return fail(f.message);
      }
    }
  }

  const running = run != null && run.phase !== "done" && run.phase !== "error";

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 text-sm shadow-card lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-bold tracking-tight">
            <Globe className="size-4 text-ink-500" /> Public web profile
          </h2>
          <p className="text-xs text-slate-400">via Tavily + Claude · unverified</p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={running}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${btn.secondary}`}
        >
          <RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Enriching…" : enriched ? "Refresh" : "Enrich now"}
        </button>
      </div>
      {run ? <LiveRun key={run.started} run={run} name={name} company={company} onRetry={start} /> : children}
    </section>
  );
}

function LiveRun({ run, name, company, onRetry }: { run: Run; name: string; company: string | null; onRetry: () => void }) {
  const elapsed = useElapsed(run.started, run.phase === "done" || run.phase === "error");
  const order = ["searching", "reading", "verifying", "done"] as const;
  const at = run.phase === "error" ? -1 : order.indexOf(run.phase);
  const state = (i: number) => (at > i || run.phase === "done" ? "done" : at === i ? "active" : "waiting");
  const totalSources = Object.values(run.sources).reduce((n, s) => n + s.length, 0);
  const p = run.partial;
  const signals = (p.recent_signals ?? []).filter((s) => s.text);
  const offers = (p.possible_offers ?? []).filter((o) => o.text);
  const weak = p.identity_confidence === "low" || p.identity_confidence === "none";

  return (
    <div className="mt-4 space-y-1" aria-live="polite">
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="font-medium text-ink-700">{run.phase === "done" ? "Finished" : run.phase === "error" ? "Stopped" : "Live"}</span>
        <span className="font-mono text-slate-400">{elapsed}s</span>
      </div>

      <Step state={state(0)} icon={Search} title={totalSources ? `Found ${totalSources} web results` : "Searching the web"}>
        <ul className="space-y-1">
          {run.queries.map((q) => (
            <li key={q.group} className="truncate font-mono text-[11px] text-slate-400">
              {q.query}
            </li>
          ))}
        </ul>
        {(["person", "company"] as const).map(
          (g) =>
            run.sources[g] && (
              <div key={g} className="mt-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {g === "person" ? `About ${name.split(" ")[0]}` : `${company ?? "Company"} news`}
                </div>
                <ul className="space-y-1">
                  {run.sources[g].length === 0 && <li className="text-xs text-slate-400">No results</li>}
                  {run.sources[g].map((s, i) => (
                    <li
                      key={s.url}
                      className="flex animate-rise items-center gap-2 text-xs"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                        {hostname(s.url)}
                      </span>
                      <span className="truncate text-slate-600">{s.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
      </Step>

      <Step
        state={state(1)}
        icon={Sparkles}
        title={run.readCount ? `Claude is reading ${run.readCount} sources` : "Claude reads the sources"}
      >
        {p.identity_confidence && (
          <div className="flex animate-rise items-start gap-1.5 text-xs">
            <Chip tone={weak ? "amber" : "emerald"}>
              {weak ? <CircleAlert className="size-3" /> : <ShieldCheck className="size-3" />}
              {p.identity_confidence} confidence
            </Chip>
          </div>
        )}
        {p.identity_notes && <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{p.identity_notes}</p>}
        {p.summary && (
          <p className="mt-2 leading-relaxed text-slate-700">
            {p.summary}
            {run.phase === "reading" && !signals.length && <Caret />}
          </p>
        )}
        {signals.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {signals.map((s, i) => (
              <li key={i} className="flex animate-rise items-start gap-2 text-xs text-slate-700">
                {s.kind && <Chip tone="sky">{s.kind.replace("_", " ")}</Chip>}
                <span className="pt-0.5">{s.text}</span>
              </li>
            ))}
          </ul>
        )}
        {offers.length > 0 && (
          <p className="mt-2 animate-rise text-xs text-slate-600">
            <span className="font-medium">Could offer:</span> {offers.map((o) => o.text).join("; ")}
          </p>
        )}
      </Step>

      <Step state={state(2)} icon={ShieldCheck} title="Checking every claim has a source" />

      <Step
        state={state(3)}
        icon={Check}
        title={
          run.phase !== "done"
            ? "Save to profile"
            : run.outcome === "matched"
              ? "Saved to profile"
              : "No confident match, so nothing attached"
        }
        last
      />

      {run.phase === "error" && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700">
          <div className="flex items-start gap-1.5">
            <CircleAlert className="mt-px size-3.5 shrink-0" /> {run.error}
          </div>
          <button type="button" onClick={onRetry} className="mt-2 font-semibold underline-offset-2 hover:underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Step({
  state,
  icon: Icon,
  title,
  children,
  last = false,
}: {
  state: "waiting" | "active" | "done";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-3">
      {!last && <span className={`absolute bottom-0 left-[11px] top-7 w-px ${state === "done" ? "bg-ink-200" : "bg-slate-100"}`} />}
      <span
        className={`relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition ${
          state === "done"
            ? "bg-ink-600 text-white"
            : state === "active"
              ? "bg-ink-50 text-ink-600 ring-4 ring-ink-50"
              : "bg-slate-100 text-slate-300"
        }`}
      >
        {state === "done" ? (
          <Check className="size-3.5" />
        ) : state === "active" ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3" />
        )}
      </span>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-4"}`}>
        <div className={`pt-0.5 font-medium ${state === "waiting" ? "text-slate-400" : "text-slate-800"}`}>{title}</div>
        {children && state !== "waiting" && <div className="mt-1.5">{children}</div>}
      </div>
    </div>
  );
}

function Caret() {
  return <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-ink-500" />;
}

function useElapsed(started: number, stopped: boolean) {
  const [now, setNow] = useState(started);
  useEffect(() => {
    if (stopped) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [stopped]);
  return ((now - started) / 1000).toFixed(1);
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
