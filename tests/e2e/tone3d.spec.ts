import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const golden = (f: string) => readFileSync(join(import.meta.dirname, '../golden/riffs', f), 'utf8');
test.setTimeout(600_000);

async function writeRiff(page: Page, file: string) {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /Write riff/ }).click();
  await page.getByTestId('alphatex').fill(golden(file));
  await expect(page.getByTestId('save-riff')).toBeEnabled();
  await page.getByTestId('save-riff').click();
  await page.getByTestId('confirm-review').click();
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
}

const previewPixels = (page: Page) =>
  page.getByTestId('preview').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 500, c.width, 500).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) >>> 0;
    return h;
  });

test('3D guitar: drag to turn, camera presets, Rock tone with pedals → export → Sync Report ✅', async ({ page }, info) => {
  await writeRiff(page, '02-chords.atex');
  const shot = (name: string) => page.screenshot({ path: `test-results/${info.project.name}-${name}.png` });

  // 3D is the default view; the wood of the 3D board appears once three.js has loaded.
  await expect(page.getByRole('radio', { name: '3D guitar' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Scrub').fill('60');
  await expect.poll(() => previewPixels(page), { timeout: 30_000 }).not.toBe(0);
  await shot('studio-3d');
  const before = await previewPixels(page);

  // Drag across the preview: the guitar turns.
  const box = (await page.getByTestId('preview').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => previewPixels(page)).not.toBe(before);
  await shot('studio-3d-dragged');

  await page.getByRole('radio', { name: "Player's view" }).click();
  await expect(page.getByRole('radio', { name: "Player's view" })).toHaveAttribute('aria-checked', 'true');
  await shot('studio-3d-player');

  // Sound: Rock preset = drive (distortion) + amp + reverb; then add a delay pedal.
  await page.getByRole('tab', { name: 'Sound' }).click();
  await page.getByRole('radio', { name: 'Rock' }).click();
  await expect(page.getByTestId('pedal-drive')).toHaveClass(/on/);
  await page.getByRole('button', { name: 'Delay off' }).click();
  await expect(page.getByTestId('pedal-delay')).toHaveClass(/on/);
  await expect(page.getByLabel('Delay Time')).toBeVisible();
  await page.getByTestId('tone-controls').screenshot({ path: `test-results/${info.project.name}-pedalboard.png` });

  await page.getByTestId('open-export').click();
  await page.getByRole('radio', { name: '30 fps' }).click();
  await page.getByTestId('start-export').click();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 540_000 });
  await page.screenshot({ path: `test-results/${info.project.name}-tone3d-result.png`, fullPage: true });
  console.log(`[${info.project.name}-tone3d] ${(await report.locator('strong').innerText()).trim()}`);
  await expect(report).toHaveAttribute('data-ok', 'true');
});
