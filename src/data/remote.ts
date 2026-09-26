/* The server side of sync: push rows, pull what changed. The interface keeps
 * the outbox testable without a network; supabaseRemote is the real one. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISODate } from '../shared/dates';
import type { PatchTable, Row, Table } from './localdb';

/** network/server: try again later · invalid: the server refuses this row · auth: log in again */
export type RemoteErrorKind = 'network' | 'server' | 'invalid' | 'auth';

export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Remote {
  upsert(table: Table, rows: Row[], mode: 'merge' | 'ignore'): Promise<void>;
  pullSince(table: Table, cursor: string | null): Promise<{ rows: Row[]; cursor: string | null }>;
  /** `update … set <fields> where id = …`: never an upsert (the server grants only these columns) */
  patch(table: PatchTable, id: string, fields: Row): Promise<void>;
  /** the user's notifications created since `since`, newest first */
  pullNotifications(since: string, limit: number): Promise<Row[]>;
  /** whose session the requests carry (null when signed out) */
  currentUser(): Promise<string | null>;
  /** a Postgres function (the couple RPCs): its json answer */
  rpc(fn: string, args: Row): Promise<unknown>;
}

export function classify(error: { code?: string }, status: number): RemoteErrorKind {
  const code = error.code ?? '';
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return 'auth';
  if (status === 0) return 'network';
  if (status >= 500) return 'server';
  return 'invalid';
}

const CONFLICT: Partial<Record<Table, string>> = {
  profiles: 'user_id',
  bill_payments: 'bill_id,period_start',
};
/** tables without updated_at are insert-only: their cursor is created_at */
const CURSOR: Partial<Record<Table, string>> = { bill_payments: 'created_at', savings_moves: 'created_at' };
const PAGE = 1000;

/** PostgREST filter for "after this row" in (col, key) order: keyset paging,
 * so a row changing between two page requests can't shift another one out. */
export const afterRow = (col: string, key: string, last: Row): string => {
  const v = String(last[col]);
  return `${col}.gt."${v}",and(${col}.eq."${v}",${key}.gt."${String(last[key])}")`;
};

/** `floor` = first day of the oldest pay period kept on the device (expenses only). */
export function supabaseRemote(client: SupabaseClient, floor: () => ISODate): Remote {
  const fail = (error: { code?: string; message: string }, status: number) =>
    new RemoteError(classify(error, status), error.code ?? '', error.message);

  return {
    async currentUser() {
      const { data } = await client.auth.getSession();
      return data.session?.user.id ?? null;
    },

    async upsert(table, rows, mode) {
      const { error, status } = await client
        .from(table)
        .upsert(rows, { onConflict: CONFLICT[table] ?? 'id', ignoreDuplicates: mode === 'ignore' });
      if (error) throw fail(error, status);
    },

    async patch(table, id, fields) {
      const { error, status } = await client.from(table).update(fields).eq('id', id);
      if (error) throw fail(error, status);
    },

    async rpc(fn, args) {
      const res: { data: unknown; error: { code?: string; message: string } | null; status: number } =
        await client.rpc(fn, args);
      if (res.error) throw fail(res.error, res.status);
      return res.data;
    },

    async pullNotifications(since, limit) {
      const { data, error, status } = await client
        .from('notifications')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw fail(error, status);
      return data as Row[];
    },

    async pullSince(table, cursor) {
      const col = CURSOR[table] ?? 'updated_at';
      const key = (CONFLICT[table] ?? 'id').split(',')[0];
      const rows: Row[] = [];
      for (;;) {
        const last = rows[rows.length - 1];
        let q = client.from(table).select('*').order(col).order(key).limit(PAGE);
        if (last) q = q.or(afterRow(col, key, last));
        else if (cursor) q = q.gt(col, cursor);
        if (table === 'expenses') q = q.gte('spent_on', floor());
        const { data, error, status } = await q;
        if (error) throw fail(error, status);
        rows.push(...(data as Row[]));
        if (data.length < PAGE) break;
      }
      return { rows, cursor: rows.length ? String(rows[rows.length - 1][col]) : cursor };
    },
  };
}
