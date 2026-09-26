// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { ShoppingCart } from 'lucide-preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Amount } from '../../../src/design/components/Amount';
import { Button } from '../../../src/design/components/Button';
import { LedgerRow } from '../../../src/design/components/LedgerRow';
import { Pill } from '../../../src/design/components/Pill';
import { SegmentedBar } from '../../../src/design/components/SegmentedBar';

afterEach(cleanup);
const NB = ' ';

describe('Button', () => {
  it('clicks, and does nothing when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Enregistrer</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    rerender(
      <Button onClick={onClick} disabled>
        Enregistrer
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

describe('Pill', () => {
  it('exposes its state with aria-pressed', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Pill label="Envies" pressed={false} onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Envies' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<Pill label="Envies" pressed onToggle={onToggle} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Amount', () => {
  it('formats millimes with a non-breaking unit and a real minus', () => {
    const { container, rerender } = render(<Amount mil={1_200_000} />);
    expect(container.textContent).toMatch(/^1[  ]200 TND$/);
    rerender(<Amount mil={-32_500} />);
    expect(container.textContent).toBe(`−32,5${NB}TND`);
  });
});

describe('LedgerRow', () => {
  it('is one button named by its title, subtitle and amount', () => {
    const onClick = vi.fn();
    render(
      <LedgerRow
        icon={ShoppingCart}
        tint="var(--need)"
        title="Carrefour"
        subtitle="Courses"
        mil={-32_500}
        onClick={onClick}
      />,
    );
    const row = screen.getByRole('button', { name: /Carrefour.*Courses.*32,5/ });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('SegmentedBar', () => {
  const pots = [
    { label: 'Besoins', mil: 1_250_000, color: 'var(--need)' },
    { label: 'Envies', mil: 750_000, color: 'var(--want)' },
    { label: 'Épargne', mil: 500_000, color: 'var(--save)' },
  ];

  it('says in words what the colours show', () => {
    render(<SegmentedBar segments={pots} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Besoins 50${NB}%, Envies 30${NB}%, Épargne 20${NB}%`,
    );
  });

  it('an empty bar has no NaN widths', () => {
    const { container } = render(<SegmentedBar segments={pots.map((p) => ({ ...p, mil: 0 }))} />);
    expect(container.querySelectorAll('.segbar__seg')).toHaveLength(0);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Besoins 0${NB}%, Envies 0${NB}%, Épargne 0${NB}%`,
    );
  });
});
