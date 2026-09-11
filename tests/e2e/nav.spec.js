// Sidebar restructure (design §3): labels, Create segmented control, Settings
// tabs with hash deep links, charity/commerce capability gating. Hermetic —
// local static server + mocked API (see helpers/portal-mock.js).
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors, CHARITY_CAPS } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const EXPECTED_LABELS = ['Home', 'Content Review', 'Calendar', 'Create', 'Ads', 'Inbox', 'Analytics', 'Intel', 'Coach', 'All Tools', 'Settings'];
const EXPECTED_NAVS = ['dashboard', 'content', 'schedule', 'create', 'ad-studio', 'inbox', 'analytics', 'competitor-intel', 'ai-coach', 'ai-studio', 'settings'];

async function visibleNav(page) {
  const items = page.locator('.dash-nav-item');
  const n = await items.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const el = items.nth(i);
    if (!(await el.isVisible())) continue;
    out.push({ nav: await el.getAttribute('data-nav'), label: (await el.innerText()).trim() });
  }
  return out;
}

test('commerce client: sidebar is the approved 11 items, studios and Brand are gone', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  const items = await visibleNav(page);
  expect(items.map((i) => i.label)).toEqual(EXPECTED_LABELS);
  expect(items.map((i) => i.nav)).toEqual(EXPECTED_NAVS);
  for (const gone of ['creation-studio', 'animation-studio', 'brand-voice', 'video-studio']) {
    expect(await page.locator(`.dash-nav-item[data-nav="${gone}"]`).count(), gone).toBe(0);
  }
});

test('charity client: Fundraise appears, Brand tab is called Voice, no Shopify card in Connections', async ({ page }) => {
  await mockApi(page, srv.base, { data: clientData({ capabilities: CHARITY_CAPS }) });
  await login(page, srv.base);
  const items = await visibleNav(page);
  expect(items.map((i) => i.nav)).toContain('fundraise');
  await page.click('.dash-nav-item[data-nav="settings"]');
  await expect(page.locator('[data-settings-tab="brand"]')).toHaveText(/^\s*Voice\s*$/);
  await page.click('[data-settings-tab="connections"]');
  await expect(page.locator('#settings-shopify-card')).toBeHidden();
  await expect(page.locator('#dash-content')).toContainText(/Sell merchandise\?/, { useInnerText: true });
  await expect(page.locator('#dash-content')).not.toContainText('Shopify Store', { useInnerText: true });
  // The connect form stays one click away for a charity that does sell merch.
  await page.click('#settings-shopify-reveal');
  await expect(page.locator('#settings-shopify-card')).toBeVisible();
});

test('commerce client: Connections tab shows the Shopify card connected to the store', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  await page.goto(`${srv.base}/portal.html#settings/connections`);
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('#settings-shopify-card')).toBeVisible();
  await expect(page.locator('#settings-shopify-card')).toContainText('owner-co.myshopify.com');
  expect(await page.locator('#settings-shopify-reveal').count()).toBe(0);
});

