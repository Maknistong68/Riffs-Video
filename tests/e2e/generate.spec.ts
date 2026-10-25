import { expect, test, type Page } from '@playwright/test';

test.setTimeout(600_000);

const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

async function openGenerate(page: Page) {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByTestId('open-generate').click();
  await expect(page.getByTestId('generate')).toBeVisible();
}

test('generate: riff of the day → shuffle a hard metal riff → Riff Review → Studio with the genre look → export in sync', async ({ page }, info) => {
  const errors = errorsOf(page);
  // Shuffle uses Math.random: make it repeatable so the exported riff is the same on every run.
  await page.addInitScript(() => {
    let a = 12345;
    Math.random = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
  });
  await openGenerate(page);
  await expect(page.getByTestId('gen-title')).toContainText('Riff of the day');
  await expect(page.getByTestId('gen-tab')).toContainText('e|-');
  await page.screenshot({ path: `test-results/${info.project.name}-generate.png`, fullPage: true });

  await page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Metal' }).click();
  await page.getByRole('radio', { name: 'Hard' }).click();
  await page.getByRole('radio', { name: '2 bars' }).click();
  await page.getByTestId('gen-shuffle').click();
  await expect(page.getByTestId('gen-title')).toContainText('Your riff');
  await expect(page.getByTestId('gen-preview')).toContainText('metal riff');
  await page.getByTestId('gen-use').click();

  await expect(page.getByTestId('review-summary')).toContainText('notes', { timeout: 30_000 });
  await expect(page.getByTestId('confirm-review')).toBeEnabled();
  await page.getByTestId('confirm-review').click();
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('radio', { name: 'Flat 2D' }).click();
  await page.getByRole('tab', { name: 'Sound' }).click();
  await expect(page.getByTestId('drum-controls').getByRole('radio', { name: 'Metal' })).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('open-export').click();
  await page.getByRole('radio', { name: '30 fps' }).click();
  await page.getByTestId('start-export').click();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 540_000 });
  console.log(`[${info.project.name}-generate] ${(await report.locator('strong').innerText()).trim()}`);
  await expect(report).toHaveAttribute('data-ok', 'true');
  expect(errors).toEqual([]);
});

test('generate with AI: the brief goes to the Edge Function, the checked answer lands in Riff Review as an original', async ({ page }) => {
  const errors = errorsOf(page);
  let sent: Record<string, unknown> | null = null;
  await page.route('**/functions/v1/convert-tab', async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        title: 'Sunset Run',
        alphaTex: '\\title "Sunset Run"\n\\tempo 92\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n:8 0.6 3.6 5.6 3.6 5.5 7.5 5.5 3.6 | :4 5.4 7.4{v} :2 5.5',
        notes: [],
        rhythmGuessed: false,
        tempoGuessed: false,
        warnings: [],
        model: 'claude-opus-5-5',
      }),
    });
  });
  await openGenerate(page);
  await page.getByRole('radio', { name: 'AI (Claude)' }).click();
  await page.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Blues' }).click();
  await page.getByTestId('gen-idea').fill('slow and sad, ends with vibrato');
  await page.getByTestId('gen-ai-go').click();
  await expect(page.getByTestId('ai-banner')).toContainText('original riff written by AI', { timeout: 30_000 });
  await expect(page.getByTestId('review-summary')).toContainText('11 notes');
  expect(sent).toMatchObject({ mode: 'generate', brief: { genre: 'blues', difficulty: 'medium', bars: 4, idea: 'slow and sad, ends with vibrato' } });
  expect(errors).toEqual([]);
});
