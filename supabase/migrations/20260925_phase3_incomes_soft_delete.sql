/* Stouchi redesign, Phase 3 (Aam Salah v2) — pot incomes, soft delete on debts
 * and reminders.
 *
 * ADDITIVE ONLY: one new table and two nullable columns.
 *
 * - incomes: money that lands in Besoins or Envies for the pay period it falls
 *   in (a bonus kept "pour ce mois"). Income to Épargne is a savings_moves
 *   deposit instead, so the pot is needs | wants only. Same treatment as the
 *   20260923 tables: RLS enabled and forced, one policy per operation, no
 *   delete (soft delete through deleted_at), zero grants to anon.
 * - debts.deleted_at / reminders.deleted_at: Aam Salah's Annuler on add_debt and
 *   set_reminder. The existing "edit own" update policies already cover it. */

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),  -- normally client-generated: idempotent upserts
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  pot text not null check (pot in ('needs', 'wants')),
  label text not null default '' check (char_length(label) <= 60),
  received_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists incomes_user_received on public.incomes (user_id, received_on desc)
  where deleted_at is null;

create or replace trigger incomes_touch before insert or update on public.incomes
  for each row execute function public.touch_updated_at();
create or replace trigger incomes_keep_user before update on public.incomes
  for each row execute function public.keep_user_id();

alter table public.incomes enable row level security;
alter table public.incomes force row level security;

/* Revoke everything first (TRUNCATE/REFERENCES/TRIGGER included — see
   20260923), then grant only what the policies use. */
revoke all on public.incomes from anon, authenticated;
grant select, insert, update on public.incomes to authenticated;

/* incomes — own rows only; no delete: soft delete (deleted_at). */
drop policy if exists "incomes: read own" on public.incomes;
create policy "incomes: read own" on public.incomes for select to authenticated using (user_id = auth.uid());
drop policy if exists "incomes: create own" on public.incomes;
create policy "incomes: create own" on public.incomes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "incomes: edit own" on public.incomes;
create policy "incomes: edit own" on public.incomes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.debts add column if not exists deleted_at timestamptz;
alter table public.reminders add column if not exists deleted_at timestamptz;
