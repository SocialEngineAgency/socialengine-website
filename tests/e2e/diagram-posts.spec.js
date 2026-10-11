// Diagram posts: draft from a caption, edit, live preview, save, hand to Create as a finished graphic. Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Diagram from a caption: drafts, edits flow into the preview, saves, and lands in Create without generating', async ({ page }) => {
  const drafts = [];
  const renders = [];
  const generateCalls = [];
  const data = clientData({ content: [{ id: 'recP1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Our process: free visit, design and quote, fitted in five days.' }] });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/diagrams/options') {
        json(200, {
          types: [{ id: 'steps', min: 3, max: 6 }, { id: 'timeline', min: 3, max: 6 }, { id: 'compare', min: 2, max: 5 }, { id: 'cycle', min: 3, max: 6 }, { id: 'funnel', min: 3, max: 5 }],
          defaults: { accent: '#22C55E', handle: 'oakandco', theme: 'light', font: 'inter' },
          fonts: [{ id: 'inter', name: 'Inter' }, { id: 'poppins', name: 'Poppins' }],
        });
        return 'handled';
      }
      if (entry.path === '/api/diagrams/draft') {
        drafts.push(JSON.parse(entry.body || '{}'));
        json(200, { spec: { type: 'steps', eyebrow: 'How it works', title: 'Fitted kitchen in three steps', items: [{ label: 'Free visit', note: '' }, { label: 'Design and quote', note: '' }, { label: 'Fitted in five days', note: '' }], focus: 2 } });
        return 'handled';
      }
      if (entry.path === '/api/diagrams/render') {
        const body = JSON.parse(entry.body || '{}');
        renders.push(body);
        json(200, body.preview ? { spec: body.spec, data_url: PNG_1PX } : { spec: body.spec, url: 'https://cdn.example/diagram.png', width: 1080, height: 1350 });
        return 'handled';
      }
      if (/generate|claude-studio\/(design|render)/.test(entry.path)) generateCalls.push(entry.path);
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-card[data-post-id="recP1"] .studio-card__caption');
  await expect(page.locator('.post-caption-edit[data-post-id="recP1"]')).toBeVisible();
  await page.locator('.dg-attach').first().click();

  await expect(page.locator('#dg-title')).toHaveValue('Fitted kitchen in three steps');
  expect(drafts[0].text).toContain('Our process');
  await expect(page.locator('#dg-preview')).toBeVisible();

  await page.locator('input[data-f="label"][data-i="0"]').fill('Free home visit');
  await page.click('#dg-add');
  await page.locator('input[data-f="label"][data-i="3"]').fill('Aftercare call');
  await page.selectOption('#dg-theme', 'dark');
  await expect.poll(() => {
    const last = renders[renders.length - 1];
    return last && last.preview && last.spec.items.length === 4 && last.spec.items[0].label === 'Free home visit' && last.theme === 'dark';
  }, { timeout: 5000 }).toBe(true);
  const last = renders[renders.length - 1];
  expect(last.accent).toBe('#22c55e');
  expect(last.spec.handle).toBe('oakandco');
  expect(last.spec._theme).toBeUndefined();

  await page.click('#dg-save');
  await expect(page.locator('#dg-download')).toHaveAttribute('href', 'https://cdn.example/diagram.png');
  expect(renders[renders.length - 1].preview).toBeUndefined();

  await page.click('#dg-create');
  await expect(page.locator('#cs-brief')).toHaveValue('Fitted kitchen in three steps', { timeout: 10000 });
  await expect(page.locator('#cs-original-preview-img')).toHaveAttribute('src', /diagram\.png/);
  await page.waitForTimeout(500);
  expect(generateCalls).toEqual([]);
});
