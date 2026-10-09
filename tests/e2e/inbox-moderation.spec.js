// Inbox reply / moderation assist (P3.4): ranking tip, hidden-word flags, bait warnings, hidden-words modal. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const TIP = 'Replying helps: Meta shows posts with real back-and-forth conversation to more people.';
const GUIDE = (kw) => ({
  copy_text: kw.join(', '),
  instagram: ['Open Instagram → Settings and activity → Hidden Words.', 'Paste the list.'],
  facebook: ['Switch into your Facebook Page.', 'Paste the same list.'],
  note: 'Menu names change between app versions.',
});

function inbox(keywords) {
  const items = [
    { id: 'c1', type: 'comment', platform: 'instagram', username: 'ana', text: 'Is the vegan option back?', timestamp: new Date().toISOString(), has_reply: false, post_caption: 'New menu' },
    { id: 'c2', type: 'comment', platform: 'instagram', username: 'spammer', text: 'Earn crypto fast', timestamp: new Date().toISOString(), has_reply: false },
  ];
  if (keywords.includes('crypto')) items[1].hidden_match = 'crypto';
  return { connected: true, total: 2, unreplied: 2, mentions: 0, items, source: 'meta', auto_reply_enabled: false, auto_reply_mode: 'draft', ranking_tip: TIP };
}

test('Inbox shows the ranking tip, flags hidden words, warns on bait, and saves the hidden-words list', async ({ page }) => {
  let keywords = ['crypto'];
  const puts = [];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/inbox' && entry.method === 'GET') { json(200, inbox(keywords)); return 'handled'; }
      if (entry.path === '/api/inbox/canned-responses') { json(200, { canned: [] }); return 'handled'; }
      if (entry.path === '/api/inbox/generate-reply') {
        json(200, { success: true, suggested_reply: 'Comment YES and we will save you one!', bait_warnings: [{ kind: 'comment bait', match: 'Comment YES' }], hidden_match: null, ranking_tip: TIP });
        return 'handled';
      }
      if (entry.path === '/api/inbox/hide-keywords' && entry.method === 'GET') { json(200, { keywords, max: 100, guide: GUIDE(keywords) }); return 'handled'; }
      if (entry.path === '/api/inbox/hide-keywords' && entry.method === 'PUT') {
        const body = JSON.parse(entry.body || '{}');
        puts.push(body);
        keywords = String(body.keywords).split(/[,\n]/).map((k) => k.trim().toLowerCase()).filter(Boolean);
        json(200, { ok: true, keywords, max: 100, guide: GUIDE(keywords) });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="inbox"]');

  await expect(page.locator('#inbox-tip')).toContainText('Replying helps');
  await expect(page.locator('#inbox-hidden-words-btn')).toContainText('1 flagged');
  const spam = page.locator('.inbox-item[data-item-id="c2"]');
  await expect(spam.locator('.inbox-hidden-badge')).toContainText('Hidden word: crypto');
  await expect(page.locator('.inbox-item[data-item-id="c1"] .inbox-hidden-badge')).toHaveCount(0);

  const ana = page.locator('.inbox-item[data-item-id="c1"]');
  await ana.locator('.inbox-item-text').click();
  await ana.locator('.inbox-generate-btn').click();
  const warn = ana.locator('.inbox-bait-warn');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('comment bait');
  await expect(ana.locator('.inbox-reply-text')).toHaveValue('Comment YES and we will save you one!');

  await page.click('#inbox-hidden-words-btn');
  await expect(page.locator('#hw-text')).toHaveValue('crypto');
  await expect(page.locator('.hw-card').first()).toContainText('Hidden Words');
  await page.fill('#hw-text', 'crypto\nDM me');
  await page.click('#hw-save');
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].keywords).toBe('crypto\nDM me');
  await expect(page.locator('#hw-count')).toContainText('2/100');
  await expect(page.locator('#hw-copy')).toBeEnabled();
});
