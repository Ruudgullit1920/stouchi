import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/* the CommonJS pipeline, as categories.test reads it */
const load = createRequire(import.meta.url);
const { instructions } = load('../../../lib/aam-salah/instructions.js') as {
  instructions: (prenom: string, partenaire?: string) => string;
};
const { validateActions } = load('../../../lib/aam-salah/validate.js') as {
  validateActions: (actions: unknown[], carnet: object) => { kept: unknown[]; dropped: unknown[] };
};

/* A couple carnet, as buildCarnet writes it (Aam Salah spec §4, plan D7). */
const carnet = (mode: 'solo' | 'couple' = 'couple') => ({
  aujourdhui: '2026-09-22 (mardi)',
  utilisateur:
    mode === 'couple' ? { prenom: 'Sofiene', mode, partenaire: 'Amira' } : { prenom: 'Sofiene', mode },
  pots: { besoins: { reste: 245 }, envies: { reste: 230 }, epargne: { total: 4800 } },
  depenses_recentes: [
    {
      id: 'e0031',
      date: '2026-09-20',
      label: 'Plan B',
      categorie: 'sortie',
      pot: 'envies',
      montant: 60,
      ...(mode === 'couple' && { qui: 'moi' }),
    },
    {
      id: 'e0099',
      date: '2026-09-21',
      label: 'Aziza',
      categorie: 'courses',
      pot: 'besoins',
      montant: 45,
      ...(mode === 'couple' && { qui: 'Amira' }),
    },
  ],
});

describe('validateActions — partner requests (plan D7)', () => {
  it("a delete of the partner's expense becomes a request", () => {
    const { kept, dropped } = validateActions([{ type: 'delete_expense', id: 'e0099' }], carnet());
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      { type: 'partner_request', id: 'e0099', change: { kind: 'delete' }, kind: 'confirm' },
    ]);
  });

  it("an edit of the partner's expense becomes a request carrying the checked changes", () => {
    const { kept } = validateActions(
      [{ type: 'edit_expense', id: 'e0099', changes: { amount: 40, category: 'maison' } }],
      carnet(),
    );
    expect(kept).toEqual([
      {
        type: 'partner_request',
        id: 'e0099',
        change: { kind: 'edit', changes: { amount: 40, category: 'maison', pot: 'besoins' } },
        kind: 'confirm',
      },
    ]);
  });

  it('a bad edit is still dropped, never sent as a request', () => {
    const { kept, dropped } = validateActions(
      [{ type: 'edit_expense', id: 'e0099', changes: { amount: -5 } }],
      carnet(),
    );
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it('my own expenses keep their edit and delete', () => {
    const { kept } = validateActions([{ type: 'delete_expense', id: 'e0031' }], carnet());
    expect(kept).toEqual([{ type: 'delete_expense', id: 'e0031', kind: 'confirm' }]);
  });

  it('solo: nothing changes', () => {
    const { kept } = validateActions([{ type: 'delete_expense', id: 'e0099' }], carnet('solo'));
    expect(kept).toEqual([{ type: 'delete_expense', id: 'e0099', kind: 'confirm' }]);
  });

  it('the model cannot send a partner_request itself', () => {
    const { kept } = validateActions(
      [{ type: 'partner_request', id: 'e0031', change: { kind: 'delete' } }],
      carnet(),
    );
    expect(kept).toEqual([]);
  });
});

describe('instructions — the couple line (spec §9.2)', () => {
  const line =
    /Les dépenses de Amira \(qui = "Amira"\) ne se modifient ni ne se suppriment : propose, et\s+dis que Amira recevra la demande\./;
  it('only in couple mode', () => {
    expect(instructions('Sofiene')).not.toMatch(/recevra la demande/);
    expect(instructions('Sofiene', 'Amira')).toMatch(line);
  });
});

describe('review I1: a partner with no first name', () => {
  it("an expense whose qui is empty is still the partner's: a request, never a direct change", () => {
    const c = carnet();
    const rows = c.depenses_recentes.map((e) => (e.id === 'e0099' ? { ...e, qui: '' } : e));
    const { kept } = validateActions(
      [
        { type: 'delete_expense', id: 'e0099' },
        { type: 'edit_expense', id: 'e0099', changes: { amount: 40 } },
      ],
      { ...c, depenses_recentes: rows },
    );
    expect(kept.map((a) => (a as { type: string }).type)).toEqual(['partner_request', 'partner_request']);
  });
});
