-- Catch-up deck: nudges Alonso to meet people whose connection is cooling.
alter table contacts add column last_outreach_at date;          -- when he last suggested meeting up
alter table contacts add column outreach_snoozed_until date;    -- "not now" from the deck
alter table contacts add column outreach_draft text;            -- cached catch-up message; cleared when context changes
