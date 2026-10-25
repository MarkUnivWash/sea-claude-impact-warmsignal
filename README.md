# WarmSignal

**Be the person who always has something valuable to give.**

A relationship-intelligence briefing for Alonso (fractional CMO). Conversation notes go in; Claude extracts needs and offers with evidence; WarmSignal proposes introductions and scores them deterministically. Each morning it shows up to five opportunities to give.

```
Contacts CSV + notes → Claude extraction (needs/offers + quotes) → Supabase
  → Claude match validation (Give Value, confidence, appropriateness)
  → deterministic scoring in code (PRD §5) → briefing (≤5, one per recipient)
```

## Setup

```bash
npm install
cp .env.example .env.local      # fill in ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# Apply the schema: paste supabase/migrations/*.sql into the Supabase SQL editor,
# or: supabase link --project-ref <ref> && supabase db push
npm run seed                    # 30 sample contacts, 14 notes, extraction + matching (~1–2 min)
npm run dev                     # http://localhost:3000
```

`npm run seed -- --reset` wipes everything and reloads the sample data.

## Where things live

| Concern | File |
|---|---|
| Claude extraction (Stage A) | `src/lib/extract.ts` |
| Candidate matching + validation (Stages B–C) | `src/lib/match.ts` |
| **Scoring weights, cooling curve, eligibility** | `src/lib/scoring.ts` |
| Briefing assembly, dedupe, next action | `src/lib/briefing.ts` |
| Outreach drafts (FR-08) | `src/lib/draft.ts` |
| Schema | `supabase/migrations/` |
| Sample data | `data/contacts.csv`, `data/notes.json` |

## Design decisions

- **Scores are never stored.** Claude's per-pair assessments (Give Value 0–5, timeliness 0–5, match confidence) are stored. The weighted score is recomputed in code from those values and an evaluation date. Set `DEMO_EVAL_DATE` (or use `?date=` on the briefing) and the results are reproducible.
- **Eligibility comes before ranking.** Give Value must be at least 3/5. Candidates are also dropped if they're flagged inappropriate, the need is expired or stale (>270 days), the need is an inference backed by weak evidence, or the candidate was dismissed, deferred, or handled. Filtered candidates appear on the briefing page with the reason, so you can show FR-07 working.
- **Facts vs. assumptions.** Each need or offer carries a verbatim quote, an `is_inferred` flag, and `quote_verified` (we check that the quote really appears in the note). Inferred needs have their Match Confidence capped.
- **Consent first.** The suggested action always asks the recipient first, then the proposed contact. Nothing is ever sent automatically.
- **Privacy.** Supabase RLS is on with no policies, and the server uses the service-role key. Set `APP_PASSWORD` on Vercel to put the deployed site behind HTTP Basic auth.

## Expected demo outcomes (sample data, eval date 2026-10-25)

Strong: Sarah ← Michael (healthcare seed investor), Sarah ← Priya (enterprise health sales advisor), Grace ↔ Tom (routing software buyer/vendor), Olivia ↔ Ben (B2B podcast), David ← Elena (VP Eng, confidential, so it must be permission-first).
Should *not* surface: Sarah ← Hannah (Series A+ only), James (the need belongs to his friend), Marcus (no stated need), Kevin (stale), Rachel (mass-intro request), Tom ← any investor (he declined investor intros).
