/* NotifyDb on supabase-js with the SERVICE key (notify-run only, spec §8.5).
 * RLS does not apply here, so every query but listUsers names the user:
 * `user_id = …` on each table, and bill_payments (which has no user_id)
 * through the user's own bill ids. In couple mode (plan D1) the partner's
 * rows come only through `household_id = <the user's household>`, which only
 * shared rows carry, and the partner's profile is read for their Besoins
 * budget alone. The tests record every query to hold this. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { payPeriod, type ISODate } from '../../shared/dates';
import { splitSalary, type Mil } from '../../shared/money';
import { planFor } from '../../shared/plan';
import type { UserSnapshot } from '../../shared/notify/rules';
import type {
  Bill,
  BillPayment,
  Debt,
  Expense,
  Goal,
  Income,
  NewSavingsMove,
  Profile,
  Reminder,
  SavingsMove,
} from '../../shared/schemas';
import { floorFor } from '../../shared/floor';
import type { PushSub } from './push';
import type { NotificationInsert, NotifyDb } from './run';

const MAX_EXPENSES = 2000;

type Res<T> = { data: T | null; error: { message: string } | null };
const rows = async <T>(q: PromiseLike<Res<T>>, what: string): Promise<T> => {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
};

export function supabaseNotifyDb(sb: SupabaseClient): NotifyDb {
  const forUser = (table: string, userId: string) => sb.from(table).select('*').eq('user_id', userId);

  /** The partner's shared rows, while two share the household (an invite
   * waiting is solo). Null when the user has no partner. */
  async function householdRows(userId: string, floor: ISODate, myGoals: Goal[]) {
    const member = await rows<{ household_id: string } | null>(
      sb.from('household_members').select('household_id').eq('user_id', userId).maybeSingle(),
      'household_members',
    );
    if (!member) return null;
    const home = member.household_id;
    const mates = await rows<{ user_id: string }[]>(
      sb.from('household_members').select('user_id').eq('household_id', home).neq('user_id', userId),
      'household_members',
    );
    const partnerId = mates[0]?.user_id;
    if (!partnerId) return null;
    const theirs = (table: string) =>
      sb.from(table).select('*').eq('household_id', home).neq('user_id', userId);
    const [partner, expenses, bills, incomes, goals] = await Promise.all([
      rows<Profile | null>(forUser('profiles', partnerId).maybeSingle(), 'profiles'),
      rows<Expense[]>(
        theirs('expenses').gte('spent_on', floor).order('spent_on', { ascending: false }).limit(MAX_EXPENSES),
        'expenses',
      ),
      rows<Bill[]>(theirs('bills'), 'bills'),
      rows<Income[]>(theirs('incomes').gte('received_on', floor), 'incomes'),
      rows<Goal[]>(theirs('goals').is('archived_at', null), 'goals'),
    ]);
    /* the partner's moves on the household goal, whoever owns it (plan D2) */
    const homeGoals = [...myGoals, ...goals].filter((g) => g.household_id === home).map((g) => g.id);
    const savingsMoves = homeGoals.length
      ? await rows<SavingsMove[]>(
          sb.from('savings_moves').select('*').in('goal_id', homeGoals).neq('user_id', userId),
          'savings_moves',
        )
      : [];
    return { partner, expenses, bills, incomes, goals, savingsMoves };
  }

  return {
    async listUsers(after, limit) {
      let q = sb.from('profiles').select('user_id').not('onboarded_at', 'is', null);
      if (after !== null) q = q.gt('user_id', after);
      const found = await rows<{ user_id: string }[]>(q.order('user_id').limit(limit), 'profiles');
      return found.map((r) => r.user_id);
    },

    async loadSnapshot(userId: string, today: ISODate): Promise<UserSnapshot | null> {
      const floor = floorFor(today);
      const [profile, expenses, bills, debts, goals, savingsMoves, reminders, incomes] = await Promise.all([
        rows<Profile | null>(forUser('profiles', userId).maybeSingle(), 'profiles'),
        rows<Expense[]>(
          forUser('expenses', userId)
            .gte('spent_on', floor)
            .order('spent_on', { ascending: false })
            .limit(MAX_EXPENSES),
          'expenses',
        ),
        rows<Bill[]>(forUser('bills', userId), 'bills'),
        rows<Debt[]>(forUser('debts', userId).is('deleted_at', null), 'debts'),
        rows<Goal[]>(forUser('goals', userId).is('archived_at', null), 'goals'),
        rows<SavingsMove[]>(forUser('savings_moves', userId), 'savings_moves'),
        rows<Reminder[]>(
          forUser('reminders', userId).is('done_at', null).is('deleted_at', null),
          'reminders',
        ),
        rows<Income[]>(forUser('incomes', userId).gte('received_on', floor), 'incomes'),
      ]);
      if (!profile?.onboarded_at) return null;
      const shared = await householdRows(userId, floor, goals);
      if (shared) {
        expenses.push(...shared.expenses);
        bills.push(...shared.bills);
        incomes.push(...shared.incomes);
        goals.push(...shared.goals);
        savingsMoves.push(...shared.savingsMoves);
      }
      const billPayments = bills.length
        ? await rows<BillPayment[]>(
            sb
              .from('bill_payments')
              .select('*')
              .in(
                'bill_id',
                bills.map((b) => b.id),
              )
              .gte('period_start', floor),
            'bill_payments',
          )
        : [];
      const couple = shared
        ? {
            me: userId,
            partnerNeeds: partnerNeeds(shared.partner, payPeriod(today, profile.payday)),
          }
        : null;
      return {
        profile,
        expenses,
        bills,
        billPayments,
        debts,
        goals,
        savingsMoves,
        reminders,
        incomes,
        couple,
      };
    },

    recentNotifications: (userId, since) =>
      rows<{ trigger: string; dedupe_key: string; created_at: string }[]>(
        sb
          .from('notifications')
          .select('trigger, dedupe_key, created_at')
          .eq('user_id', userId)
          .gte('created_at', since),
        'notifications',
      ),

    async insertDeposit(move: NewSavingsMove) {
      await rows(
        sb.from('savings_moves').upsert(move, { onConflict: 'id', ignoreDuplicates: true }),
        'savings_moves',
      );
    },

    async insertNotification(row: NotificationInsert) {
      const inserted = await rows<{ id: string }[]>(
        sb
          .from('notifications')
          .upsert(row, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
          .select('id'),
        'notifications',
      );
      return inserted[0] ?? null;
    },

    subscriptions: (userId) =>
      rows<PushSub[]>(
        /* the table keeps at most 5 (migration 20261001); a slow push service can't hold the run past that */
        sb
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(5),
        'push_subscriptions',
      ),

    async deleteSubscription(userId, endpoint) {
      await rows(
        sb.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint),
        'push_subscriptions',
      );
    },
  };
}

/** The partner's Besoins budget: their plan at my period start, as couple_needs_mil (plan D2). */
function partnerNeeds(partner: Profile | null, period: ReturnType<typeof payPeriod>): Mil {
  if (!partner) return 0;
  const plan = planFor(partner, period);
  return splitSalary(plan.salary_mil, plan.split).needs;
}
