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

// A finished reel goes to the studio with the pass, so it opens as its pieces.
const reel = {
  id: 'proj_vs', status: 'ready', mode: 'video', look: 'stylized', agent_brief: { title: 'Autumn run', shots: [{ action: 'Run' }, { action: 'Park' }] },
  final_url: 'https://store.test/final.mp4', vo_script: 'Stay active this autumn.',
  pipeline: { assemble: { vo: true, captions: true, music: true, outro: false } },
  scenes: [1, 2].map((i) => ({ id: `s${i}`, order: i, status: 'ready', duration_target: 5, video_sec: 5, video_url: `https://store.test/s${i}.mp4`, keyframe_url: `https://store.test/k${i}.png`, action: `Shot ${i}` })),
  chat: [{ role: 'user', text: 'An autumn run' }],
};

async function openReel(page, calls) {
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  await mockApi(page, srv.base, { animProjects: [reel], onRequest: passMock({ calls }) });
  await stubStudio(page);
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_vs"]');
}

test('Reels: Edit in Video Studio opens the studio with this reel', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await openReel(page, calls);
  const edit = page.locator('#anim-edit-studio');
  await expect(edit).toBeVisible();
  await expect(edit).toHaveText('Edit in Video Studio');
  const [tab] = await Promise.all([page.waitForEvent('popup'), edit.click()]);
  await expect.poll(() => tab.url()).toBe(`${STUDIO}/#se_pass=pass-abc&se_reel=proj_vs`);
  expect(calls).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Create bar: the Video Studio button takes the reel on screen, and nothing from other tabs', async ({ page }) => {
  const calls = [];
  await openReel(page, calls);
  await expect(page.locator('#anim-edit-studio')).toBeVisible();
  let [tab] = await Promise.all([page.waitForEvent('popup'), page.click('#create-open-video-studio')]);
  await expect.poll(() => tab.url()).toBe(`${STUDIO}/#se_pass=pass-abc&se_reel=proj_vs`);
  await tab.close();

  await page.click('.create-seg[data-segment="design-studio"]');
  [tab] = await Promise.all([page.waitForEvent('popup'), page.click('#create-open-video-studio')]);
  await expect.poll(() => tab.url()).toBe(`${STUDIO}/#se_pass=pass-abc`);
});
