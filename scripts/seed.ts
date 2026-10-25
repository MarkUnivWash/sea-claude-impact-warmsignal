// Loads the sample dataset: contacts CSV -> conversation notes (Claude extraction) -> introduction matching.
// Usage: npm run seed            (contacts + notes + enrichment + matching + drafts)
//        npm run seed -- --reset (wipe all tables first)
import { readFileSync } from "node:fs";
import { importContactsCsv } from "../src/lib/contacts";
import { ingestNote } from "../src/lib/extract";
import { findIntroductions } from "../src/lib/match";
import { defaultEvalDate } from "../src/lib/briefing";
import { ensureDrafts } from "../src/lib/draft";
import { enrichPending } from "../src/lib/enrich";
import { db, must } from "../src/lib/supabase";

async function main() {
  const supabase = db();
  if (process.argv.includes("--reset")) {
    // Cascades to interactions, signals, opportunities.
    must(await supabase.from("contacts").delete().neq("id", ""));
    console.log("Reset all data");
  }

  const n = await importContactsCsv(readFileSync("data/contacts.csv", "utf8"));
  console.log(`Imported ${n} contacts`);

  const notes: { contact_id: string; date: string; notes: string }[] = JSON.parse(
    readFileSync("data/notes.json", "utf8"),
  );
  const existing = must<{ contact_id: string; date: string }[]>(
    await supabase.from("interactions").select("contact_id, date"),
  );
  const todo = notes.filter((x) => !existing.some((e) => e.contact_id === x.contact_id && e.date === x.date));

  // Extract in small parallel batches.
  for (let i = 0; i < todo.length; i += 5) {
    await Promise.all(
      todo.slice(i, i + 5).map(async (x) => {
        await ingestNote(x.contact_id, x.date, x.notes);
        console.log(`Extracted note for ${x.contact_id} (${x.date})`);
      }),
    );
  }

  if (process.env.TAVILY_API_KEY) {
    console.log("Enriching contacts from the web…");
    console.log(`Enriched ${await enrichPending()} contacts`);
  } else {
    console.log("TAVILY_API_KEY not set: skipping web enrichment");
  }

  console.log("Finding introductions…");
  const result = await findIntroductions();
  console.log(`Assessed ${result.matches} candidate introductions across ${result.needs} needs`);

  console.log("Drafting outreach for today's briefing…");
  await ensureDrafts(defaultEvalDate());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
