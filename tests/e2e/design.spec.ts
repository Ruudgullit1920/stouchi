import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function blockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/gallery');
  await expect(page.getByRole('heading', { level: 1, name: 'Composants' })).toBeVisible();
});

test('no serious or critical accessibility violations', async ({ page }) => {
  expect(await blockingViolations(page)).toEqual([]);
});

test('no serious or critical violations with the sheet open and a toast showing', async ({ page }) => {
  await page.getByRole('button', { name: 'Afficher un toast' }).click();
  await page.getByRole('button', { name: 'Ouvrir la feuille' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('every visible button is at least 44 × 44 px', async ({ page }) => {
  const small = await page.locator('button:visible').evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '', w: r.width, h: r.height };
      })
      .filter((b) => b.w < 44 || b.h < 44),
  );
  expect(small).toEqual([]);
});

test('buttons inside the sheet and the toast are at least 44 × 44 px', async ({ page }) => {
  await page.getByRole('button', { name: 'Afficher un toast' }).click();
  await page.getByRole('button', { name: 'Ouvrir la feuille' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const small = await page.locator('button:visible').evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '', w: r.width, h: r.height };
      })
      .filter((b) => b.w < 44 || b.h < 44),
  );
  expect(small).toEqual([]);
});

test('the sheet takes focus, closes on Escape and gives focus back', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Ouvrir la feuille' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Détail de la dépense' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('a toast is announced and offers Annuler', async ({ page }) => {
  await page.getByRole('button', { name: 'Afficher un toast' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Dépense supprimée.' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Annuler' })).toBeVisible();
});

test('pills expose their state', async ({ page }) => {
  const envies = page.getByRole('button', { name: 'Envies', exact: true });
  await expect(envies).toHaveAttribute('aria-pressed', 'false');
  await envies.click();
  await expect(envies).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion turns animations off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const name = await page
    .locator('.segbar__seg')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe('none');
});
