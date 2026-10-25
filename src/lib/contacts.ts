import Papa from "papaparse";
import { must, type Ctx } from "./supabase";

// FR-01: CSV import. Columns: contact_id,name,company,title,industry,
// relationship_strength,last_interaction_date,introduction_preferences

export async function importContactsCsv(ctx: Ctx, csv: string): Promise<number> {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`CSV error: ${parsed.errors[0].message}`);

  const rows = parsed.data.map((r, i) => {
    const id = r.contact_id?.trim();
    const name = r.name?.trim();
    if (!id || !name) throw new Error(`Row ${i + 2}: contact_id and name are required`);
    const strength = Number(r.relationship_strength);
    const date = r.last_interaction_date?.trim();
    return {
      owner_id: ctx.ownerId,
      external_id: id,
      name,
      company: r.company?.trim() || null,
      title: r.title?.trim() || null,
      industry: r.industry?.trim() || null,
      relationship_strength: Number.isInteger(strength) && strength >= 1 && strength <= 5 ? strength : 3,
      last_interaction_date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : null,
      introduction_preferences: r.introduction_preferences?.trim() || null,
    };
  });

  // Matched on (owner, contact_id): re-importing updates rather than duplicates.
  must(await ctx.db.from("contacts").upsert(rows, { onConflict: "owner_id,external_id" }));
  return rows.length;
}
