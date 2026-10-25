import { expect, test, type Page, type Route } from '@playwright/test';

// The Edge Function is mocked at the network layer: these tests check the app's handling of
// every kind of answer (the function itself is unit-tested in tests/unit/convertTab.test.ts).
const ENDPOINT = '**/functions/v1/convert-tab';
test.setTimeout(120_000);

const MESSY_TAB = `Song: Practice riff
e|-----------------|
B|-----------------|
G|-------------5h7-|   (play twice)
D|---------5h7-----|
A|-----5h7---------|
E|-5h8-------------|`;

const GOOD = {
  ok: true,
  title: 'Practice riff',
  alphaTex: '\\title "Practice riff"\n\\tempo 100\n\\track "Guitar"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n\\ro \\rc 2 :8 5.6{h} 8.6 5.5{h} 7.5 5.4{h} 7.4 5.3{h} 7.3',
  notes: [
    { bar: 0, beat: 0, string: 6, fret: 5, confidence: 0.95 },
    { bar: 0, beat: 1, string: 6, fret: 8, confidence: 0.92 },
    { bar: 0, beat: 2, string: 5, fret: 5, confidence: 0.9 },
    { bar: 0, beat: 3, string: 5, fret: 7, confidence: 0.9 },
    { bar: 0, beat: 4, string: 4, fret: 5, confidence: 0.55 },
    { bar: 0, beat: 5, string: 4, fret: 7, confidence: 0.9 },
    { bar: 0, beat: 6, string: 3, fret: 5, confidence: 0.9 },
    { bar: 0, beat: 7, string: 3, fret: 7, confidence: 0.9 },
  ],
  rhythmGuessed: true,
  tempoGuessed: true,
  warnings: ['Rhythm guessed from the spacing; the tab has none.'],
  model: 'claude-opus-5-5',
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function openAi(page: Page, text = MESSY_TAB) {
  await page.goto('/');
  await page.getByLabel('Create riff').click();
  await page.getByRole('button', { name: /AI import/ }).click();
  await page.getByTestId('ai-text').fill(text);
}

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => (route: Route) =>
  route.fulfill({ status, contentType: typeof body === 'string' ? 'text/html' : 'application/json', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('AI import → checked tab with amber confidence + guessed rhythm in Riff Review → Studio', async ({ page }, info) => {
  const errors = watchErrors(page);
  let sent: Record<string, unknown> | null = null;
  await page.route(ENDPOINT, async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    await reply(200, GOOD)(route);
  });
  await openAi(page);
  await page.screenshot({ path: `test-results/${info.project.name}-ai-import.png` });
  await page.getByTestId('ai-convert').click();

  await expect(page.getByTestId('ai-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ai-banner')).toContainText('1 note marked amber');
  await expect(page.getByTestId('ai-banner')).toContainText('rhythm was guessed');
  await expect(page.getByTestId('review-summary')).toContainText('8 notes');
  await page.screenshot({ path: `test-results/${info.project.name}-ai-review.png`, fullPage: true });
  expect(sent!.text).toBe(MESSY_TAB);
  expect(String(sent!.deviceId)).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByTestId('confirm-review').click();
  await expect(page.getByTestId('open-export')).toBeEnabled({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('malformed answer (HTML error page) lands in Riff Review with a clear message and ways on', async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.route(ENDPOINT, reply(200, '<html><body>Gateway hiccup</body></html>'));
  await openAi(page);
  await page.getByTestId('ai-convert').click();
  const card = page.getByTestId('ai-failed');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('unreadable');
  await expect(page.getByTestId('confirm-review')).toBeDisabled();
  await page.screenshot({ path: `test-results/${info.project.name}-ai-failed.png`, fullPage: true });

  await page.getByTestId('ai-as-paste').click();
  await expect(page.getByTestId('ascii')).toHaveValue(MESSY_TAB);
  await expect(page.getByTestId('ascii-summary')).toContainText('notes');
  expect(errors).toEqual([]);
});

test('AI tab with syntax errors → Riff Review shows alphaTab’s errors → fix by hand → normal review', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route(ENDPOINT, reply(200, { ...GOOD, alphaTex: GOOD.alphaTex.replace('5.6{h}', '5.6{h') }));
  await openAi(page);
  await page.getByTestId('ai-convert').click();
  const card = page.getByTestId('ai-failed');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/line|col/i);

  await page.getByTestId('ai-edit-tex').click();
  await expect(page.getByTestId('alphatex')).toHaveValue(/5\.6\{h 8\.6/);
  await page.getByTestId('alphatex').fill(GOOD.alphaTex);
  await expect(page.getByTestId('save-riff')).toBeEnabled();
  await page.getByTestId('save-riff').click();
  await expect(page.getByTestId('ai-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('confirm-review')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('model refusal / not a tab land in Riff Review; rate limit and offline stay on the form', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route(ENDPOINT, reply(422, { ok: false, error: { code: 'not_a_tab', message: 'No guitar tab found in that text.' } }));
  await openAi(page, 'Hello, please write me a poem.');
  await page.getByTestId('ai-convert').click();
  await expect(page.getByTestId('ai-failed')).toContainText('No guitar tab found', { timeout: 30_000 });
  await page.getByTestId('ai-retry').click();
  await expect(page.getByTestId('ai-text')).toHaveValue('Hello, please write me a poem.');

  await page.unroute(ENDPOINT);
  await page.route(ENDPOINT, reply(429, { ok: false, error: { code: 'rate_limited', message: 'Too many conversions. Try again in 10 min.', retryAfterSec: 600 } }, { 'Retry-After': '600' }));
  await page.getByTestId('ai-text').fill(MESSY_TAB);
  await page.getByTestId('ai-convert').click();
  await expect(page.getByTestId('ai-error')).toContainText('Too many conversions');
  await expect(page).toHaveURL(/#\/ai/);

  await page.context().setOffline(true);
  await expect(page.getByTestId('ai-offline')).toBeVisible();
  await expect(page.getByTestId('ai-convert')).toBeDisabled();
  await page.context().setOffline(false);
  expect(errors).toEqual([]);
});
