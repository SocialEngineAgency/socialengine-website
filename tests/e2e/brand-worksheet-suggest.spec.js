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

async function openBrand(page, handlers, data = clientData()) {
  await mockApi(page, srv.base, { data, onRequest: handlers });
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
  }, clientData({ brand_worksheet: { worksheet: { formality: 3, offerings: [{ name: 'Rye loaf', note: '' }] }, exists: true, complete: false } }));

  const panel = page.locator('#se-bw-suggest');
  await expect(panel).toContainText('Not sure what to write?');
  expect(posts, 'a worksheet with something in it is not read automatically').toBe(0);
  await expect(page.locator('[data-bw-list="avoid"]').last()).toHaveAttribute('autocomplete', 'off');
  for (const key of ['values', 'embrace', 'avoid']) await expect(page.locator(`[data-bw-list="${key}"]`), `five ${key} boxes`).toHaveCount(5);
  await expect(page.locator('#se-bw-adjectives')).toHaveAttribute('autocomplete', 'off');
  await panel.locator('#bws-run').click();
  await expect.poll(() => posts).toBe(1);
  await expect(panel).toContainText('Suggestions from your last 84 posts');
  await expect(panel).toContainText('high confidence');
  await expect(panel).toContainText('weighted to your best posts');

  const form = page.locator('#se-brand-worksheet');
  const adjSlot = form.locator('[data-bws-slot="adjectives"]');
  // Measure once the panel has settled (suggestions render in, then the grid
  // reflows); a single early measurement was flaky.
  const beside = async () => {
    const adjBox = await adjSlot.boundingBox();
    const adjInputBox = await page.locator('#se-bw-adjectives').boundingBox();
    if (!adjBox || !adjInputBox) return 'not laid out';
    if (!(adjBox.x > adjInputBox.x + adjInputBox.width - 1)) return 'not to the right';
    return Math.abs(adjBox.y - adjInputBox.y) < 60 ? 'beside' : `off by ${Math.round(adjBox.y - adjInputBox.y)}px`;
  };
  await expect.poll(beside, { timeout: 5000 }).toBe('beside');

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
  expect(saves[0]).toMatchObject({ formality: 4, values: ['Slow craft', 'Local sourcing'], embrace: ['come say hi'], avoid: ['game changer'], offerings: [{ name: 'Rye loaf', note: '' }] });
  expect(saves[0].brand, 'post suggestions carry no website colours').toBeUndefined();
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

const FROM_SITE = {
  generated_at: '2026-10-25T20:00:00Z',
  from_site: true,
  sources: ['website'],
  notes: [],
  site: { url: 'https://crumb.test', used: 'firecrawl', pages: [{ url: 'https://crumb.test', kind: 'home' }, { url: 'https://crumb.test/shop', kind: 'products' }] },
  summary: 'A neighbourly baker that sounds plain and proud.',
  formality: { value: 4, why: 'Short, friendly sentences.' },
  expectation_adjectives: { suggestions: ['warm', 'plain-spoken'], why: 'Talks like a neighbour.', quotes: ['Real bread, no shortcuts'] },
  values: { suggestions: [{ value: 'Local sourcing', why: 'Mill flour', quote: 'local flour from the mill' }] },
  embrace: { suggestions: [{ phrase: 'come say hi', why: 'Their own invitation', used: 1 }] },
  avoid: { suggestions: [{ phrase: 'game changer', why: 'Hype', used: 0 }] },
  offerings: [{ name: 'Seeded Rye Loaf', kind: 'product', note: 'Slow-fermented rye' }, { name: 'Wholesale Bread Boxes', kind: 'service', note: 'Daily delivery for cafes' }],
  brand: { colors: ['#c0392b', '#f5e6cc'], logo_url: 'https://crumb.test/logo.svg', fonts: ['Playfair Display'], source: 'firecrawl' },
  based_on: { pages: 2, confidence: 'low' },
};

