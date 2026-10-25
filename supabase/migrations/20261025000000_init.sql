-- WarmSignal core schema (PRD §7). Server-side access only via the service role;
-- RLS is enabled with no policies so the anon key can read nothing.

create table contacts (
  id text primary key,                      -- stable id from the CSV (e.g. c001)
  name text not null,
  company text,
  title text,
  industry text,
  relationship_strength smallint not null default 3 check (relationship_strength between 1 and 5),
  last_interaction_date date,
  introduction_preferences text,            -- free text, e.g. "No investor intros right now"
  created_at timestamptz not null default now()
);

create table interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null references contacts(id) on delete cascade,
  date date not null,
  raw_notes text not null,
  context jsonb,                            -- summary, uncertainties, etc. from extraction
  extracted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on interactions (contact_id);

-- Needs and offers (PRD §7.3)
create table signals (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null references contacts(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,
  type text not null check (type in ('need', 'offer')),
  category text not null,
  description text not null,
  supporting_text text not null,
  quote_verified boolean not null default false, -- supporting_text found verbatim in the note
  is_inferred boolean not null default false,    -- true = assumption, not something stated
  time_sensitive boolean not null default false,
  confidence numeric not null check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active', 'stale', 'resolved')),
  relevant_until date,
  created_at timestamptz not null default now()
);
create index on signals (contact_id);
create index on signals (type, status);

-- Introduction opportunities (PRD §7.4). The weighted score is NOT stored:
-- it is recomputed deterministically in code from these components + an eval date.
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  recipient_contact_id text not null references contacts(id) on delete cascade,
  proposed_contact_id text not null references contacts(id) on delete cascade,
  matched_need_id uuid not null references signals(id) on delete cascade,
  matched_offer_id uuid references signals(id) on delete set null,
  value_proposition text not null,
  why_proposed text not null,
  why_now text,
  give_value smallint not null check (give_value between 0 and 5),
  timeliness smallint not null check (timeliness between 0 and 5),
  match_confidence numeric not null check (match_confidence between 0 and 1),
  match_basis text not null check (match_basis in ('stated_offer', 'profile_inference')),
  appropriate boolean not null default true,
  concerns text,
  missing_evidence text,
  consent_status text not null default 'not_requested'
    check (consent_status in ('not_requested', 'pending', 'approved', 'declined')),
  status text not null default 'suggested'
    check (status in ('suggested', 'useful', 'deferred', 'dismissed', 'completed')),
  deferred_until date,
  draft_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (matched_need_id, proposed_contact_id)
);
create index on opportunities (recipient_contact_id);

alter table contacts enable row level security;
alter table interactions enable row level security;
alter table signals enable row level security;
alter table opportunities enable row level security;
