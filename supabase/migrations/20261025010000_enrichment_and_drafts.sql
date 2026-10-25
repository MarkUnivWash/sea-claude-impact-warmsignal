-- Public-web enrichment (Tavily + Claude). Kept separate from Alonso's own notes:
-- it is unverified context, never treated as a stated need.
alter table contacts add column enrichment jsonb;
alter table contacts add column enriched_at timestamptz;

-- Which step the stored draft is for: ask the recipient, ask the proposed contact, or the intro itself.
alter table opportunities add column draft_kind text
  check (draft_kind in ('ask_recipient', 'ask_proposed', 'intro'));
