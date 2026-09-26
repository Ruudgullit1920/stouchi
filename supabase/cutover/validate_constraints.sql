/* Cut-over, after the final backfill --apply: the Phase 6 checks (a shared
 * row is a Besoins row) were added `not valid` in 20260929_phase6_couple.sql,
 * so the legacy rows could arrive first. Validate both now.
 *
 * One statement, so it is all or nothing whatever the client: if a single
 * shared Envies row exists, it fails with 23514 and both constraints stay
 * `not valid`. The backfill puts a legacy household's shared Envies in the
 * anchor's private rows (issue shared_wants_private), so a failure here means
 * a row came from somewhere else: find it before launching. */
do $$
begin
  alter table public.expenses validate constraint expenses_shared_needs_only;
  alter table public.incomes validate constraint incomes_shared_needs_only;
end $$;
