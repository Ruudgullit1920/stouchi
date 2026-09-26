/* Cut-over rollback: the exact inverse of legacy_read_only.sql. It replays
 * the grants that script recorded in cutover.legacy_grants, then drops that
 * record, so the legacy app can write again. It fails loudly, changing
 * nothing, if there was no freeze to undo.
 *
 * Also run at the end of the rehearsal on stouchi-test, so the test project
 * keeps its legacy writes for the E2E and legacy tests. */
do $$
declare
  g record;
begin
  if to_regclass('cutover.legacy_grants') is null then
    raise exception 'nothing to undo: cutover.legacy_grants is missing (was legacy_read_only.sql run?)';
  end if;
  for g in select kind, obj, priv, who from cutover.legacy_grants loop
    execute format(
      'grant %s on %s %s to %s',
      g.priv,
      g.kind,
      g.obj,
      case when g.who = 'public' then 'public' else quote_ident(g.who) end
    );
  end loop;
  drop schema cutover cascade;
end $$;
