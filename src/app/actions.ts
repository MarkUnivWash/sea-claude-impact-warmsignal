"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildBriefing, defaultEvalDate } from "@/lib/briefing";
import { importContactsCsv } from "@/lib/contacts";
import { draftOutreach } from "@/lib/draft";
import { ingestNote } from "@/lib/extract";
import { findIntroductions } from "@/lib/match";
import { db, must } from "@/lib/supabase";
import type { OpportunityStatus } from "@/lib/types";

// No auth in the MVP (PRD §6.4). If deployed, protect with APP_PASSWORD (see src/proxy.ts).

export async function addNoteAction(formData: FormData) {
  const contactId = String(formData.get("contact_id"));
  const date = String(formData.get("date") || defaultEvalDate());
  const notes = String(formData.get("notes") ?? "").trim();
  if (!notes) throw new Error("Note is empty");
  await ingestNote(contactId, date, notes);
  revalidatePath(`/contacts/${contactId}`);
}

export async function importCsvAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file");
  await importContactsCsv(await file.text());
  revalidatePath("/contacts");
}

export async function findIntroductionsAction() {
  await findIntroductions();
  revalidatePath("/");
}

export async function setStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as OpportunityStatus;
  const deferDays = 7;
  const deferred_until =
    status === "deferred"
      ? new Date(Date.parse(String(formData.get("eval_date") || defaultEvalDate())) + deferDays * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;
  must(
    await db()
      .from("opportunities")
      .update({ status, deferred_until, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  revalidatePath("/");
}

export async function setConsentAction(formData: FormData) {
  must(
    await db()
      .from("opportunities")
      .update({ consent_status: String(formData.get("consent")), updated_at: new Date().toISOString() })
      .eq("id", String(formData.get("id"))),
  );
  revalidatePath("/");
}

export async function draftMessageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const evalDate = String(formData.get("eval_date") || defaultEvalDate());
  const briefing = await buildBriefing(evalDate);
  const candidate = [...briefing.recommendations, ...briefing.alsoConsidered].find((c) => c.opp.id === id);
  if (!candidate) throw new Error("Opportunity not found or no longer eligible");
  const draft_message = await draftOutreach(candidate);
  must(await db().from("opportunities").update({ draft_message }).eq("id", id));
  revalidatePath("/");
}

export async function setEvalDateAction(formData: FormData) {
  redirect(`/?date=${String(formData.get("date"))}`);
}
