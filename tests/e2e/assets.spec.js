// Asset library UI (design §8). Hermetic — local static server + mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, EMAIL } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const OUTRO = { id: 'ast_outro1', kind: 'outro', name: 'Silk end', url: 'https://store.test/silk-end.mp4', bytes: 12, content_type: 'video/mp4' };

function readyProject(over = {}) {
  return {
    id: 'proj_ready',
    status: 'ready',
    mode: 'video',
    look: 'stylized',
    outro_url: null,
    music_bed_url: null,
    pipeline: { assemble: { vo: true, captions: true, music: true, outro: true } },
    scenes: [{ id: 's1', order: 1, status: 'ready', video_url: 'https://store.test/shot.mp4', prompt: 'Walk' }],
    ...over,
  };
}

test('Settings → Brand shows Brand library; rename and delete hit the API', async ({ page }) => {
  const store = [ { ...OUTRO } ];
  const calls = await mockApi(page, srv.base, {
    data: clientData(),
    assets: store,
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="settings"]');
  await expect(page.locator('#brand-library')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#brand-library')).toContainText(/Brand library/);
  await expect(page.locator('#brand-library')).toContainText(/Silk end/);

  page.once('dialog', (d) => d.accept('End card'));
  await page.click('#brand-library [data-asset-rename="ast_outro1"]');
  await expect.poll(() => calls.some((c) => c.method === 'PATCH' && c.path === '/api/assets/ast_outro1')).toBeTruthy();
  await expect(page.locator('#brand-library')).toContainText(/End card/);

  page.once('dialog', (d) => d.accept());
  await page.click('#brand-library [data-asset-delete="ast_outro1"]');
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.path === '/api/assets/ast_outro1')).toBeTruthy();
  await expect(page.locator('#brand-library')).not.toContainText(/End card/);
});

test('Animate: pick a saved outro on a second project without re-uploading', async ({ page }) => {
  const project = readyProject();
  const calls = await mockApi(page, srv.base, {
    data: clientData(),
    assets: [{ ...OUTRO }],
    animProjects: [project],
  });
  await login(page, srv.base);
  await page.evaluate(() => localStorage.setItem('se_anim_last_project', 'proj_ready'));
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('#create-segments [data-segment="animation-studio"]');
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
  const pick = page.locator('#anim-outro-pick');
  await expect(pick).toBeVisible({ timeout: 15000 });
  await expect(pick.locator('option[value="ast_outro1"]')).toHaveText(/Silk end/);
  await pick.selectOption('ast_outro1');
  await expect.poll(() => {
    const settings = calls.filter((c) => c.path.endsWith('/settings') && c.method === 'POST');
    return settings.some((c) => {
      try { return JSON.parse(c.body).outro_url === OUTRO.url; } catch { return false; }
    });
  }).toBeTruthy();
  expect(calls.some((c) => c.method === 'POST' && c.path === '/api/assets')).toBe(false);
});

test('Animate Upload new posts the file to /api/assets', async ({ page }) => {
  const project = readyProject();
  const calls = await mockApi(page, srv.base, {
    data: clientData(),
    assets: [],
    animProjects: [project],
  });
  await login(page, srv.base);
  await page.evaluate(() => localStorage.setItem('se_anim_last_project', 'proj_ready'));
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('#create-segments [data-segment="animation-studio"]');
  await expect(page.locator('#anim-outro-pick')).toBeVisible({ timeout: 15000 });
  await page.setInputFiles('#anim-outro-file', {
    name: 'end.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), ...Buffer.alloc(32, 3)]),
  });
  await expect.poll(() => calls.some((c) => c.method === 'POST' && c.path === '/api/assets')).toBeTruthy();
});
