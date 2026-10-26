import { expect, test, type Page } from '@playwright/test';

test.setTimeout(600_000);

const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

async function openDemo(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  // Flat 2D keeps exports quick on GPU-less CI (3D export is covered in tone3d.spec.ts).
  await page.getByRole('radio', { name: 'Flat 2D' }).click();
}

async function exportAndCheck(page: Page, shot: string) {
  await page.getByTestId('open-export').click();
  await page.getByRole('radio', { name: '30 fps' }).click();
  await page.getByTestId('start-export').click();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 540_000 });
  await page.screenshot({ path: `test-results/${shot}-result.png`, fullPage: true });
  console.log(`[${shot}] ${(await report.locator('strong').innerText()).trim()}`);
  await expect(report).toHaveAttribute('data-ok', 'true');
}

test('genre (Metal: theme + tone + drums), Guess opener, heatmap and Follow card → export in sync, with caption', async ({ page }, info) => {
  const errors = errorsOf(page);
  await openDemo(page, 'Power Drive');
  await page.getByRole('tab', { name: 'Layout' }).click();
  await page.getByTestId('genre-controls').getByRole('button', { name: 'Metal' }).click();
  await page.getByTestId('heatmap').check();
  await page.getByRole('tab', { name: 'Sound' }).click();
  await expect(page.getByTestId('drum-controls').getByRole('radio', { name: 'Metal' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('tab', { name: 'Text' }).click();
  await page.getByRole('radio', { name: 'Guess the song?' }).click();
  await page.getByTestId('endcard-controls').getByRole('radio', { name: 'Follow' }).click();
  await page.getByTestId('series-on').check();
  await expect(page.getByTestId('series-number')).toHaveValue('1');
  await page.getByLabel('Scrub').fill('20');
  await page.screenshot({ path: `test-results/${info.project.name}-p6-opener.png` });
  await exportAndCheck(page, `${info.project.name}-p6-metal`);
  await expect(page.getByTestId('caption-card')).toContainText('#metalguitar');
  await expect(page.getByTestId('caption-text')).toContainText('Power Drive');
  await expect(page.getByTestId('caption-text')).toContainText('RIFF #1');
  await expect(page.getByTestId('caption-text')).toContainText('What BPM can you play it at?');
  expect(errors).toEqual([]);
});

test('hook-first + same riff in 3 positions → export in sync', async ({ page }, info) => {
  const errors = errorsOf(page);
  await openDemo(page, 'Midnight Pentatonic');
  await page.getByRole('tab', { name: 'Teach' }).click();
  await page.getByTestId('teach-hook').check();
  await page.getByTestId('teach-positions').check();
  // Wait for the longer arrangement (hook + 3 positions) to reach the preview, then look inside it.
  await expect.poll(async () => Number(await page.getByLabel('Scrub').getAttribute('max')), { timeout: 60_000 }).toBeGreaterThan(450);
  await page.getByLabel('Scrub').fill('400');
  await page.screenshot({ path: `test-results/${info.project.name}-p6-positions.png` });
  await exportAndCheck(page, `${info.project.name}-p6-positions`);
  expect(errors).toEqual([]);
});

test('practice link: copy from Studio → open → play slower, loop → save to library', async ({ page, context }, info) => {
  const errors = errorsOf(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDemo(page, 'Slow Bend Blues');
  await page.getByRole('tab', { name: 'Text' }).click();
  await page.getByTestId('studio-practice-link').click();
  await expect(page.getByTestId('practice-link-msg')).toContainText('copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#\/p\/[A-Za-z0-9_-]+$/);

  await page.goto(link);
  await expect(page.getByTestId('practice')).toBeVisible();
  await expect(page.getByTestId('practice-play')).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('radio', { name: '50%' }).click();
  await page.getByTestId('practice-play').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-practice.png` });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('practice-save').click();
  await expect(page.getByTestId('review-summary')).toContainText('notes', { timeout: 30_000 });

  await page.goto(link.replace(/#\/p\/.*/, '#/p/damaged-link-123'));
  await expect(page.getByTestId('practice-bad')).toBeVisible();
  expect(errors).toEqual([]);
});

test('batch queue: two riffs from the library menu export one after the other; split into parts queues Part videos', async ({ page }, info) => {
  const errors = errorsOf(page);
  // Make both demos flat 2D (style is saved per riff), then queue them from the library menu.
  for (const title of ['Midnight Pentatonic', 'Power Drive']) {
    await openDemo(page, title);
    await page.waitForTimeout(500);
  }
  await page.goto('/');
  for (const title of ['Midnight Pentatonic', 'Power Drive']) {
    await page.getByRole('button', { name: `More actions for ${title}` }).click();
    await page.getByTestId('menu-queue').click();
  }
  await page.goto('/#/exports');
  await expect(page.getByTestId('queue-item')).toHaveCount(2);
  await page.getByTestId('queue-start').click();
  await expect(page.locator('[data-testid="queue-item"][data-status="done"]')).toHaveCount(2, { timeout: 540_000 });
  await expect(page.getByTestId('export-queue')).toContainText('in sync');
  await expect(page.locator('.export-tile')).toHaveCount(2);
  await page.screenshot({ path: `test-results/${info.project.name}-queue.png`, fullPage: true });

  // Split a riff into parts → part riffs with end cards land in the queue.
  await openDemo(page, 'Midnight Pentatonic');
  await page.getByRole('tab', { name: 'Teach' }).click();
  await page.getByLabel('Bars per part').fill('1');
  await page.getByTestId('split-go').click();
  await expect(page).toHaveURL(/#\/exports/);
  const waiting = page.locator('[data-testid="queue-item"][data-status="queued"]');
  await expect(waiting.first()).toContainText('(Part 1/');
  expect(await waiting.count()).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
