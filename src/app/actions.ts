"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { defaultEvalDate } from "@/lib/briefing";
import { importContactsCsv } from "@/lib/contacts";
import { ensureDrafts } from "@/lib/draft";
import { enrichAndSave, enrichPending } from "@/lib/enrich";
import { ingestNote } from "@/lib/extract";
import { findIntroductions } from "@/lib/match";
import { db, must } from "@/lib/supabase";
import type { Opportunity } from "@/lib/types";

// No auth in the MVP (PRD §6.4). The deployed site is gated by APP_PASSWORD (see src/proxy.ts).

const evalDateFrom = (formData: FormData) => String(formData.get("eval_date") || defaultEvalDate());

async function updateOpportunity(id: string, patch: Partial<Opportunity>) {
  must(await db().from("opportunities").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
}

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
  // Enrich new contacts from the web in the background, after the response is sent.
  after(() => enrichPending());
  revalidatePath("/contacts");
}

export type CreateContactState = { error: string | null };

/** Manual contact entry (modal). Optionally logs a first conversation, then enriches in the background. */
export async function createContactAction(_prev: CreateContactState, formData: FormData): Promise<CreateContactState> {
  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;
  const name = text("name");
  if (!name) return { error: "Name is required" };
  if (formData.get("consent") !== "on") return { error: "Confirm this person is OK being added" };

  const id = `c-${Date.now().toString(36)}`;
  const strength = Number(formData.get("relationship_strength"));
  const { error } = await db()
    .from("contacts")
    .insert({
      id,
      name,
      company: text("company"),
      title: text("title"),
      industry: text("industry"),
      relationship_strength: strength >= 1 && strength <= 5 ? strength : 3,
      last_interaction_date: text("last_interaction_date"),
      introduction_preferences: text("introduction_preferences"),
    });
  if (error) return { error: error.message };

  const notes = text("notes");
  if (notes) {
    try {
      await ingestNote(id, text("last_interaction_date") ?? defaultEvalDate(), notes);
    } catch (e) {
      return { error: `Contact saved, but note extraction failed: ${(e as Error).message}` };
    }
  }
  after(() => enrichAndSave(id).catch((e) => console.error(`Enrichment failed for ${id}:`, e)));
  revalidatePath("/contacts");
  redirect(`/contacts/${id}`);
}

export async function enrichContactAction(formData: FormData) {
  const id = String(formData.get("contact_id"));
  await enrichAndSave(id);
  revalidatePath(`/contacts/${id}`);
}

export async function enrichAllAction() {
  await enrichPending();
  revalidatePath("/contacts");
}

export async function findIntroductionsAction(formData: FormData) {
  await findIntroductions();
  await ensureDrafts(evalDateFrom(formData));
  revalidatePath("/");
}

/** Moves a recommendation through the double opt-in: ask recipient -> ask proposed -> intro. */
export async function advanceAction(formData: FormData) {
  const id = String(formData.get("id"));
  switch (String(formData.get("step"))) {
    case "recipient_yes":
      await updateOpportunity(id, { consent_status: "pending", status: "useful" });
      break;
    case "proposed_yes":
      await updateOpportunity(id, { consent_status: "approved", status: "useful" });
      break;
    case "declined":
      await updateOpportunity(id, { consent_status: "declined" });
      break;
    case "intro_sent":
      await updateOpportunity(id, { status: "completed" });
      break;
  }
  revalidatePath("/");
}

export async function setStatusAction(formData: FormData) {
  const status = String(formData.get("status")) as Opportunity["status"];
  const deferred_until =
    status === "deferred"
      ? new Date(Date.parse(evalDateFrom(formData)) + 7 * 86_400_000).toISOString().slice(0, 10)
      : null;
  await updateOpportunity(String(formData.get("id")), { status, deferred_until });
  revalidatePath("/");
}

export async function redraftAction(formData: FormData) {
  await updateOpportunity(String(formData.get("id")), { draft_message: null, draft_kind: null });
  revalidatePath("/");
}

export async function setEvalDateAction(formData: FormData) {
  redirect(`/?date=${String(formData.get("date"))}`);
}
