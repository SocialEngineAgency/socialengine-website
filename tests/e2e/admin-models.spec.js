const { test, expect } = require('@playwright/test');
test('Video Models panel: shows each model’s providers, switched-off routes and new models waiting; dismiss works', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('se_admin_token', 't'));
  const dismissed = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.includes('railway.app')) {
      if (u.pathname === '/api/admin/model-watch') return route.fulfill({ json: { providers: {}, order: ['fal','higgsfield','atlas'], families: [
        { id: 'a', name: 'Kling 3.0 Pro', routes: [{ route: 'fal:x', blocked: true, until: Date.now()+3600000, reason: 'retired' }, { route: 'higgsfield:kling-pro', blocked: false }] },
        { id: 'b', name: 'Wan 2.7', routes: [{ route: 'fal:y', blocked: false }, { route: 'atlas:z', blocked: false }] } ],
        pending: [{ id: 'acme/shiny', name: 'Shiny <b>1</b>', provider: 'fal', firstSeen: '2026-10-24T00:00:00Z' }], lastRun: { at: new Date().toISOString(), errors: [] } } });
      if (u.pathname === '/api/admin/model-watch/dismiss') { dismissed.push(route.request().postData()); return route.fulfill({ json: { ok: true, pending: [] } }); }
      return route.fulfill({ json: {} });
    }
    return route.continue();
  });
  await page.goto('file://' + process.cwd() + '/admin.html');
  await page.click('[data-section="models"]');
  await expect(page.locator('#models-body')).toContainText('Kling 3.0 Pro');
  await expect(page.locator('#models-body')).toContainText('Shiny <b>1</b>');
  await expect(page.locator('#models-body .tag-red')).toContainText('fal.ai off until');
  await page.click('[data-dismiss]');
  await expect.poll(() => dismissed.length).toBe(1);
  expect(dismissed[0]).toContain('acme/shiny');
});
