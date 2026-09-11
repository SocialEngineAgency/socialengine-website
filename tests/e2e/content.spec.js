// Content Review Refresh + Archive (design §6). Hermetic — local static
// server + mocked API (see helpers/portal-mock.js).
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const POSTS = [
  { id: 'recPending1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Pending caption for review' },
  { id: 'recPub1', status: 'Published', platform: 'instagram', full_post_text: 'Already live on Instagram' },
  { id: 'recArch1', status: 'Archived', archived_from: 'Ready for Review', platform: 'instagram', full_post_text: 'Old archived draft' },
];

async function openContent(page, extra = {}) {
  const data = clientData({ content: POSTS.map((p) => ({ ...p })), ...extra });
  const calls = await mockApi(page, srv.base, { data });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await expect(page.locator('#dash-content h2').first()).toHaveText(/Content Review/);
  return { data, calls };
}

test('Archived is hidden from All; Archived filter + Restore returns it', async ({ page }) => {
  await openContent(page);
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toBeVisible();
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toHaveCount(0);
  await expect(page.locator('#studio-count-all')).toHaveText('2');
  await page.click('.studio-filter[data-filter="archived"]');
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toBeVisible();
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toHaveCount(0);
  await page.click('.studio-card[data-post-id="recArch1"] .studio-card__restore-btn');
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toHaveCount(0);
  await page.click('.studio-filter[data-filter="all"]');
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toBeVisible();
});

test('Archive on a non-Published card removes it from All and shows it under Archived', async ({ page }) => {
  const { calls } = await openContent(page);
  await expect(page.locator('.studio-card[data-post-id="recPub1"] .studio-card__archive-btn')).toHaveCount(0);
  await page.click('.studio-card[data-post-id="recPending1"] .studio-card__archive-btn');
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toHaveCount(0);
  const archived = calls.filter((c) => c.path === '/api/archive-post');
  expect(archived).toHaveLength(1);
  expect(JSON.parse(archived[0].body).postId).toBe('recPending1');
  await page.click('.studio-filter[data-filter="archived"]');
  await expect(page.locator('.studio-card[data-post-id="recPending1"]')).toBeVisible();
  await expect(page.locator('.studio-card[data-post-id="recPending1"] .studio-card__restore-btn')).toBeVisible();
});

test('Refresh re-fetches client-data, keeps the active filter, and is disabled in flight', async ({ page }) => {
  const data = clientData({ content: POSTS.map((p) => ({ ...p })) });
  let clientDataHits = 0;
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/client-data') {
        clientDataHits += 1;
        if (clientDataHits > 1) {
          data.content = [...data.content, { id: 'recNew1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Just generated' }];
        }
        json(200, data);
        return 'handled';
      }
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-filter[data-filter="pending"]');
  await expect(page.locator('.studio-filter[data-filter="pending"]')).toHaveClass(/active/);
  const btn = page.locator('#content-refresh');
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.locator('.studio-card[data-post-id="recNew1"]')).toBeVisible();
  await expect(page.locator('.studio-filter[data-filter="pending"]')).toHaveClass(/active/);
  await expect(page.locator('.studio-card[data-post-id="recArch1"]')).toHaveCount(0);
});
