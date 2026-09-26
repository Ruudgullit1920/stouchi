// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UpdateToast } from '../../../src/app/UpdateToast';
import { sheet } from '../../../src/app/ui';
import { updateReady, watchUpdates } from '../../../src/app/update';

const waitingReg = () => {
  const posted: unknown[] = [];
  const worker = {
    state: 'installed',
    postMessage: (m: unknown) => posted.push(m),
    addEventListener: () => {},
  };
  return { posted, reg: { waiting: worker, installing: null, addEventListener: () => {} } };
};

beforeEach(() => {
  updateReady.value = false;
  sheet.value = null;
});
afterEach(cleanup);

describe('UpdateToast', () => {
  it('says nothing while there is no new version', () => {
    render(<UpdateToast />);
    expect(screen.queryByText('Nouvelle version')).toBeNull();
  });

  it('offers Recharger, and the tap tells the waiting worker to take over', () => {
    const { posted, reg } = waitingReg();
    watchUpdates(reg, { controller: {}, addEventListener: () => {} }, () => {});
    render(<UpdateToast />);
    expect(screen.getByText('Nouvelle version')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('waits while a sheet is open, so a reload never drops what is being typed', () => {
    updateReady.value = true;
    sheet.value = { title: 'Ajouter', body: null };
    render(<UpdateToast />);
    expect(screen.queryByText('Nouvelle version')).toBeNull();
  });
});
