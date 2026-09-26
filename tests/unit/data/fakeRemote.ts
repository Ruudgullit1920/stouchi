/* An in-memory Remote that behaves like the Supabase tables the outbox talks to:
 * the server stamps updated_at, `ignore` never overwrites, and failures can be queued. */
import { RemoteError, type Remote, type RemoteErrorKind } from '../../../src/data/remote';
import { rowKey, type Row, type Table } from '../../../src/data/localdb';
import { USER } from '../fixtures';

export class FakeRemote implements Remote {
  tables = new Map<Table, Map<string, Row>>();
  calls: { table: Table; rows: Row[] }[] = [];
  pulls: { table: Table; cursor: string | null }[] = [];
  private failures: { kind: RemoteErrorKind; code?: string }[] = [];
  private clock = Date.parse('2026-09-10T10:00:00Z');
  /** runs while an upsert is in flight — to simulate a write landing mid-push */
  onUpsert?: () => Promise<void>;
  /** runs while a pull is in flight, before its rows come back */
  onPull?: (table: Table) => Promise<void>;
  /** the notifications table, written only by the "cron" (serverNotify) */
  notifications = new Map<string, Row>();
  notifPulls: { since: string; limit: number }[] = [];
  patches: { table: string; id: string; fields: Row }[] = [];
  /** whose session the requests carry */
  whoAmI: string | null = USER;
  /** the couple RPCs (Phase 6): each function's answer, or a RemoteError it throws */
  rpcAnswers: Record<string, unknown> = {
    couple_state: { household_id: null, status: 'solo', invite: null, partner: null },
  };
  rpcCalls: { fn: string; args: Row }[] = [];

  async rpc(fn: string, args: Row) {
    this.rpcCalls.push({ fn, args });
    await Promise.resolve();
    const answer = fn in this.rpcAnswers ? this.rpcAnswers[fn] : {};
    if (answer instanceof RemoteError) throw answer;
    return answer;
  }

  currentUser() {
    return Promise.resolve(this.whoAmI);
  }

  failNext(kind: RemoteErrorKind, times = 1, code?: string) {
    for (let i = 0; i < times; i++) this.failures.push({ kind, code });
  }

  table(t: Table) {
    if (!this.tables.has(t)) this.tables.set(t, new Map());
    return this.tables.get(t) as Map<string, Row>;
  }

  /** A change made elsewhere (another device), stamped by the "server". */
  serverWrite(t: Table, row: Row) {
    this.table(t).set(rowKey(t, row), { ...row, updated_at: this.tick() });
  }

  private tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  async upsert(table: Table, rows: Row[], mode: 'merge' | 'ignore') {
    this.calls.push({ table, rows });
    const f = this.failures.shift();
    if (f) throw new RemoteError(f.kind, f.code ?? '', 'fake failure');
    await this.onUpsert?.();
    for (const row of rows) {
      const key = rowKey(table, row);
      if (mode === 'ignore' && this.table(table).has(key)) continue;
      this.table(table).set(key, { ...row, updated_at: this.tick() });
    }
  }

  async pullSince(table: Table, cursor: string | null) {
    this.pulls.push({ table, cursor });
    await this.onPull?.(table);
    const f = this.failures.shift();
    if (f) throw new RemoteError(f.kind, f.code ?? '', 'fake failure');
    const rows = [...this.table(table).values()]
      .filter((r) => cursor === null || String(r.updated_at) > cursor)
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
    return { rows, cursor: rows.length ? String(rows[rows.length - 1].updated_at) : cursor };
  }

  serverNotify(...rows: Row[]) {
    for (const r of rows) this.notifications.set(String(r.id), r);
  }

  async patch(table: string, id: string, fields: Row) {
    this.patches.push({ table, id, fields });
    const f = this.failures.shift();
    if (f) throw new RemoteError(f.kind, f.code ?? '', 'fake failure');
    await Promise.resolve();
    const row = this.notifications.get(id);
    if (row) this.notifications.set(id, { ...row, ...fields });
  }

  /** the next notifications pulls fail at network level */
  failNotifications = 0;

  async pullNotifications(since: string, limit: number) {
    this.notifPulls.push({ since, limit });
    if (this.failNotifications-- > 0) throw new RemoteError('network', '', 'fake failure');
    const f = this.failures.shift();
    if (f) throw new RemoteError(f.kind, f.code ?? '', 'fake failure');
    await Promise.resolve();
    return [...this.notifications.values()]
      .filter((r) => Date.parse(String(r.created_at)) >= Date.parse(since))
      .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))
      .slice(0, limit);
  }
}
