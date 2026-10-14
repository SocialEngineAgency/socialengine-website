// Captions are written from the media: the calendar queue uploads the file,
// asks for a caption about it, and schedules the stored copy. And an inbox
// with no DMs says why. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

test('calendar queue: AI caption watches the uploaded video; scheduling reuses the upload', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/upload-video') {
        calls.push({ path: entry.path });
        json(200, { url: 'https://media.example.com/c/recA/walk.mp4', mime: 'video/mp4' });
        return 'handled';
      }
      if (entry.path === '/api/studio/generate-caption') {
        calls.push({ path: entry.path, body: JSON.parse(entry.body || '{}') });
        json(200, { success: true, caption: 'Sarah walked 5K for OPA.\n\n#OPA', media: { kind: 'video', looked_at: 6, heard_speech: true, notes: [] } });
        return 'handled';
      }
      if (entry.path === '/api/studio/quick-schedule') {
        calls.push({ path: entry.path, body: JSON.parse(entry.body || '{}'), type: route.request().headers()['content-type'] || '' });
        json(200, { success: true, recordId: 'recNEW' });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  await page.waitForFunction(() => !!document.getElementById('sched-file-input'));
  await page.setInputFiles('#sched-file-input', { name: 'walk.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(4096, 1) });

  // No brief needed: one tap uploads, then writes from the video.
  await page.click('#bq-aibtn-0');
  await expect(page.locator('#bq-cap-0')).toHaveValue(/Sarah walked 5K for OPA/);
  const gen = calls.find((c) => c.path === '/api/studio/generate-caption');
  expect(calls[0].path).toBe('/api/studio/upload-video');
  expect(gen.body.media_url).toBe('https://media.example.com/c/recA/walk.mp4');
  expect(gen.body.media_type).toBe('video');

  // Rewrite sends the current draft and does not upload again.
  await page.fill('#bq-cap-0', 'Walk on 12 October');
  await page.click('#bq-aibtn-0');
  await expect.poll(() => calls.filter((c) => c.path === '/api/studio/generate-caption').length).toBe(2);
  expect(calls.filter((c) => c.path === '/api/studio/upload-video').length).toBe(1);
  expect(calls.filter((c) => c.path === '/api/studio/generate-caption')[1].body.current_caption).toBe('Walk on 12 October');

  await page.evaluate(() => window._batchSetDate(0, '2026-10-30', '10:00'));
  await page.evaluate(() => window._batchScheduleOne(0));
  await expect.poll(() => calls.some((c) => c.path === '/api/studio/quick-schedule')).toBe(true);
  const sched = calls.find((c) => c.path === '/api/studio/quick-schedule');
  expect(sched.type).toContain('application/json');
  expect(sched.body.media_url).toBe('https://media.example.com/c/recA/walk.mp4');
  expect(sched.body.content_type).toBe('video');
});

async function inboxWith(page, debug) {
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/inbox' && entry.method === 'GET') {
        const q = new URL(route.request().url()).searchParams;
        const items = [{ id: 'c1', type: 'comment', platform: 'instagram', username: 'jo', text: 'Love this', timestamp: ago(1), last_inbound_at: ago(1), needs_reply: true, status: 'open',
          thread: [{ id: 'c1', text: 'Love this', timestamp: ago(1), from_us: false, username: 'jo' }] }];
        const list = q.get('type') === 'dm' ? [] : items;
        json(200, { connected: true, total: 1, unreplied: 1, counts: { all: 1, needs_reply: 1, done: 0, dm: 0, comment: 1, mention: 0 }, items: list, has_more: false, source: 'meta', sync: { quick_at: ago(0), deep_at: ago(0), deep_running: false }, _debug: debug });
        return 'handled';
      }
      if (entry.path === '/api/inbox/canned-responses') { json(200, { canned: [] }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="inbox"]');
}

test('inbox: no Facebook Page means a reconnect banner that says DMs need the Page', async ({ page }) => {
  await inboxWith(page, { dm_no_page: true, dm_info: 'DMs come through the Facebook Page linked to your Instagram. Reconnect Meta and choose that Page.' });
  await expect(page.locator('#inbox-banner-title')).toHaveText('DMs need your Facebook Page');
  await expect(page.locator('#inbox-reconnect-meta-btn')).toBeVisible();
});

test('inbox: a Meta error shows its reason, and the empty DMs filter explains itself', async ({ page }) => {
  await inboxWith(page, { dm_instagram_failed: true, dm_info: 'Instagram DMs did not load. Meta said: Unsupported get request. (code 100)', dm_messenger_unavailable: true, dm_ig_count: 0 });
  await expect(page.locator('#inbox-banner-title')).toHaveText('Instagram DMs did not load');
  await expect(page.locator('#inbox-banner-body')).toContainText('Unsupported get request');
  await expect(page.locator('#inbox-reconnect-meta-btn')).toBeHidden();
  await page.selectOption('#inbox-type', 'dm');
  await expect(page.locator('.ibx-list .ibx-empty')).toContainText('No DMs here yet');
  await expect(page.locator('.ibx-list .ibx-empty')).toContainText('Messenger');
});
