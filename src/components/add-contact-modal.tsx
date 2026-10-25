"use client";

import { useActionState, useRef } from "react";
import { createContactAction, type CreateContactState } from "@/app/actions";
import { SubmitButton } from "./submit-button";

const input = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm";

export function AddContactModal({ defaultDate }: { defaultDate: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState<CreateContactState, FormData>(createContactAction, { error: null });

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="ml-auto rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        + Add contact
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-full max-w-lg rounded-xl p-0 shadow-xl backdrop:bg-stone-900/40"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <form action={action} className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl font-semibold">Add a contact</h2>
            <button type="button" onClick={() => dialog.current?.close()} className="text-stone-400 hover:text-stone-700">
              ✕
            </button>
          </div>

          <input name="name" required placeholder="Full name *" className={input} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <input name="title" placeholder="Title" className={input} />
            <input name="company" placeholder="Company" className={input} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="industry" placeholder="Industry" className={input} />
            <label className="flex items-center gap-2 text-sm text-stone-600">
              Relationship
              <select name="relationship_strength" defaultValue="3" className={input}>
                <option value="1">1 · just met</option>
                <option value="2">2 · acquaintance</option>
                <option value="3">3 · know well</option>
                <option value="4">4 · trusted</option>
                <option value="5">5 · close</option>
              </select>
            </label>
          </div>
          <input name="introduction_preferences" placeholder="Intro preferences (e.g. no investor intros)" className={input} />

          <div className="space-y-1 rounded-lg bg-stone-50 p-3">
            <div className="flex items-center justify-between text-sm font-medium text-stone-700">
              <span>First conversation (optional)</span>
              <input type="date" name="last_interaction_date" defaultValue={defaultDate} className="rounded border border-stone-300 px-1.5 py-0.5 text-xs" />
            </div>
            <textarea
              name="notes"
              rows={4}
              placeholder="What did you learn? What are they looking for, and what could they offer others?"
              className={`${input} bg-white`}
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-stone-600">
            <input type="checkbox" name="consent" required className="mt-0.5" />
            This person is OK being in WarmSignal. Their name, title and company will be searched on the public web.
          </label>

          {state.error && <p className="text-sm text-red-700">{state.error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-md px-3 py-1.5 text-sm hover:bg-stone-100">
              Cancel
            </button>
            <SubmitButton pendingText="Saving & extracting…" className="bg-amber-600 text-white hover:bg-amber-700">
              Add contact
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
