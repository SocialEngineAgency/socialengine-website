// The Video model picker shows earned ratings only: no badge, no provider label, no hand-made score.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const MODELS = [
  { id: 'kling-3-pro', displayName: 'Kling 3.0 Pro', description: 'Cinematic image-to-video.', provider: 'higgsfield', type: 'video', tier: 'growth', status: 'available', badge: '', badgeColor: '', speed: 'Moderate', preservationScore: null, rating: { basis: null, score: null, kept: 0, rejected: 0, n: 0 } },
  { id: 'atlas-seedance-2-i2v', displayName: 'Seedance 2.0', description: 'Image-to-video.', provider: 'atlas', type: 'video', tier: 'growth', status: 'available', badge: '', badgeColor: '', speed: 'Moderate', preservationScore: null, rating: { basis: 'everyone', score: 8.1, kept: 30, rejected: 6, n: 36 } },
  { id: 'atlas-wan-2-7-i2v', displayName: 'Wan 2.7', description: 'Image-to-video.', provider: 'atlas', type: 'video', tier: 'growth', status: 'available', badge: '', badgeColor: '', speed: 'Moderate', preservationScore: null, rating: { basis: 'you', score: 6.3, kept: 5, rejected: 4, n: 9 } },
];

async function openVideo(page, extra) {
  const posts = [];
  await mockApi(page, srv.base, {
    onRequest: (entry, route, json) => {
      if (entry.path === '/api/models') { json(200, { models: MODELS, count: {}, requested_tier: 'growth', source: 'authenticated' }); return 'handled'; }
      if (entry.path === '/api/studio/video-feedback') { posts.push(JSON.parse(entry.body || '{}')); json(200, { ok: true }); return 'handled'; }
      return extra ? extra(entry, route, json) : undefined;
    },
  });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('creation-studio'));
  await expect(page.locator('#vs-model')).toBeAttached({ timeout: 15000 });
  return posts;
}

test('picker: earned ratings only, best earned first, no badge or provider', async ({ page }) => {
  const errors = watchErrors(page);
  await openVideo(page);
  const labels = await page.$$eval('#vs-model option', (os) => os.map((o) => o.textContent));
  expect(labels).toEqual([
    'Seedance 2.0 — 8.1/10 · 36 decided by everyone',
    'Wan 2.7 — 6.3/10 · 9 decided by you',
    'Kling 3.0 Pro — Not rated yet',
  ]);
  for (const l of labels) expect(l).not.toMatch(/BEST|SocialEngine AI|Preservation|\[/);
  await expect(page.locator('#vs-model')).toHaveValue('atlas-seedance-2-i2v');
  expect(errors).toEqual([]);
});

test('the model list shows the same earned ratings and no badge', async ({ page }) => {
  await openVideo(page);
  await page.evaluate(() => { const d = document.querySelector('#vs-models-list, .vs-models'); if (d) d.open = true; });
  const html = await page.content();
  expect(html).not.toMatch(/>BEST</);
  expect(html).not.toMatch(/Preservation<\/div>/);
});

test('a finished video can be rated good or not good', async ({ page }) => {
  const posts = await openVideo(page);
  await page.evaluate(() => {
    // On the body, not in the recent list, which repaints itself when its own fetch lands.
    const item = document.createElement('div');
    item.id = 'vs-gen-vid_abc';
    document.body.appendChild(item);
    updateGenComplete('vid_abc', 'https://cdn.example/v.mp4', 'Mug');
  });
  await page.click('#vs-gen-vid_abc button:has-text("Not good")');
  await expect(page.locator('#vs-gen-vid_abc')).toContainText('Marked not good');
  expect(posts).toEqual([{ request_id: 'vid_abc', verdict: 'bad' }]);
});
