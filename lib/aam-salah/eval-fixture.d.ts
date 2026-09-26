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
} from '../../src/shared/schemas';

declare const fixture: {
  now: string;
  profile: Profile;
  expenses: Expense[];
  bills: Bill[];
  billPayments: BillPayment[];
  debts: Debt[];
  goals: Goal[];
  savingsMoves: SavingsMove[];
  reminders: Reminder[];
  incomes: Income[];
  lastAction: { type: string; ref: string; at: string; summary: string };
  nudgeSeen: string[];
  household: {
    partner: { user_id: string; first_name: string };
    partnerNeeds: number;
    expenses: Expense[];
  };
};
export = fixture;
