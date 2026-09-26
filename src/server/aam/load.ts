/* The caller's rows for one Aam Salah turn, read with THEIR JWT: RLS is the
 * second barrier, and the explicit filters say what each query wants: my rows
 * by user_id, and in couple mode the partner's shared rows by household_id
 * (plan D1). The partner's name and Besoins budget come from couple_state,
 * never their profile. Never the service key. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { payPeriod, type ISODate } from '../../shared/dates';
import { floorFor } from '../../shared/floor';
import { CoupleState } from '../../shared/schemas';
import type {
  Bill,
  BillPayment,
  Debt,
  Expense,
  Goal,
  Income,
  Profile,
  Reminder,
  SavingsMove,
} from '../../shared/schemas';

export interface TurnRows {
  profile: Profile | null;
  expenses: Expense[];
  bills: Bill[];
  billPayments: BillPayment[];
  debts: Debt[];
  goals: Goal[];
  savingsMoves: SavingsMove[];
  reminders: Reminder[];
  incomes: Income[];
  /** couple mode: the partner as couple_state gives them; null when solo */
  partner: { user_id: string; first_name: string; needs_mil: number } | null;
}

/** 2 000 rows cover three pay periods of anyone's spending many times over. */
const MAX_EXPENSES = 2000;

type Res<T> = { data: T | null; error: { message: string } | null };
const rows = async <T>(q: PromiseLike<Res<T>>, what: string): Promise<T> => {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
};

export async function loadRows(sb: SupabaseClient, userId: string, today: ISODate): Promise<TurnRows> {
  const floor = floorFor(today);
  const [profile, expenses, bills, billPayments, debts, goals, savingsMoves, reminders, incomes] =
    await Promise.all([
      rows<Profile | null>(sb.from('profiles').select('*').eq('user_id', userId).maybeSingle(), 'profiles'),
      /* deleted rows included: undoing a delete needs the row */
      rows<Expense[]>(
        sb
          .from('expenses')
          .select('*')
          .eq('user_id', userId)
          .gte('spent_on', floor)
          .order('spent_on', { ascending: false })
          .limit(MAX_EXPENSES),
        'expenses',
      ),
      rows<Bill[]>(sb.from('bills').select('*').eq('user_id', userId), 'bills'),
      rows<BillPayment[]>(sb.from('bill_payments').select('*').gte('period_start', floor), 'bill_payments'),
      /* settled ones too: undoing settle_debt needs the row */
      rows<Debt[]>(sb.from('debts').select('*').eq('user_id', userId), 'debts'),
      rows<Goal[]>(sb.from('goals').select('*').eq('user_id', userId).is('archived_at', null), 'goals'),
      rows<SavingsMove[]>(sb.from('savings_moves').select('*').eq('user_id', userId), 'savings_moves'),
      rows<Reminder[]>(
        sb.from('reminders').select('*').eq('user_id', userId).is('done_at', null),
        'reminders',
      ),
      rows<Income[]>(
        sb.from('incomes').select('*').eq('user_id', userId).gte('received_on', floor),
        'incomes',
      ),
    ]);
  const mine = { profile, expenses, bills, billPayments, debts, goals, savingsMoves, reminders, incomes };
  if (!profile) return { ...mine, partner: null };
  const home = await household(sb, payPeriod(today, profile.payday).start);
  if (!home) return { ...mine, partner: null };

  const theirs = (table: string) =>
    sb.from(table).select('*').eq('household_id', home.id).neq('user_id', userId);
  const [sharedExpenses, sharedBills, sharedIncomes, sharedGoals] = await Promise.all([
    rows<Expense[]>(
      theirs('expenses').gte('spent_on', floor).order('spent_on', { ascending: false }).limit(MAX_EXPENSES),
      'expenses',
    ),
    rows<Bill[]>(theirs('bills'), 'bills'),
    rows<Income[]>(theirs('incomes').gte('received_on', floor), 'incomes'),
    rows<Goal[]>(theirs('goals').is('archived_at', null), 'goals'),
  ]);
  /* the partner's moves on the household goal, whoever owns it (plan D2) */
  const homeGoals = [...goals, ...sharedGoals].filter((g) => g.household_id === home.id).map((g) => g.id);
  const partnerMoves = homeGoals.length
    ? await rows<SavingsMove[]>(
        sb.from('savings_moves').select('*').in('goal_id', homeGoals).neq('user_id', userId),
        'savings_moves',
      )
    : [];
  return {
    ...mine,
    expenses: [...expenses, ...sharedExpenses],
    bills: [...bills, ...sharedBills],
    incomes: [...incomes, ...sharedIncomes],
    goals: [...goals, ...sharedGoals],
    savingsMoves: [...savingsMoves, ...partnerMoves],
    partner: home.partner,
  };
}

/** The household while two share it, asked for my period start (plan D2);
 * an invite waiting, an error or an answer that doesn't parse is solo. */
async function household(sb: SupabaseClient, on: ISODate) {
  const answer: { data: unknown; error: unknown } = await sb.rpc('couple_state', { p_on: on });
  if (answer.error) return null;
  const got = CoupleState.safeParse(answer.data);
  if (!got.success || got.data.status !== 'on') return null;
  return { id: got.data.household_id, partner: got.data.partner };
}
