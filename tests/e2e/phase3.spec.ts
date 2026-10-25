import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixtures = join(import.meta.dirname, '../fixtures');
test.setTimeout(400_000);

async function exportAndCheck(page: Page, shot: string, silent = false) {
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('open-export').click();
  if (silent) await page.getByRole('radio', { name: 'Silent' }).last().click();
  await page.getByTestId('start-export').click();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 300_000 });
  await page.screenshot({ path: `test-results/${shot}-result.png`, fullPage: true });
  console.log(`[${shot}] ${(await report.locator('strong').innerText()).trim()}`);
  await expect(report).toHaveAttribute('data-ok', 'true');
}

test('text tab pasted into Write riff → hint → Paste text tab keeps the text', async ({ page }, info) => {
  const tab = readFileSync(join(fixtures, 'ascii/05-techniques.txt'), 'utf8');
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /Write riff/ }).click();
  await page.getByTestId('alphatex').fill(tab);
  await expect(page.getByTestId('looks-like-ascii')).toBeVisible();
  await expect(page.getByTestId('tex-errors')).toHaveCount(0);
  await expect(page.getByTestId('save-riff')).toBeDisabled();
  await page.screenshot({ path: `test-results/${info.project.name}-write-ascii-hint.png` });
  await page.getByTestId('open-in-paste').click();
  await expect(page.getByTestId('ascii')).toHaveValue(tab);
  await expect(page.getByTestId('ascii-summary')).toContainText('7 notes');
  await page.screenshot({ path: `test-results/${info.project.name}-paste-from-write.png` });
});

test('paste ASCII tab → tap the rhythm → review → export ✅', async ({ page }, info) => {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /Paste text tab/ }).click();
  await page.getByTestId('ascii').fill(readFileSync(join(fixtures, 'ascii/05-techniques.txt'), 'utf8'));
  await expect(page.getByTestId('ascii-summary')).toContainText('7 notes');
  await page.getByTestId('save-ascii').click();
  await expect(page.getByTestId('rhythm-banner')).toContainText('Rhythm missing');
  await page.getByTestId('open-tap').click();
  // Tap the 7 notes as a quarter, two eighths, … (≈ 100 bpm).
  const pad = page.getByTestId('tap-pad');
  const box = (await pad.boundingBox())!;
  for (const gap of [600, 300, 300, 600, 300, 300, 0]) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    if (gap) await page.waitForTimeout(gap);
  }
  await expect(page.getByTestId('tap-result')).toContainText('bpm');
  await page.getByTestId('apply-rhythm').click();
  await expect(page.getByTestId('rhythm-banner')).toContainText('Rhythm from your taps');
  await page.screenshot({ path: `test-results/${info.project.name}-ascii-review.png` });
  await page.getByTestId('confirm-review').click();
  await exportAndCheck(page, `${info.project.name}-ascii`);
});

test('upload audio → transcription with confidence → review → export ✅', async ({ page }, info) => {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /Record or upload audio/ }).click();
  await page.getByTestId('audio-file').setInputFiles(join(fixtures, 'audio/midnight-pentatonic.wav'));
  await expect(page.getByTestId('review-summary')).toContainText('17 notes', { timeout: 180_000 });
  await expect(page.getByTestId('audio-banner')).toContainText('92 bpm');
  await page.getByTestId('confirm-review').click();
  await exportAndCheck(page, `${info.project.name}-audio`);
});

test('Silent mode with a reference recording → timing-only export ✅', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('.riff-card').first().click();
  await expect(page.getByTestId('preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Sound' }).click();
  await page.getByRole('radio', { name: 'Silent' }).click();
  await page.getByLabel('Tempo (bpm)').fill('104');
  await page.locator('[data-testid=silent-controls] input[type=file]').setInputFiles(join(fixtures, 'audio/midnight-pentatonic.wav'));
  await expect(page.getByLabel('Song position')).toBeVisible();
  await exportAndCheck(page, `${info.project.name}-silent`, true);
  await expect(page.getByTestId('silent-info')).toContainText('104 bpm');
  await expect(page.getByTestId('sync-report')).toContainText('timing-only');
});
