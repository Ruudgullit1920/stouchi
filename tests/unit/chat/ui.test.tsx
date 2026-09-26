// @vitest-environment jsdom
import { signal } from '@preact/signals';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../../src/design/components/Sheet';
import { createStore, type Store } from '../../../src/data/store';
import { AddChooser } from '../../../src/features/chat/AddChooser';
import { ChatSheet, type ChatView } from '../../../src/features/chat/ChatSheet';
import { ConfirmCard } from '../../../src/features/chat/ConfirmCard';
import type { Card, Turn } from '../../../src/features/chat/history';
import { bill, debt, expense, goal, profile, USER } from '../fixtures';

type Act = { type: string } & Record<string, unknown>;

let store: Store;
let chat: ChatView;
const e = expense({ amount_mil: 12_000, category: 'cafe', pot: 'wants', label: 'Café' });
const b = bill({ label: 'STEG', amount_mil: 80_000 });
const d = debt({ person: 'Sami', amount_mil: 40_000 });

const turn = (t: Partial<Turn>): Turn => ({
  id: `t${Math.random()}`,
  role: 'assistant',
  text: '',
  at: '',
  ...t,
});
const card = (action: Act, state: Card['state'] = 'open'): Card => ({
  id: `c-${action.type}`,
  action: { kind: 'confirm', ...action },
  state,
});
function show(turns: Turn[]) {
  chat.turns.value = turns;
  return render(<ChatSheet chat={chat} store={store} onOpenScreen={vi.fn()} />);
}

beforeEach(() => {
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile();
  store.expenses.value = [e];
  store.bills.value = [b];
  store.debts.value = [d];
  store.goals.value = [goal({ name: 'Voyage', target_mil: 5_000_000 })];
  chat = {
    turns: signal<Turn[]>([]),
    busy: signal(false),
    offline: signal(false),
    send: vi.fn(() => Promise.resolve()),
    answerCard: vi.fn(() => Promise.resolve()),
    tapChip: vi.fn(() => Promise.resolve()),
    switchIncome: vi.fn(),
  };
});
afterEach(cleanup);

describe('AddChooser', () => {
  it('shows two labelled choices; Saisie manuelle opens the keypad, Parler opens the chat', () => {
    const onManual = vi.fn();
    const onChat = vi.fn();
    render(<AddChooser open onChat={onChat} onManual={onManual} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Saisie manuelle/ }));
    fireEvent.click(screen.getByRole('button', { name: /Parler à Aam Salah/ }));
    expect(onManual).toHaveBeenCalledOnce();
    expect(onChat).toHaveBeenCalledOnce();
  });

  it('Escape or the scrim closes it; closed, it renders nothing', () => {
    const onClose = vi.fn();
    const { rerender } = render(<AddChooser open onChat={vi.fn()} onManual={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Saisie manuelle/ }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<AddChooser open={false} onChat={vi.fn()} onManual={vi.fn()} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: /Saisie manuelle/ })).toBeNull();
  });
});

