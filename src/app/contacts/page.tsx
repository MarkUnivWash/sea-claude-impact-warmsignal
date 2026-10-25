import Link from "next/link";
import { importCsvAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { db, must } from "@/lib/supabase";
import type { Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const supabase = db();
  const [contacts, signals] = await Promise.all([
    supabase.from("contacts").select("*").order("name").then((r) => must<Contact[]>(r)),
    supabase
      .from("signals")
      .select("contact_id, type")
      .eq("status", "active")
      .then((r) => must<{ contact_id: string; type: string }[]>(r)),
  ]);
  const counts = (id: string, type: string) => signals.filter((s) => s.contact_id === id && s.type === type).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-3xl font-semibold">Contacts ({contacts.length})</h1>
        <form action={importCsvAction} className="flex items-center gap-2 text-sm">
          <input type="file" name="file" accept=".csv,text/csv" className="text-sm" />
          <SubmitButton className="border border-stone-300 bg-white hover:bg-stone-100">Import CSV</SubmitButton>
        </form>
      </div>
      <p className="text-sm text-stone-500">
        CSV columns: contact_id, name, company, title, industry, relationship_strength (1–5), last_interaction_date
        (YYYY-MM-DD), introduction_preferences. Re-importing updates existing contacts by contact_id.
      </p>
      <table className="w-full overflow-hidden rounded-lg border border-stone-200 bg-white text-sm">
        <thead className="bg-stone-100 text-left text-stone-600">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Strength</th>
            <th className="px-3 py-2">Last interaction</th>
            <th className="px-3 py-2">Needs / Offers</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-t border-stone-100 hover:bg-amber-50/40">
              <td className="px-3 py-2">
                <Link href={`/contacts/${c.id}`} className="font-medium text-amber-700 hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-stone-600">
                {c.title}, {c.company}
              </td>
              <td className="px-3 py-2">{"●".repeat(c.relationship_strength)}</td>
              <td className="px-3 py-2 text-stone-600">{c.last_interaction_date ?? "—"}</td>
              <td className="px-3 py-2 text-stone-600">
                {counts(c.id, "need")} / {counts(c.id, "offer")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
