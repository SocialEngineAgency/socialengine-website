// Music bed length: 15s steps up to 3:00, and "Match video" sizes the bed to the clip. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

test('a 1:15 video gets a 75s music bed by default; 3:00 is selectable', async ({ page }) => {
  const asked = [];
  await mockApi(page, srv.base, {
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/generate-music') {
        const body = JSON.parse(route.request().postData() || '{}');
        asked.push(body.music_length_ms);
        json(200, { music_bed_url: 'https://store.test/bed.mp3', length_ms: body.music_length_ms });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.evaluate((base) => {
    window.__SE_VS_DOOR = 'upload';
    window.__SE_VS_UPLOAD = { videoUrl: `${base}/tests/e2e/fixtures/75s.webm`, sourceVideoUrl: `${base}/tests/e2e/fixtures/75s.webm` };
    window.switchNav('creation-studio');
  }, srv.base);
  const video = page.locator('#vs-finished-video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v) => Math.round(v.duration || 0))).toBe(75);

  const length = page.locator('#vs-music-length');
  await expect(length).toHaveValue('auto');
  const labels = await length.locator('option').allTextContents();
  expect(labels[0]).toBe('Match video');
  expect(labels.at(-1)).toBe('3:00');
  expect(labels).toContain('1:15');

  await page.fill('#vs-music-prompt', 'warm lo-fi instrumental');
  await page.click('#vs-music-generate');
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe(75000);

  await page.locator('#vs-music-length').selectOption('180000');
  await page.click('#vs-music-generate');
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toBe(180000);
});
