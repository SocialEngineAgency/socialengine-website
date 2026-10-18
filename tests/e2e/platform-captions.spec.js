// A caption for each platform on the review card: Instagram and Facebook post the main
// caption; a post going to TikTok shows its own TikTok caption, written when the card
// opens if there is none yet, editable (saved as typed), and rewritable.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const MAIN = 'Autumn mornings were made for moving.\n\nA short run, fresh air, and a moment for yourself.\n\n#RunClub #AutumnWellbeing';
const TT = 'The 10 minute autumn run that clears your head. What gets you out the door?\n\n#AutumnRun #RunClub';

const POSTS = [
  { id: 'recTikTok0000001', status: 'Ready for Review', platform: 'Instagram,TikTok', full_post_text: MAIN, caption: MAIN, image_url: 'https://store.test/a.jpg' },
  { id: 'recTikTok0000002', status: 'Ready for Review', platform: 'Instagram,TikTok', full_post_text: 'A second post about the club run.', caption: 'A second post about the club run.', image_url: 'https://store.test/b.jpg',
    platform_captions: { tiktok: { text: 'An older TikTok caption', source: 'auto', stale: true } } },
  { id: 'recInstaOnly0001', status: 'Ready for Review', platform: 'Instagram', full_post_text: 'Instagram only', caption: 'Instagram only', image_url: 'https://store.test/c.jpg' },
];

async function openReview(page, sent, { look = 'classic' } = {}) {
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  const data = clientData({ content: POSTS.map((p) => JSON.parse(JSON.stringify(p))) });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path !== '/api/platform-caption') return undefined;
      const body = JSON.parse(entry.body || '{}');
      sent.push(body);
      if (body.write) {
        json(200, { success: true, platform: 'tiktok', text: TT, platform_captions: { tiktok: { text: TT, source: 'auto', stale: false } } });
      } else {
        json(200, { success: true, platform: 'tiktok', text: body.text, platform_captions: body.text ? { tiktok: { text: body.text, source: 'client', stale: false } } : {} });
      }
      return 'handled';
    },
  });
  if (look === 'new') await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
}

async function openPost(page, id) {
  await page.locator(`[data-post-id="${id}"]`).first().waitFor({ state: 'attached' });
  await page.evaluate((postId) => {
    const hosts = [...document.querySelectorAll(`[data-post-id="${postId}"]`)];
    const openers = hosts.flatMap((h) => [h, ...h.querySelectorAll('[onclick*="openStudioModal"]')]).filter((el) => /openStudioModal/.test(el.getAttribute('onclick') || ''));
    openers[0].click();
  }, id);
}

for (const look of ['classic', 'new']) {
  test(`${look} look: TikTok gets its own caption under the Instagram and Facebook one`, async ({ page }) => {
    const errors = watchErrors(page);
    const sent = [];
    await openReview(page, sent, { look });

    // No TikTok caption yet: one is written as the card opens.
    await openPost(page, 'recTikTok0000001');
    const box = page.locator('.se-platcap[data-post-id="recTikTok0000001"][data-platform="tiktok"]');
    await expect(box).toBeVisible();
    await expect(page.locator('.studio-modal__caption-label').first()).toHaveText('Caption · Instagram & Facebook');
    await expect(box.locator('textarea')).toHaveValue(TT);
    await expect(box.locator('[data-platcap-state]')).toHaveText('Written for TikTok');
    await expect(box.locator('[data-platcap-write]')).toHaveText('Rewrite');
    expect(sent).toEqual([{ postId: 'recTikTok0000001', platform: 'tiktok', write: true }]);
    await expect(page.locator('.post-caption-edit')).toHaveValue(MAIN);

    // The client's own words save as typed.
    await box.locator('textarea').fill('My own TikTok words #RunClub');
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ postId: 'recTikTok0000001', platform: 'tiktok', text: 'My own TikTok words #RunClub' });
    await expect(box.locator('[data-platcap-state]')).toHaveText('Your words');

    // Written from an older main caption: it says so, and is not rewritten on its own.
    await openPost(page, 'recTikTok0000002');
    const box2 = page.locator('.se-platcap[data-post-id="recTikTok0000002"]');
    await expect(box2.locator('textarea')).toHaveValue('An older TikTok caption');
    await expect(box2.locator('[data-platcap-state]')).toHaveText('Main caption changed since this was written');
    await page.waitForTimeout(400);
    expect(sent.length).toBe(2);
    await box2.locator('[data-platcap-write]').click();
    await expect(box2.locator('textarea')).toHaveValue(TT);
    await expect(box2.locator('[data-platcap-state]')).toHaveText('Written for TikTok');

    // Instagram only: the main caption and nothing else.
    await openPost(page, 'recInstaOnly0001');
    await expect(page.locator('.post-caption-edit')).toHaveValue('Instagram only');
    await expect(page.locator('.se-platcap')).toHaveCount(0);
    await expect(page.locator('.studio-modal__caption-label').first()).toHaveText('Caption');
    expect(errors).toEqual([]);
  });
}
