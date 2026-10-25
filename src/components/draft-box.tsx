"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";

/** Editable draft with a copy button. Edits stay local; Alonso sends from his own inbox. */
export function DraftBox({ draft, label }: { draft: string; label: string }) {
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-ink-200 focus-within:ring-4 focus-within:ring-ink-50">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs font-medium text-slate-600">
        <span className="flex items-center gap-1.5">
          <Mail className="size-3.5 text-slate-400" /> {label}
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
            copied ? "bg-emerald-50 text-emerald-700" : "text-ink-700 hover:bg-ink-50"
          }`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(14, Math.max(5, text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0)))}
        className="block w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-700 outline-none"
      />
    </div>
  );
}
