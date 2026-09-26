/* What leaves the device for Sentry (spec §8.7, plan Review Focus 4): no amount,
 * label, e-mail, chat text or JWT — only what explains a crash. */
import { describe, expect, it } from 'vitest';
import { scrub, scrubText } from '../../src/shared/scrub';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXNpZ24';

describe('scrubText', () => {
  it('masks amounts, e-mails and tokens, and keeps the words', () => {
    expect(scrubText(`upsert failed for 45000 millimes, sofien@exemple.tn, Bearer ${JWT}`)).toBe(
      'upsert failed for # millimes, [email], Bearer [jwt]',
    );
  });

  it('keeps single digits (line numbers of little meaning, "1 en attente")', () => {
    expect(scrubText('step 3 of 5')).toBe('step 3 of 5');
  });
});

describe('scrub', () => {
  const crafted = () => ({
    /* our own messages carry no label (a free-text label can't be spotted) */
    message: 'upsert refused: 45 TND',
    exception: { values: [{ type: 'TypeError', value: `bad amount 12500 for a@b.tn ${JWT}` }] },
    user: { id: 'u1', email: 'sofien@exemple.tn', ip_address: '10.0.0.1' },
    request: {
      url: 'https://stouchi.tn/#/pot/needs?q=Carrefour',
      data: { text: '50 courses hier', label: 'Carrefour' },
      headers: { Authorization: `Bearer ${JWT}`, 'User-Agent': 'iPhone' },
      cookies: 'sb=1',
    },
    breadcrumbs: [
      { category: 'ui.click', message: 'button.Carrefour 45', data: { label: 'Carrefour' } },
      { category: 'console', message: 'chat: 50 courses hier' },
    ],
    extra: { row: { label: 'Carrefour', amount_mil: 45_000 } },
    contexts: { app: { app_start_time: 'x' } },
    tags: { kind: 'upsert' },
  });

  it('leaves no amount, label, e-mail, chat text or JWT anywhere', () => {
    const out = JSON.stringify(scrub(crafted()));
    for (const secret of [
      '45000',
      '12500',
      '45 TND',
      'sofien@',
      'a@b.tn',
      'eyJ',
      '50 courses',
      'Carrefour',
      '10.0.0.1',
    ])
      expect(out).not.toContain(secret);
  });

  it('keeps what explains the crash: the error type, the route and the tags', () => {
    const out = scrub(crafted());
    expect(out.exception?.values?.[0].type).toBe('TypeError');
    expect(out.request?.url).toBe('https://stouchi.tn/#/pot/needs');
    expect(out.tags).toEqual({ kind: 'upsert' });
    expect(out.user).toEqual({ id: 'u1' });
  });
});
