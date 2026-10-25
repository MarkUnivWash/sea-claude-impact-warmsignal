-- Per-user networks: every row belongs to an auth user; RLS restricts access to the owner.
-- Existing rows were shared demo data (saved in data/demo_snapshot.json), so they are cleared.
delete from contacts; -- cascades to interactions, signals, opportunities

-- Contact ids become generated; the CSV's stable identifier moves to external_id (unique per user).
alter table contacts alter column id set default gen_random_uuid()::text;
alter table contacts add column external_id text;

alter table contacts add column owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade;
alter table interactions add column owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade;
alter table signals add column owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade;
alter table opportunities add column owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade;

alter table contacts add constraint contacts_owner_external_id_key unique (owner_id, external_id);
create index on contacts (owner_id);
create index on interactions (owner_id);
create index on signals (owner_id);
create index on opportunities (owner_id);

create policy "owner only" on contacts for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner only" on interactions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner only" on signals for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner only" on opportunities for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
