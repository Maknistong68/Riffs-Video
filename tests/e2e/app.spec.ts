import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const golden = (f: string) => readFileSync(join(import.meta.dirname, '../golden/riffs', f), 'utf8');

async function exportAndCheck(page: Page, fps: 30 | 60, shot: string) {
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  await page.screenshot({ path: `test-results/${shot}-studio.png` });
  await page.getByTestId('open-export').click();
  await page.getByRole('radio', { name: `${fps} fps` }).click();
  await page.getByTestId('start-export').click();
  await expect(page.getByTestId('rendering')).toBeVisible();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 200_000 });
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
  expect(meta.d).toBeGreaterThan(1);
}

test('write alphaTex → studio → export → Sync Report ✅', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.riff-card')).toHaveCount(3); // demo riffs seeded
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /Write riff/ }).click();
  await page.getByTestId('alphatex').fill(':4 0.6{nope}');
  await expect(page.getByTestId('tex-errors')).toContainText('Line 1');
  await page.getByTestId('alphatex').fill(golden('01-pentatonic-run.atex'));
  await expect(page.getByTestId('save-riff')).toBeEnabled();
  await page.getByTestId('save-riff').click();
  await exportAndCheck(page, 30, `${info.project.name}-write`);
  await page.goto('/#/exports');
  await expect(page.locator('.export-tile')).toHaveCount(1);
  await expect(page.locator('.export-tile')).toContainText('In sync');
});

test('open Guitar Pro 5 file → export at 60 fps → Sync Report ✅', async ({ page }, info) => {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByTestId('file-input').setInputFiles(join(import.meta.dirname, '../fixtures/alphatab/hammer.gp5'));
  await exportAndCheck(page, 60, `${info.project.name}-gp5`);
});
