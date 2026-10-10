// Brand worksheet suggestions panel (Settings → Brand). Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const SUGGESTIONS = {
  generated_at: '2026-10-09T20:00:00Z',
  sources: ['instagram'],
  notes: [],
  summary: 'Warm, neighbourly baker voice. Best posts invite people in person.',
  formality: { value: 4, why: 'Lots of contractions and exclamation marks.' },
  expectation_adjectives: { suggestions: ['warm', 'neighbourly', 'honest'], why: 'Talks to locals like friends.', quotes: ['real bread, no shortcuts'] },
  values: { suggestions: [
    { value: 'Local sourcing', why: 'Local flour comes up often.', quote: 'We bake with local flour' },
    { value: 'Slow craft', why: 'Long ferments.', quote: 'Long ferment, slow mornings' },
  ] },
  embrace: { suggestions: [{ phrase: 'come say hi', why: 'Signature sign-off.', used: 12 }] },
  avoid: { suggestions: [{ phrase: 'game changer', why: 'Generic hype.', used: 0 }] },
  stats: { posts: 84, avg_caption_chars: 140, emoji_per_post: 1.2, question_share: 0.3, hashtags_per_post: 4 },
  based_on: { posts: 84, from: '2025-10-12', to: '2026-10-05', engagement_weighted: true, confidence: 'high' },
};

async function openBrand(page, handlers) {
  await mockApi(page, srv.base, { data: clientData(), onRequest: handlers });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="settings"]');
  await page.click('.settings-tab[data-settings-tab="brand"]');
  await expect(page.locator('#se-brand-worksheet')).toBeVisible();
}

test('Analyse → suggestions beside the questions → Use fills the form → Save sends it', async ({ page }) => {
  let posts = 0;
  const saves = [];
  await openBrand(page, async (entry, route, json) => {
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'GET') { json(200, { suggestions: null }); return 'handled'; }
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'POST') { posts += 1; json(200, { suggestions: SUGGESTIONS }); return 'handled'; }
    if (entry.path === '/api/brand-worksheet' && entry.method === 'POST') {
      const body = JSON.parse(entry.body || '{}');
      saves.push(body);
      json(200, { success: true, worksheet: body, complete: true });
      return 'handled';
    }
    return undefined;
  });

  const panel = page.locator('#se-bw-suggest');
  await expect(panel).toContainText('Not sure what to write?');
  await expect(page.locator('[data-bw-list="avoid"]').last()).toHaveAttribute('autocomplete', 'off');
  await expect(page.locator('#se-bw-adjectives')).toHaveAttribute('autocomplete', 'off');
  await panel.locator('#bws-run').click();
  await expect.poll(() => posts).toBe(1);
  await expect(panel).toContainText('Suggestions from your last 84 posts');
  await expect(panel).toContainText('high confidence');
  await expect(panel).toContainText('weighted to your best posts');

  const form = page.locator('#se-brand-worksheet');
  const adjSlot = form.locator('[data-bws-slot="adjectives"]');
  const adjBox = await adjSlot.boundingBox();
  const adjInputBox = await page.locator('#se-bw-adjectives').boundingBox();
  expect(adjBox.x).toBeGreaterThan(adjInputBox.x + adjInputBox.width - 1);
  expect(Math.abs(adjBox.y - adjInputBox.y)).toBeLessThan(60);

  const quote = adjSlot.locator('.bws-why li', { hasText: 'real bread, no shortcuts' });
  await expect(quote).toBeHidden();
  await adjSlot.locator('.bws-why summary').click();
  await expect(quote).toBeVisible();
  await expect(form.locator('[data-bws-slot="embrace"] .bws-chip')).toContainText('12×');

  await form.locator('[data-bws-formality]').click();
  await expect(page.locator('#se-bw-formality')).toHaveValue('4');
  await expect(page.locator('#se-bw-formality-val')).toHaveText('Mostly casual');
  await expect(form.locator('[data-bws-formality]')).toBeDisabled();

  await form.locator('[data-bws-adj="warm"]').click();
  await expect(page.locator('#se-bw-adjectives')).toHaveValue('warm');
  await expect(form.locator('[data-bws-adj="warm"]')).toBeDisabled();

  await form.locator('[data-bws-value="1"]').click();
  await expect(page.locator('[data-bw-list="values"]').first()).toHaveValue('Slow craft');

  await panel.locator('#bws-fill').click();
  await expect(page.locator('[data-bw-list="values"]').nth(1)).toHaveValue('Local sourcing');
  await expect(page.locator('[data-bw-list="embrace"]').first()).toHaveValue('come say hi');
  await expect(page.locator('[data-bw-list="avoid"]').first()).toHaveValue('game changer');
  await expect(page.locator('#se-bw-adjectives')).toHaveValue('warm');
  await expect(page.locator('#se-bw-save')).toHaveText('Save changes');

  await page.click('#se-bw-save');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({ formality: 4, values: ['Slow craft', 'Local sourcing'], embrace: ['come say hi'], avoid: ['game changer'] });
  await expect(page.locator('#se-bw-save')).toHaveText('Save');
});

test('cached suggestions load on open; too-few-posts shows the honest message', async ({ page }) => {
  await openBrand(page, async (entry, route, json) => {
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'GET') {
      json(200, { suggestions: { empty: true, based_on: { posts: 1 }, message: 'Only 1 post with captions in the last year — not enough to read your voice yet.', notes: ['No Instagram history was readable — connect Instagram in Settings for a fuller analysis.'] } });
      return 'handled';
    }
    return undefined;
  });
  const panel = page.locator('#se-bw-suggest');
  await expect(panel).toContainText('Only 1 post');
  await expect(panel).toContainText('connect Instagram');
  await expect(panel.locator('#bws-run')).toHaveText('Try again');
});
