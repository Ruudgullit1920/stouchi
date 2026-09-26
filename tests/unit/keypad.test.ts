import { describe, expect, it } from 'vitest';
import { keypadMil, pressKey, typeAll } from '../../src/shared/keypad';

describe('pressKey', () => {
  it('builds an amount digit by digit', () => {
    expect(typeAll('125')).toBe('125');
  });

  it('replaces a lone leading zero, but keeps 0 before a comma', () => {
    expect(typeAll('05')).toBe('5');
    expect(typeAll('00')).toBe('0');
    expect(typeAll('0,5')).toBe('0,5');
  });

  it('starts "0," when the comma comes first, and takes one comma only', () => {
    expect(typeAll(',5')).toBe('0,5');
    expect(typeAll('12,,5,')).toBe('12,5');
  });

  it('stops at three decimals (millimes)', () => {
    expect(typeAll('1,2345')).toBe('1,234');
  });

  it('deletes the last key, down to empty', () => {
    expect(pressKey('12,5', 'del')).toBe('12,');
    expect(pressKey('1', 'del')).toBe('');
    expect(pressKey('', 'del')).toBe('');
  });

  it('refuses a key that would go past 1 000 000 TND', () => {
    expect(typeAll('1000000')).toBe('1000000');
    expect(pressKey('1000000', '0')).toBe('1000000');
    expect(pressKey('1000000', ',')).toBe('1000000,');
    expect(pressKey('1000000,', '5')).toBe('1000000,');
  });
});

describe('keypadMil', () => {
  it('reads the typed amount in millimes, a trailing comma included', () => {
    expect(keypadMil('12,5')).toBe(12_500);
    expect(keypadMil('12,')).toBe(12_000);
    expect(keypadMil('')).toBe(0);
  });
});