describe('ChatSheet — thread', () => {
  it('the empty thread shows suggestions, and tapping one sends it', () => {
    show([]);
    fireEvent.click(screen.getByRole('button', { name: '50 courses hier' }));
    expect(chat.tapChip).toHaveBeenCalledWith('50 courses hier');
  });

  it('a user’s text containing <b> renders literally', () => {
    show([turn({ role: 'user', text: '<b>50</b> courses' })]);
    expect(screen.getByText('<b>50</b> courses')).toBeTruthy();
  });

  it('the reply is announced in a polite live region, with amounts in bold', () => {
    const { container } = show([turn({ text: 'Il te reste 475 TND.' })]);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('Il te reste 475 TND.');
    expect(container.querySelector('.msg b')?.textContent).toBe('475 TND');
  });

  it('the composer sends the text and clears', () => {
    show([]);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    fireEvent.input(input, { target: { value: '30 café' } });
    fireEvent.submit(input.closest('form')!);
    expect(chat.send).toHaveBeenCalledWith('30 café');
    expect(input.value).toBe('');
  });

  it('typing dots while busy, and the offline status', () => {
    chat.busy.value = true;
    chat.offline.value = true;
    const { container } = show([turn({ role: 'user', text: 'x' })]);
    expect(container.querySelector('.typing')).toBeTruthy();
    expect(screen.getByText('Mode simple, sans connexion')).toBeTruthy();
  });

  it('the last turn’s chips; an app turn is a small note', () => {
    show([
      turn({ text: 'Noté.', chips: ['Annuler'] }),
      turn({ role: 'app', text: 'Annulé : Café, 4,5 TND.' }),
    ]);
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    expect(screen.getByText('Annulé : Café, 4,5 TND.').className).toContain('note');
  });

  it('an open action renders a "Voir …" button that navigates', () => {
    const onOpenScreen = vi.fn();
    chat.turns.value = [
      turn({
        text: 'Tiens.',
        actions: [{ action: { type: 'open', kind: 'direct', screen: 'historique' }, summary: '' }],
      }),
    ];
    render(<ChatSheet chat={chat} store={store} onOpenScreen={onOpenScreen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voir Historique' }));
    expect(onOpenScreen).toHaveBeenCalledWith('historique');
  });
});

describe('ReceiptCard', () => {
  it('shows the category icon, the pot name and the amount', () => {
    const { container } = show([
      turn({
        text: 'Noté.',
        actions: [
          {
            action: {
              type: 'add_expense',
              kind: 'direct',
              amount: 4.5,
              category: 'cafe',
              pot: 'envies',
              label: 'Café',
              date: '2026-09-10',
            },
            summary: 'Café, 4,5 TND',
          },
        ],
      }),
    ]);
    const receipt = container.querySelector('.receipt')!;
    expect(receipt.querySelector('svg')).toBeTruthy();
    expect(receipt.textContent).toContain('Café');
    expect(receipt.textContent).toContain('Envies');
    expect(receipt.textContent).toMatch(/−4,5/);
  });

  it('debts and reminders have their own receipt', () => {
    const { container } = show([
      turn({
        text: 'Noté.',
        actions: [
          {
            action: {
              type: 'add_debt',
              kind: 'direct',
              direction: 'owed_to_me',
              person: 'Sami',
              amount: 40,
              due: null,
            },
            summary: '',
          },
          {
            action: {
              type: 'set_reminder',
              kind: 'direct',
              text: 'Appeler Sami',
              date: '2026-09-12',
              time: '18:30',
            },
            summary: '',
          },
        ],
      }),
    ]);
    const [debtR, reminderR] = container.querySelectorAll('.receipt');
    expect(debtR.textContent).toContain('Sami te doit');
    expect(reminderR.textContent).toContain('18:30');
  });
});

describe('ConfirmCard', () => {
  const variants: [string, Act, RegExp][] = [
    ['edit_expense', { type: 'edit_expense', ref: e.id, changes: { amount: 21 } }, /12 → 21\sTND/],
    ['delete_expense', { type: 'delete_expense', ref: e.id }, /Supprimer « Café »/],
    ['savings_deposit', { type: 'savings_deposit', amount: 100, from: 'envies' }, /Envies → Épargne/],
    [
      'savings_withdraw',
      { type: 'savings_withdraw', amount: 100, to: 'besoins', reason: '' },
      /Épargne → Besoins/,
    ],
    ['add_income', { type: 'add_income', amount: 150, to: 'epargne', label: 'Prime' }, /Prime/],
    [
      'add_bill',
      { type: 'add_bill', label: 'Internet', amount: 60, frequency: 'monthly', day: 5 },
      /Internet/,
    ],
    ['pay_bill', { type: 'pay_bill', ref: b.id }, /STEG payée/],
    ['settle_debt', { type: 'settle_debt', ref: d.id }, /Sami/],
    ['update_goal', { type: 'update_goal', target: 6000 }, /5\s000 → 6\s000\sTND/],
  ];

  it.each(variants)('%s renders with Oui / Non, and Oui answers once', (_type, action, text) => {
    const { container } = show([turn({ text: 'Je le fais ?', cards: [card(action)] })]);
    expect(container.querySelector('.ccard')!.textContent).toMatch(text);
    const yes = screen.getByRole('button', { name: /^Oui/ });
    expect(screen.getByRole('button', { name: /^Non/ })).toBeTruthy();
    fireEvent.click(yes);
    expect(chat.answerCard).toHaveBeenCalledOnce();
    expect(chat.answerCard).toHaveBeenCalledWith(`c-${action.type}`, true);
  });

  it('the income card switches between Épargne and Ce mois', () => {
    show([
      turn({ text: '?', cards: [card({ type: 'add_income', amount: 150, to: 'epargne', label: 'Prime' })] }),
    ]);
    const month = screen.getByRole('button', { name: 'Ce mois (Envies)' });
    expect(screen.getByRole('button', { name: 'Épargne' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(month);
    expect(chat.switchIncome).toHaveBeenCalledWith('c-add_income', 'envies');
  });

  it('an expired card has no buttons; answered cards say what happened', () => {
    show([
      turn({
        text: '?',
        cards: [
          card({ type: 'delete_expense', ref: e.id }, 'expired'),
          { ...card({ type: 'pay_bill', ref: b.id }, 'yes'), id: 'c2' },
          { ...card({ type: 'settle_debt', ref: d.id }, 'no'), id: 'c3' },
          { ...card({ type: 'edit_expense', ref: e.id, changes: { amount: 1 } }, 'stale'), id: 'c4' },
        ],
      }),
    ]);
    expect(screen.queryByRole('button', { name: /^Oui/ })).toBeNull();
    expect(screen.getByText(/Carte expirée/)).toBeTruthy();
    expect(screen.getByText("C'est fait")).toBeTruthy();
    expect(screen.getByText(/je ne touche à rien/)).toBeTruthy();
    expect(screen.getByText(/La ligne a changé/)).toBeTruthy();
  });

  it('Oui buttons are big enough and labelled', () => {
    show([turn({ text: '?', cards: [card({ type: 'delete_expense', ref: e.id })] })]);
    expect(screen.getByRole('button', { name: 'Oui : Supprimer « Café »' }).className).toContain('cc-yes');
  });
});

describe('focus', () => {
  it('returns to + when the chat sheet closes', () => {
    const { rerender } = render(
      <>
        <button type="button">+</button>
        <Sheet open={false} title="Aam Salah" onClose={vi.fn()}>
          <ChatSheet chat={chat} store={store} onOpenScreen={vi.fn()} />
        </Sheet>
      </>,
    );
    const plus = screen.getByRole('button', { name: '+' });
    plus.focus();
    const tree = (open: boolean) => (
      <>
        <button type="button">+</button>
        <Sheet open={open} title="Aam Salah" onClose={vi.fn()}>
          <ChatSheet chat={chat} store={store} onOpenScreen={vi.fn()} />
        </Sheet>
      </>
    );
    rerender(tree(true));
    expect(document.activeElement).not.toBe(plus);
    rerender(tree(false));
    expect(document.activeElement).toBe(plus);
  });
});

describe('ConfirmCard — partner request', () => {
  it('asks to send the request to the partner, and shows the change', () => {
    const AMIRA = '00000000-0000-4000-8000-000000000002';
    const store = createStore();
    const e = expense({ user_id: AMIRA, label: 'Aziza', amount_mil: 45_000 });
    store.expenses.value = [e];
    store.household.value = {
      household_id: '00000000-0000-4000-8000-000000000099',
      status: 'on',
      invite: null,
      partner: { user_id: AMIRA, first_name: 'Amira', needs_mil: 900_000 },
    };
    const card = (change: unknown) => ({
      id: 'c1',
      state: 'open' as const,
      action: { type: 'partner_request', kind: 'confirm' as const, ref: e.id, change },
    });
    render(
      <ConfirmCard
        card={card({ kind: 'delete' })}
        store={store}
        onAnswer={() => undefined}
        onSwitch={() => undefined}
      />,
    );
    expect(screen.getByText('Envoyer la demande à Amira ?')).toBeTruthy();
    expect(screen.getByText(/Supprimer « Aziza »/)).toBeTruthy();
    cleanup();
    render(
      <ConfirmCard
        card={card({ kind: 'edit', changes: { amount: 40 } })}
        store={store}
        onAnswer={() => undefined}
        onSwitch={() => undefined}
      />,
    );
    expect(screen.getByText(/45 → 40/)).toBeTruthy();
  });
});
