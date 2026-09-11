// Error surfaces (design §1, portal half): the API's sentence + request id reach
// the customer, nothing else does. No model names, no `detail`.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const POST = {
  id: 'recPOST1',
  status: 'Ready for Review',
  caption: 'A caption',
  content_type: 'reel',
  platform: 'Instagram',
  created_at: new Date().toISOString(),
  image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  render_provenance: JSON.stringify({ model: 'higgsfield/dop-turbo', qa: { passed: true, score: 91 } }),
};

test('QA badge never names the model', async ({ page }) => {
  await mockApi(page, srv.base, { data: clientData({ content: [POST], posts: [POST] }) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  const badge = page.locator('.studio-card__qa-badge').first();
  await expect(badge).toBeVisible();
  const title = await badge.getAttribute('title');
  expect(title).not.toMatch(/model|higgsfield|dop-turbo/i);
  expect(title).toMatch(/QA passed/);
  expect(await page.locator('#dash-content').innerText()).not.toMatch(/higgsfield|dop-turbo/i);
});

test('error toasts carry the API sentence and a muted request id, never detail', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  // Every API error path funnels through showToast(error, 'error', { ref }).
  await page.evaluate(() => {
    const result = { error: 'Caption generation is temporarily unavailable. Nothing was charged.', code: 'PROVIDER_UNAVAILABLE', request_id: 'req_abcDEF123456789x', detail: 'anthropic 529 overloaded LEAKDETAIL' };
    window.showToast(result.error, 'error', { ref: result.request_id });
  });
  const toast = page.locator('.toast--error').last();
  await expect(toast).toBeVisible();
  const text = await toast.innerText();
  expect(text).toContain('Caption generation is temporarily unavailable.');
  expect(text).toContain('req_abcDEF123456789x');
  expect(text).not.toContain('LEAKDETAIL');
  await expect(toast.locator('.toast__ref')).toHaveText(/req_abcDEF123456789x/);
});

test('portal source no longer reads result.detail / result.details or renders Model: badges', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..');
  const portal = fs.readFileSync(path.join(root, 'portal.html'), 'utf8');
  const anim = fs.readFileSync(path.join(root, 'animation-studio.js'), 'utf8');
  expect(portal).not.toMatch(/\|\|\s*result\.details?\b/);
  expect(portal).not.toMatch(/'Model: '|`Model: \$\{/);
  expect(anim).not.toMatch(/Model: \$\{/);
  expect(anim).not.toMatch(/Check Atlas API key/);
  expect(anim).not.toMatch(/ELEVENLABS_API_KEY/);
  // Charity detection must not guess from the business name.
  expect(portal).not.toMatch(/charity\|cancer\|hospice\|foundation/);
});
