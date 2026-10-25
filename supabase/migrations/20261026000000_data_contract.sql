-- Data contract fields (docs/data-contract.md) and the catch-up classifier's assessment.

-- Identity & contact details. email/phone are private: never sent to Claude or Tavily.
alter table contacts add column linkedin_url text;
alter table contacts add column email text;
alter table contacts add column phone text;                           -- E.164
alter table contacts add column location text;                        -- metro area only
alter table contacts add column source text[] not null default '{}';  -- linkedin_export | vcard | manual | demo
alter table contacts add column connected_on date;
-- [{company, title, seen_at}], appended by imports when company/title changes (a "why now" signal)
alter table contacts add column profile_history jsonb not null default '[]';

-- Claude's per-contact catch-up assessment (src/lib/classify.ts). The deck score is never stored:
-- it is recomputed in code from this assessment and the evaluation date (src/lib/catch-up.ts).
alter table contacts add column outreach_assessment jsonb;
alter table contacts add column outreach_assessed_at timestamptz;

-- Notes vs. meeting follow-ups ("how did it go?").
alter table interactions add column kind text not null default 'note'
  check (kind in ('note', 'onboarding_quick_note', 'meeting_followup'));
alter table interactions add column outcome text check (outcome in ('positive', 'neutral', 'negative'));
alter table interactions add column opportunity_id uuid references opportunities(id) on delete set null;
