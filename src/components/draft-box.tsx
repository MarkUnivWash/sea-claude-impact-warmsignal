"use client";

import { useState } from "react";

/** Editable draft with a copy button. Edits stay local; Alonso sends from his own inbox. */
export function DraftBox({ draft, label }: { draft: string; label: string }) {
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50">
      <div className="flex items-center justify-between px-3 pt-2 text-xs font-medium text-amber-900">
        <span>{label}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700"
        >
          {copied ? "Copied ✓" : "Copy message"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(10, Math.max(4, Math.ceil(text.length / 85)))}
        className="w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed text-stone-800 outline-none"
      />
    </div>
  );
}
