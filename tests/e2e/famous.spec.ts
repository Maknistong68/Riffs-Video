import { expect, test, type Page } from '@playwright/test';

test.setTimeout(600_000);

const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test('famous riffs: pick Mountain King as Guess the song → Studio with the metal look → classic sound pack → export in sync, public-domain caption', async ({ page }, info) => {
  const errors = errorsOf(page);
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByTestId('open-famous').click();
  await expect(page.getByTestId('famous')).toBeVisible();
  await expect(page.locator('button[data-testid^="famous-"]')).toHaveCount(20);
  await page.screenshot({ path: `test-results/${info.project.name}-famous.png`, fullPage: true });
  await page.getByRole('radio', { name: 'Hard' }).click();
  await expect(page.getByTestId('famous-bumblebee')).toBeVisible();
  await expect(page.getByTestId('famous-ode-to-joy')).toHaveCount(0);
  await page.getByRole('radio', { name: 'All' }).click();
  await page.getByTestId('famous-guess').check();
  await page.getByTestId('famous-mountain-king').click();

  // Straight to the Studio (checked riffs need no review), with the metal look and the opener.
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('radio', { name: 'Flat 2D' }).click();
  await page.getByRole('tab', { name: 'Sound' }).click();
  await expect(page.getByTestId('drum-controls').getByRole('radio', { name: 'Metal' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('sound-pack')).toHaveValue('fluid-guitars');
  await page.getByTestId('sound-pack').selectOption('sonivox');
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Text' }).click();
  await expect(page.getByRole('radio', { name: 'Guess the song?' })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `test-results/${info.project.name}-famous-studio.png` });

  // The choice is saved with the riff.
  await page.reload();
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Sound' }).click();
  await expect(page.getByTestId('sound-pack')).toHaveValue('sonivox');

  await page.getByTestId('open-export').click();
  await expect(page.getByText('can still be claimed')).toHaveCount(0); // public domain: no copyright warning
  await page.getByRole('radio', { name: '30 fps' }).click();
  await page.getByTestId('start-export').click();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 540_000 });
  console.log(`[${info.project.name}-famous] ${(await report.locator('strong').innerText()).trim()}`);
  await expect(report).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('caption-text')).toContainText('Edvard Grieg');
  await expect(page.getByTestId('caption-text')).toContainText('Public-domain melody');
  expect(errors).toEqual([]);
});
