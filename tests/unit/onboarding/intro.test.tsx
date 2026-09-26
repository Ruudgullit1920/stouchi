// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readIntroSeen } from '../../../src/app/gate';
import { IntroScreen } from '../../../src/features/onboarding/IntroScreen';

const reduce = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q }));

beforeEach(() => {
  localStorage.clear();
  reduce(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const selected = () => screen.getAllByRole('tab').map((d) => d.getAttribute('aria-selected') === 'true');
const current = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('IntroScreen', () => {
  it('starts on the split slide with the first dot selected', () => {
    render(<IntroScreen onDone={() => undefined} />);
    expect(current()).toContain('réparti tout seul');
    expect(selected()).toEqual([true, false, false]);
  });

  it('moves on with the arrow and the dots, then hands over after the last slide', () => {
    const done = vi.fn();
    render(<IntroScreen onDone={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(selected()).toEqual([false, true, false]);
    expect(current()).toContain('Trois secondes');
    fireEvent.click(screen.getByRole('tab', { name: 'Écran 3' }));
    expect(selected()).toEqual([false, false, true]);
    expect(current()).toContain('se rapprocher');
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(done).toHaveBeenCalledOnce();
    expect(readIntroSeen()).toBe(true);
  });

  it('follows a swipe left and right', () => {
    render(<IntroScreen onDone={() => undefined} />);
    const slides = screen.getByTestId('slides');
    fireEvent.touchStart(slides, { changedTouches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(slides, { changedTouches: [{ clientX: 120, clientY: 110 }] });
    expect(selected()).toEqual([false, true, false]);
    fireEvent.touchStart(slides, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(slides, { changedTouches: [{ clientX: 280, clientY: 100 }] });
    expect(selected()).toEqual([true, false, false]);
  });

  it('skips straight to login with Passer', () => {
    const done = vi.fn();
    render(<IntroScreen onDone={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }));
    expect(done).toHaveBeenCalledOnce();
    expect(readIntroSeen()).toBe(true);
  });

  it('does not slide under reduced motion', () => {
    reduce(true);
    render(<IntroScreen onDone={() => undefined} />);
    expect(screen.getByTestId('slides').style.transition).toBe('none');
    cleanup();
    reduce(false);
    render(<IntroScreen onDone={() => undefined} />);
    expect(screen.getByTestId('slides').style.transition).toBe('');
  });
});
