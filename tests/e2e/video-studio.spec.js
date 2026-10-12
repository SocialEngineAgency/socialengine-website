// Video Studio link: the portal opens the studio in a new tab with a one-time pass; Library shows saved videos. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const STUDIO = 'https://socialengine-video.netlify.app';

function passMock({ status = 200, calls }) {
  return async (entry, route, json) => {
    if (entry.path === '/api/video-studio/pass' && entry.method === 'POST') {
      calls.push(entry);
      if (status === 200) json(200, { code: 'pass-abc', expires_in: 60 });
      else json(status, { error: 'This feature requires the Growth plan.' });
      return 'handled';
    }
    return undefined;
  };
}

async function stubStudio(page) {
  await page.context().route(`${STUDIO}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>studio</body></html>' }));
}

test('Create bar: Video Studio opens a new tab with the pass and stays on the current tab', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: passMock({ calls }) });
  await stubStudio(page);
  await login(page, srv.base);
  await page.click('[data-nav="create"]');
  await expect(page.locator('#create-open-video-studio')).toBeVisible();
  const active = await page.locator('#create-segments .create-seg.active').getAttribute('data-segment');

  const [tab] = await Promise.all([page.waitForEvent('popup'), page.click('#create-open-video-studio')]);
  await expect.poll(() => tab.url()).toBe(`${STUDIO}/#se_pass=pass-abc`);
  expect(calls).toHaveLength(1);
  expect(calls[0].headers.authorization).toMatch(/^Bearer /);
  await expect(page.locator('#create-segments .create-seg.active')).toHaveAttribute('data-segment', active);
  expect(errors).toEqual([]);
});

test('All Tools card opens the studio too', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: passMock({ calls }) });
  await stubStudio(page);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-studio"]');
  const [tab] = await Promise.all([page.waitForEvent('popup'), page.click('#aist-video-studio')]);
  await expect.poll(() => tab.url()).toContain('#se_pass=pass-abc');
});

test('Starter plan: the blank tab closes and the reason shows', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: passMock({ status: 403, calls }) });
  await login(page, srv.base);
  await page.click('[data-nav="create"]');
  const [tab] = await Promise.all([page.waitForEvent('popup'), page.click('#create-open-video-studio')]);
  await tab.waitForEvent('close');
  await expect(page.locator('body')).toContainText('requires the Growth plan');
});

test('Library lists a saved Video Studio export as a video', async ({ page }) => {
  await mockApi(page, srv.base, {
    assets: [{ id: 'ast_vid1', kind: 'video', name: 'Spring promo', url: 'https://store.test/promo.mp4', bytes: 12, content_type: 'video/mp4', source: 'video_studio' }],
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="library"]');
  await expect(page.locator('#brand-library')).toContainText('Spring promo');
  await expect(page.locator('#brand-library [data-asset-kind="ast_vid1"]')).toHaveValue('video');
  await expect(page.locator('#brand-library-kind, #brand-lib-kind option[value="video"]')).toHaveCount(1);
});
