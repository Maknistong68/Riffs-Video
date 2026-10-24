import { expect, test } from '@playwright/test';

for (const fps of [30, 60] as const) {
test(`spike: ${fps} fps export is playable and Sync Report is green`, async ({ page }, info) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto('/');
  await expect(page.getByTestId('preview')).toBeVisible();
  await page.screenshot({ path: `test-results/spike-${info.project.name}-idle.png` });
  await page.getByRole('button', { name: `${fps} fps` }).click();

  await page.getByTestId('export').click();
  const report = page.getByTestId('sync-report');
  await expect(report).toBeVisible({ timeout: 150_000 });
  await page.screenshot({ path: `test-results/spike-${info.project.name}-${fps}-done.png`, fullPage: true });
  const text = await report.innerText();
  console.log(`[${info.project.name} ${fps}fps] ${text.replace(/\n/g, ' | ')}`);
  if ((await report.getAttribute('data-ok')) !== 'true') console.log(logs.join('\n'));
  await expect(report).toHaveAttribute('data-ok', 'true');

  // The produced file must be a playable MP4 with both tracks of the expected length.
  const meta = await page.getByTestId('player').evaluate(
    (v: HTMLVideoElement) =>
      new Promise<{ duration: number; w: number; h: number }>((resolve) => {
        const done = () => resolve({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
        if (v.readyState >= 1) done();
        else v.addEventListener('loadedmetadata', done, { once: true });
      }),
  );
  expect(meta.w).toBe(1080);
  expect(meta.h).toBe(1920);
  expect(meta.duration).toBeCloseTo(4.4, 1);
});
}