test('a new account with an empty worksheet: it is read and filled from the website, kept colours and logo go out with Save', async ({ page }) => {
  let posts = 0;
  const saves = [];
  await page.route('https://crumb.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24"><rect width="80" height="24" fill="#c0392b"/></svg>' }));
  await openBrand(page, async (entry, route, json) => {
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'GET') { json(200, { suggestions: null }); return 'handled'; }
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'POST') { posts += 1; json(200, { suggestions: FROM_SITE }); return 'handled'; }
    if (entry.path === '/api/brand-worksheet' && entry.method === 'POST') {
      const body = JSON.parse(entry.body || '{}');
      saves.push(body);
      json(200, { success: true, worksheet: body, complete: true, library: { added: 2 } });
      return 'handled';
    }
    return undefined;
  });

  const panel = page.locator('#se-bw-suggest');
  await expect.poll(() => posts, { message: 'read once by itself' }).toBe(1);
  await expect(panel).toContainText('Suggestions from your website');
  await expect(panel).toContainText('crumb.test');
  await expect(panel).toContainText('read: home page, products');
  await expect(panel.locator('#bws-autofilled')).toContainText('Check each box, then press Save');
  await expect(panel.locator('#bws-run')).toHaveText('Read again');

  // Filled, not saved.
  await expect(page.locator('#se-bw-formality')).toHaveValue('4');
  await expect(page.locator('#se-bw-adjectives')).toHaveValue('warm, plain-spoken');
  await expect(page.locator('[data-bw-list="values"]').first()).toHaveValue('Local sourcing');
  await expect(page.locator('[data-bw-list="embrace"]').first()).toHaveValue('come say hi');
  await expect(page.locator('[data-bw-offer-name]')).toHaveCount(2);
  await expect(page.locator('[data-bw-offer-name]').first()).toHaveValue('Seeded Rye Loaf');
  await expect(page.locator('[data-bw-offer-note]').nth(1)).toHaveValue('Daily delivery for cafes');
  await expect(page.locator('#se-bw-save')).toHaveText('Save changes');
  expect(saves.length).toBe(0);
  const form = page.locator('#se-brand-worksheet');
  await expect(form.locator('[data-bws-slot="embrace"] .bws-chip')).not.toContainText('×');
  await expect(form.locator('[data-bws-slot="offerings"] .bws-chip')).toHaveCount(2);
  await expect(form.locator('[data-bws-offer="0"]')).toBeDisabled();

  // Colours and logo: drop the one that is not theirs.
  const brand = page.locator('#se-bw-brand');
  await expect(brand).toBeVisible();
  await expect(brand.locator('.bws-swatch')).toHaveCount(2);
  await expect(brand.locator('.bws-logo img')).toHaveAttribute('src', 'https://crumb.test/logo.svg');
  await brand.locator('[data-bws-drop="#f5e6cc"]').click();
  await expect(brand.locator('.bws-swatch')).toHaveCount(1);
  await expect(brand).toContainText('added to your Library when you press Save');

  // Edit one product, remove the other, add one by hand.
  await page.locator('[data-bw-offer-note]').first().fill('Our seeded rye');
  await page.locator('[data-bw-offer-remove]').nth(1).click();
  await page.click('#se-bw-offer-add');
  await page.locator('[data-bw-offer-name]').nth(1).fill('Saturday market stall');

  await page.click('#se-bw-save');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({
    formality: 4,
    values: ['Local sourcing'],
    embrace: ['come say hi'],
    offerings: [{ name: 'Seeded Rye Loaf', note: 'Our seeded rye' }, { name: 'Saturday market stall', note: '' }],
    brand: { colors: ['#c0392b'], logo_url: 'https://crumb.test/logo.svg' },
  });
  await expect(page.locator('#se-bw-save')).toHaveText('Save');
  await expect(panel.locator('#bws-autofilled')).toHaveCount(0);
});

test('cached website suggestions on a worksheet that has answers: nothing is overwritten, products are one click each', async ({ page }) => {
  let posts = 0;
  await page.route('https://crumb.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  await openBrand(page, async (entry, route, json) => {
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'GET') { json(200, { suggestions: FROM_SITE }); return 'handled'; }
    if (entry.path === '/api/brand-worksheet/suggestions' && entry.method === 'POST') { posts += 1; json(200, { suggestions: FROM_SITE }); return 'handled'; }
    return undefined;
  }, clientData({ brand_worksheet: { worksheet: { formality: 2, expectation_adjectives: ['precise'], values: ['Quality'], embrace: [], avoid: [], offerings: [] }, exists: true, complete: false } }));

  const panel = page.locator('#se-bw-suggest');
  await expect(panel).toContainText('Suggestions from your website');
  await expect(panel.locator('#bws-autofilled')).toHaveCount(0);
  await expect(page.locator('#se-bw-adjectives')).toHaveValue('precise');
  await expect(page.locator('#se-bw-formality')).toHaveValue('2');
  expect(posts).toBe(0);

  const chips = page.locator('#se-brand-worksheet [data-bws-slot="offerings"] .bws-chip');
  await expect(chips).toHaveCount(2);
  await chips.nth(1).click();
  await expect(page.locator('[data-bw-offer-name]')).toHaveCount(1);
  await expect(page.locator('[data-bw-offer-name]').first()).toHaveValue('Wholesale Bread Boxes');
  await expect(chips.nth(1)).toBeDisabled();
  await expect(page.locator('#se-bw-save')).toHaveText('Save changes');
});
