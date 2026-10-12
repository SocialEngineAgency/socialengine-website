// Create → Carousels: every carousel tool lives in one tab. Post keeps single posts only. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function designSystem({ enabled = true } = {}) {
  return async (entry, route, json) => {
    if (entry.path === '/api/design/system') {
      json(200, { ok: true, enabled, system: null, settings: { medical: 'off' }, recipes: [], figurelabs: false, previews: [], fonts: [] });
      return 'handled';
    }
    if (entry.path === '/api/studio/carousel-redesign') {
      json(200, { ok: true, master_image_url: 'https://store.test/master.png', slides: [1, 2, 3].map((i) => ({ url: `https://store.test/r${i}.png`, title: `Slide ${i}` })) });
      return 'handled';
    }
    return undefined;
  };
}

test('Post hides carousel tools and points to Carousels', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { onRequest: designSystem() });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('design-studio'));
  await expect(page.locator('#dash-content #cs-generate')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#cs-carousel-drawer')).toBeHidden();
  await expect(page.locator('#cs-upload-infographic')).toBeHidden();
  await expect(page.locator('#cs-upload-slides')).toBeHidden();
  await expect(page.locator('#dash-content')).toContainText('Carousels have their own tab');
  await page.click('#cs-mode-carousels');
  await expect(page.locator('#create-segments [data-segment="brand-design"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content .dsv2')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => location.hash)).toBe('#create/carousels');
  expect(errors).toEqual([]);
});

test('Carousels: brand template ⇄ infographic or finished slides, and Post stays single-post', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { onRequest: designSystem() });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('#create-segments [data-segment="brand-design"]');
  await expect(page.locator('#dash-content .dsv2 h2')).toHaveText('Carousels');
  await page.click('#dsv2-open-slides');
  await expect(page.locator('#create-segments [data-segment="brand-design"]')).toHaveClass(/active/);
  await expect(page.locator('#cs-carousel-drawer')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#cs-carousel-drawer')).toHaveAttribute('open', '');
  await expect(page.locator('#cs-upload-infographic')).toBeVisible();
  await expect(page.locator('#cs-upload-slides')).toBeVisible();
  await expect(page.locator('.atelier-essentials')).toContainText('Carousels');

  // Switching to Post and back to Carousels keeps the slides view; Post never shows carousel tools.
  await page.click('#create-segments [data-segment="design-studio"]');
  await expect(page.locator('#cs-carousel-drawer')).toBeHidden();
  await expect(page.locator('.atelier-essentials')).toContainText('Post');
  await page.click('#create-segments [data-segment="brand-design"]');
  await expect(page.locator('#cs-carousel-drawer')).toBeVisible();

  await page.click('#cs-mode-brand');
  await expect(page.locator('#dash-content .dsv2')).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('Old #create/design links open Carousels; accounts without brand templates still reach slides', async ({ page }) => {
  await mockApi(page, srv.base, { onRequest: designSystem({ enabled: false }) });
  await login(page, srv.base);
  await page.evaluate(() => { location.hash = '#create/design'; });
  await page.click('.dash-nav-item[data-nav="create"]');
  await expect(page.locator('#create-segments [data-segment="brand-design"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content')).toContainText('not switched on');
  await page.click('#dsv2-open-slides');
  await expect(page.locator('#cs-carousel-drawer')).toBeVisible({ timeout: 15000 });
});

test('Coach redesign plan lands in Carousels with the slides, even when started from Post', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { onRequest: designSystem() });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('design-studio'));
  await expect(page.locator('#dash-content #cs-generate')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => window.acceptCarouselRedesign({ master_image_url: 'https://store.test/master.png', slides: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }));
  await expect(page.locator('#create-segments [data-segment="brand-design"]')).toHaveClass(/active/);
  await expect(page.locator('#cs-slide-strip .cs-slide-btn')).toHaveCount(3, { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('All Tools Carousels card opens the brand template view even after using slides', async ({ page }) => {
  await mockApi(page, srv.base, { onRequest: designSystem() });
  await login(page, srv.base);
  await page.evaluate(() => window.seOpenCarousels('slides'));
  await expect(page.locator('#cs-carousel-drawer')).toBeVisible({ timeout: 15000 });
  await page.click('.dash-nav-item[data-nav="ai-studio"]');
  await page.click('#aist-brand-design');
  await expect(page.locator('#dash-content .dsv2')).toBeVisible({ timeout: 15000 });
});
