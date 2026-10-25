// Video page: one finishing step for Generate and Upload (roadmap chunks 9 and 3). A finished generated clip goes
// into the same step as an uploaded one: caption, captions on the video (the words said), platforms, queue or post.
// Queuing stays on the page. Hermetic: mocked API, a local fixture video.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function world(page, { speech = true } = {}) {
  const seen = { captions: [], queued: [], approved: [], recent: 0 };
  const clip = `${srv.base}/tests/e2e/fixtures/75s.webm`;
  return mockApi(page, srv.base, {
    onRequest: async (entry, route, json) => {
      const body = () => JSON.parse(entry.body || '{}');
      if (entry.path === '/api/studio/recent-videos') {
        seen.recent += 1;
        json(200, { videos: [{ video_url: clip, product_name: 'Velvet "Choker"', template: 'Smooth', created_at: '2026-10-25T20:00:00Z', status: 'completed' }] });
        return 'handled';
      }
      if (entry.path === '/api/studio/caption-video') {
        seen.captions.push(body());
        if (!speech) { json(422, { error: 'No speech was heard in this clip, so there are no words to caption.', code: 'NO_SPEECH' }); return 'handled'; }
        json(200, { success: true, video_url: `${clip}?captioned=${seen.captions.length}`, words: 12, transcript: 'Hi' });
        return 'handled';
      }
      if (entry.path === '/api/studio/design-queue') { seen.queued.push(body()); json(200, { ok: true, record_id: 'recQ1' }); return 'handled'; }
      if (entry.path === '/api/approve-post') { seen.approved.push(body()); json(200, { success: true }); return 'handled'; }
      return undefined;
    },
  }).then(() => ({ seen, clip }));
}

async function openVideo(page) {
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('creation-studio'));
  await expect(page.locator('#vs-mode-make')).toBeVisible();
}

test('a generated clip: Finish and post → the shared step → captions → queued, and the page stays', async ({ page }) => {
  const { seen, clip } = await world(page);
  await openVideo(page);
  await page.evaluate((url) => {
    const item = document.createElement('div');
    item.id = 'vs-gen-vid_fin';
    document.body.appendChild(item);
    updateGenComplete('vid_fin', url, 'Mug');
  }, clip);
  await page.click('#vs-gen-vid_fin [data-vs-finish]');

  const flow = page.locator('#vs-upload-flow');
  await expect(flow).toBeVisible();
  await expect(flow).toContainText('Finish and post your clip');
  await expect(page.locator('#vs-mode-upload')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#vs-finished-video')).toHaveAttribute('src', clip);

  // Captions: off by default; on shows a preview that plays the captioned copy.
  await expect(page.locator('#vs-burn-captions')).not.toBeChecked();
  await expect(page.locator('#vs-captions-preview')).toBeHidden();
  await page.check('#vs-burn-captions');
  await expect(page.locator('#vs-captions-status')).toContainText('added when you queue');
  await page.click('#vs-captions-preview');
  await expect(page.locator('#vs-captions-status')).toContainText('shows the captions');
  await expect(page.locator('#vs-finished-video')).toHaveAttribute('src', `${clip}?captioned=1`);
  expect(seen.captions).toEqual([{ video_url: clip, audio_url: clip }]);

  await page.fill('#vs-upload-caption', 'Night drive energy.');
  await page.click('#vs-upload-queue');
  await expect.poll(() => seen.queued.length).toBe(1);
  expect(seen.captions.length, 'the preview copy is reused, not captioned twice').toBe(1);
  expect(seen.queued[0]).toMatchObject({ type: 'video', video_url: `${clip}?captioned=1`, caption: 'Night drive energy.', status: 'Pending' });

  // Still on the Video page, with a way to Content Review and a fresh step.
  const done = page.locator('#vs-finish-done');
  await expect(done).toContainText('Added to your queue.');
  await expect(done).toContainText('With captions.');
  await expect(page.locator('#vs-upload-flow')).toBeVisible();
  await expect(page.locator('#vs-finished-drop')).toBeVisible();
  await expect(page.locator('#vs-upload-flow h3')).toHaveText('I already have the video');
  await expect(page.locator('#vs-done-review')).toBeVisible();
});

test('the recent generations list can finish a clip too; no speech is queued without captions and says so', async ({ page }) => {
  const { seen, clip } = await world(page, { speech: false });
  await openVideo(page);
  const finish = page.locator('#vs-recent-list [data-vs-finish-url]').first();
  await expect(finish).toBeVisible();
  await expect(finish).toHaveAttribute('data-vs-finish-label', 'Velvet "Choker"');
  await finish.click();
  await expect(page.locator('#vs-upload-flow')).toContainText('Finish and post your clip');
  await page.check('#vs-burn-captions');
  await page.click('#vs-upload-post');
  await expect.poll(() => seen.approved.length).toBe(1);
  expect(seen.queued[0].video_url, 'the clip goes as it is').toBe(clip);
  expect(seen.approved[0]).toMatchObject({ postId: 'recQ1', publishNow: true });
  await expect(page.locator('#vs-finish-done')).toContainText('Posted.');
  await expect(page.locator('#vs-finish-done')).toContainText('No speech was heard');
});

test('an uploaded video uses the same step; Open Content Review goes there only when asked', async ({ page }) => {
  const { seen, clip } = await world(page);
  await login(page, srv.base);
  await page.evaluate((url) => {
    window.__SE_VS_DOOR = 'upload';
    window.__SE_VS_UPLOAD = { videoUrl: url, sourceVideoUrl: url };
    window.switchNav('creation-studio');
  }, clip);
  await expect(page.locator('#vs-upload-flow h3')).toHaveText('I already have the video');
  await page.click('#vs-upload-queue');
  await expect.poll(() => seen.queued.length).toBe(1);
  expect(seen.captions, 'captions are off unless turned on').toEqual([]);
  await expect(page.locator('#vs-finish-done')).toContainText('Added to your queue.');
  await page.click('#vs-done-review');
  await expect(page.locator('.dash-nav-item[data-nav="content"]')).toHaveClass(/active/);
});