for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`every sidebar item renders without runtime errors at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    await mockApi(page, srv.base);
    await login(page, srv.base);
    const mobile = vp.width < 1024;
    for (const nav of EXPECTED_NAVS) {
      if (mobile) {
        await page.click('#dash-mobile-toggle');
        await expect(page.locator('#dash-sidebar')).toHaveClass(/open/);
      }
      const btn = page.locator(`.dash-nav-item[data-nav="${nav}"]`);
      await btn.click();
      await expect(btn).toHaveClass(/active/);
      if (mobile) await expect(page.locator('#dash-sidebar')).not.toHaveClass(/open/);
      await page.waitForTimeout(250);
      // Something rendered.
      expect((await page.locator('#dash-content').innerText()).trim().length, nav).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test('Create: segmented control switches between Video & Post and Animate and remembers the choice', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  const seg = page.locator('#create-segments');
  await expect(seg).toBeVisible();
  await expect(seg.locator('[data-segment]')).toHaveText(['Video & Post', 'Animate']);
  await expect(seg.locator('[data-segment="creation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content')).toContainText(/Video \+ Post from your catalog/i);
  await expect(page.locator('#dash-breadcrumb-label')).toHaveText('Create');

  await seg.locator('[data-segment="animation-studio"]').click();
  await expect(seg.locator('[data-segment="animation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => location.hash)).toBe('#create/animate');
  expect(await page.evaluate(() => localStorage.getItem('se_create_segment'))).toBe('animation-studio');

  // Leaving Create hides the strip and clears the hash; coming back restores Animate.
  await page.click('.dash-nav-item[data-nav="dashboard"]');
  await expect(seg).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe('');
  await page.click('.dash-nav-item[data-nav="create"]');
  await expect(seg.locator('[data-segment="animation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
});

test('switchNav aliases: animation-studio lands on Create → Animate, brand-voice on Settings → Brand', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('animation-studio'));
  await expect(page.locator('.dash-nav-item[data-nav="create"]')).toHaveClass(/active/);
  await expect(page.locator('#create-segments [data-segment="animation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => window.switchNav('creation-studio'));
  await expect(page.locator('#create-segments [data-segment="creation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content')).toContainText(/Video \+ Post from your catalog/i);

  await page.evaluate(() => window.switchNav('brand-voice'));
  await expect(page.locator('.dash-nav-item[data-nav="settings"]')).toHaveClass(/active/);
  await expect(page.locator('[data-settings-tab="brand"]')).toHaveClass(/active/);
  await expect(page.locator('#settings-brand-panel')).toContainText(/Brand Voice/);
  expect(await page.evaluate(() => location.hash)).toBe('#settings/brand');
});

test('Settings: four tabs, Brand first, each tab holds the sections it was promised', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="settings"]');
  await expect(page.locator('[data-settings-tab]')).toHaveText(['Brand', 'Account', 'Connections', 'Billing']);
  await expect(page.locator('[data-settings-tab="brand"]')).toHaveClass(/active/);
  await expect(page.locator('#settings-brand-panel')).toContainText(/Brand Voice/);

  const panel = (name) => page.locator(`.settings-panel[data-settings-panel="${name}"]`);
  await page.click('[data-settings-tab="account"]');
  await expect(panel('account')).toBeVisible();
  await expect(panel('account')).toContainText(/Account/);
  await expect(panel('account')).toContainText(/Security/);
  await expect(panel('account')).toContainText(/Target Platforms/);
  await expect(page.getByRole('button', { name: /Update Password/i })).toBeVisible();
  await expect(panel('billing')).toBeHidden();

  await page.click('[data-settings-tab="connections"]');
  await expect(panel('connections')).toBeVisible();
  await expect(panel('connections')).toContainText(/Instagram/);
  await expect(panel('connections')).toContainText(/TikTok/);
  await expect(panel('connections')).toContainText(/Facebook/);
  await expect(page.getByRole('button', { name: /Update Password/i })).toBeHidden();

  await page.click('[data-settings-tab="billing"]');
  await expect(panel('billing')).toBeVisible();
  await expect(panel('billing')).toContainText(/Current Plan/i);
  await expect(panel('billing')).toContainText(/Subscription & Support/);
  await expect(page.locator('#settings-cancel-btn')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#settings/billing');
});

test('deep link #settings/billing opens Settings on the Billing tab after login', async ({ page }) => {
  await mockApi(page, srv.base);
  await page.goto(`${srv.base}/portal.html#settings/billing`);
  await page.fill('#login-email', 'owner@example.com');
  await page.fill('#login-password', 'Correct-Horse-2026!');
  await page.click('#login-btn');
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('.dash-nav-item[data-nav="settings"]')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('[data-settings-tab="billing"]')).toHaveClass(/active/);
  await expect(page.locator('#dash-content')).toContainText('Current Plan');
});

test('copy: Content page is "Content Review", schedule breadcrumb is "Calendar", inbox is "Inbox"', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await expect(page.locator('#dash-content h2').first()).toHaveText(/Content Review/);
  await expect(page.locator('#dash-content')).not.toContainText('Content Studio');
  await page.click('.dash-nav-item[data-nav="schedule"]');
  await expect(page.locator('#dash-breadcrumb-label')).toHaveText('Calendar');
  await page.click('.dash-nav-item[data-nav="inbox"]');
  await expect(page.locator('#dash-breadcrumb-label')).toHaveText('Inbox');
});
