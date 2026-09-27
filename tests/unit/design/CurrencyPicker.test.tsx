// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurrencyPicker } from '../../../src/design/components/CurrencyPicker';
import type { CurrencyCode } from '../../../src/shared/currencies';

afterEach(cleanup);

function Picker({
  start = 'EUR',
  onChange = () => undefined,
}: {
  start?: CurrencyCode;
  onChange?: (c: CurrencyCode) => void;
}) {
  const [value, setValue] = useState<CurrencyCode>(start);
  return (
    <CurrencyPicker
      label="Ta devise"
      value={value}
      suggested="EUR"
      onChange={(c) => {
        setValue(c);
        onChange(c);
      }}
    />
  );
}
const radios = () => screen.getAllByRole('radio');

describe('CurrencyPicker', () => {
  it('lists the nine currencies, the suggested one first with its tag', () => {
    render(<Picker />);
    expect(screen.getByRole('radiogroup', { name: 'Ta devise' })).toBeTruthy();
    expect(radios()).toHaveLength(9);
    expect(radios()[0].textContent).toContain('Euro');
    expect(radios()[0].textContent).toContain('Suggérée');
    expect(radios()[0].textContent).toContain('€ · EUR');
    expect(radios()[1].textContent).toContain('Dinar tunisien');
    expect(radios().filter((r) => r.textContent?.includes('Suggérée'))).toHaveLength(1);
  });

  it('marks the chosen row, and only it is tabbable', () => {
    render(<Picker />);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      ...Array<string>(8).fill('false'),
    ]);
    expect(radios().map((r) => r.tabIndex)).toEqual([0, ...Array<number>(8).fill(-1)]);
  });

  it('decorates each row with its round flag, which says nothing to a screen reader', () => {
    const { container } = render(<Picker />);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs).toHaveLength(9);
    expect(imgs.every((i) => i.getAttribute('alt') === '')).toBe(true);
  });

  it('moves and selects with the arrow keys, wrapping around', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.keyDown(radios()[0], { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('TND');
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios()[1]);
    fireEvent.keyDown(radios()[1], { key: 'ArrowUp' });
    fireEvent.keyDown(radios()[0], { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('LYD');
  });

  it('selects on tap', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Dirham marocain/ }));
    expect(onChange).toHaveBeenCalledWith('MAD');
  });

  it('shows a live example in the chosen currency', () => {
    render(<Picker />);
    const example = () => document.querySelector('.cur-example')?.textContent?.replace(/\s/g, ' ');
    expect(example()).toBe('Exemple : 1 250,50 €');
    fireEvent.click(screen.getByRole('radio', { name: /Dinar tunisien/ }));
    expect(example()).toBe('Exemple : 1 250,5 TND');
  });
});
