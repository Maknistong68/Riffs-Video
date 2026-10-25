import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const golden = (f: string) => readFileSync(join(import.meta.dirname, '../golden/riffs', f), 'utf8');
test.setTimeout(400_000);

async function exportAndCheck(page: Page, fps: 30 | 60, shot: string) {
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.screenshot({ path: `test-results/${shot}-studio.png` });
  await page.getByTestId('open-export').click();
  await page.getByRole('radio', { name: `${fps} fps` }).click();
  await page.getByTestId('start-export').click();
  await expect(page.getByTestId('rendering')).toBeVisible();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 360_000 });
  await page.screenshot({ path: `test-results/${shot}-result.png`, fullPage: true });
  console.log(`[${shot}] ${(await report.locator('strong').innerText()).trim()}`);
  await expect(report).toHaveAttribute('data-ok', 'true');
  const meta = await page.getByTestId('player').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<{ w: number; h: number; d: number }>((resolve) => {
        const done = () => resolve({ w: v.videoWidth, h: v.videoHeight, d: v.duration });
        if (v.readyState >= 1) done();
        else v.addEventListener('loadedmetadata', done, { once: true });
      }),
  );
  expect([meta.w, meta.h]).toEqual([1080, 1920]);
  return meta;
}

test('write → review (edit a note) → studio (Close-up + slow-mo) → export → Sync Report ✅', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.riff-card')).toHaveCount(3); // demo riffs seeded
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /Write riff/ }).click();
  await page.getByTestId('alphatex').fill(':4 0.6{nope}');
  await expect(page.getByTestId('tex-errors')).toContainText('Line 1');
  await page.getByTestId('alphatex').fill(golden('01-pentatonic-run.atex'));
  await expect(page.getByTestId('save-riff')).toBeEnabled();
  await page.getByTestId('save-riff').click();

  // Riff Review: the gate. Edit the 3rd note (fret 0 on A → fret 2) and check the tab updates.
  await expect(page.getByTestId('review-summary')).toContainText('13 notes');
  await page.screenshot({ path: `test-results/${info.project.name}-review.png` });
  await page.getByRole('button', { name: 'Bar 1, string 5, fret 0' }).click();
  await page.getByRole('button', { name: 'Fret up' }).click();
  await page.getByRole('button', { name: 'Fret up' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Bar 1, string 5, fret 2' }).first()).toBeVisible();
  await page.getByTestId('confirm-review').click();

  // Studio: Close-up layout + slow-mo passes. Flat 2D keeps this long export quick on GPU-less CI
  // (3D export has its own test in tone3d.spec.ts).
  await page.getByRole('radio', { name: 'Flat 2D' }).click();
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.getByRole('button', { name: 'Close-up' }).click();
  await page.getByRole('tab', { name: 'Teach' }).click();
  await page.getByTestId('teach-slowmo').check();
  const meta = await exportAndCheck(page, 30, `${info.project.name}-write`);
  expect(meta.d).toBeGreaterThan(15); // 50% + 75% + 100% passes

  await page.goto('/#/exports');
  await expect(page.locator('.export-tile')).toHaveCount(1);
  await expect(page.locator('.export-tile')).toContainText('In sync');
});

test('open Guitar Pro 5 → review → Split, Les Paul, left-handed → export 60 fps → Sync Report ✅', async ({ page }, info) => {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByTestId('file-input').setInputFiles(join(import.meta.dirname, '../fixtures/alphatab/hammer.gp5'));
  await expect(page.getByTestId('review-summary')).toContainText('notes');
  await page.getByTestId('confirm-review').click();
  await page.getByLabel('Guitar skin').selectOption('lespaul');
  await page.getByText('Left-handed (mirror the neck)').click();
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.getByRole('button', { name: 'Split' }).click();
  await exportAndCheck(page, 60, `${info.project.name}-gp5`);
});
