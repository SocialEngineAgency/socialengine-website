// New look (graphite redesign): off unless switched on with ?look=new; the rail keeps every
// page reachable, the ⌘K bar jumps between pages, Day/Dark sticks, inline navy and purple
// map to the new palette, and ?look=old switches it off again. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const rgb = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

test('old look stays the default; nothing from the new look shows', async ({ page }) => {
  await mockApi(page, srv.base, { data: clientData() });
  await login(page, srv.base);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  await expect(page.locator('.nl-cmd')).toBeHidden();
  await expect(page.locator('.nl-theme-btn')).toHaveCount(0);
  expect(await rgb(page, '.dash-sidebar', 'width')).not.toBe('68px');
});

test('?look=new: icon rail, jump bar, Day/Dark that sticks, palette mapped, ?look=old turns it off', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { data: clientData() });
  await page.goto(`${srv.base}/portal.html?look=new`);
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  await login(page, srv.base); // a plain reload: the look is remembered
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  await expect(page.locator('html')).toHaveAttribute('data-nl-theme', 'dark');

  // Rail: 68px, every page still there with its name as the label.
  expect(await rgb(page, '.dash-sidebar', 'width')).toBe('68px');
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveAttribute('data-nl-label', 'Calendar');
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveAttribute('aria-label', 'Calendar');
  expect(await rgb(page, 'body', 'backgroundColor')).toBe('rgb(13, 14, 17)');

  // Jump bar: Ctrl+K, type, Enter.
  await page.keyboard.press('Control+k');
  await expect(page.locator('#nl-cmd-input')).toBeFocused();
  await page.keyboard.type('calen');
  await expect(page.locator('#nl-cmd-list')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveClass(/active/);

  // Inline colours follow the palette, including ones added later.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'nl-probe';
    d.style.cssText = 'background:#0A1628;color:rgba(255,255,255,0.6);border:1px solid rgba(124,58,237,0.25)';
    d.innerHTML = '<span id="nl-btn" style="background:#7C3AED;color:#fff">Go</span>';
    document.body.appendChild(d);
  });
  await expect.poll(() => rgb(page, '#nl-probe', 'backgroundColor')).not.toBe('rgb(10, 22, 40)');
  const probeBg = await rgb(page, '#nl-probe', 'backgroundColor');
  const [r, g, b] = probeBg.match(/\d+/g).map(Number);
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10); // graphite, not navy
  expect(await rgb(page, '#nl-btn', 'backgroundColor')).toBe('rgb(157, 140, 255)');

  // Day: paper surfaces, ink text, a button label on violet stays light. Remembered.
  await page.click('.nl-theme-btn');
  await expect(page.locator('html')).toHaveAttribute('data-nl-theme', 'day');
  expect(await rgb(page, 'body', 'backgroundColor')).toBe('rgb(244, 243, 239)');
  const dayBg = (await rgb(page, '#nl-probe', 'backgroundColor')).match(/\d+/g).map(Number);
  expect(Math.min(...dayBg.slice(0, 3))).toBeGreaterThan(230);
  const dayText = (await rgb(page, '#nl-probe', 'color')).match(/\d+/g).map(Number);
  expect(Math.max(...dayText.slice(0, 3))).toBeLessThan(60);
  expect(await rgb(page, '#nl-btn', 'backgroundColor')).toBe('rgb(91, 71, 214)');
  expect(await rgb(page, '#nl-btn', 'color')).toBe('rgb(255, 255, 255)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-nl-theme', 'day');

  // Back to Dark maps from the originals, not from the Day colours.
  await page.evaluate(() => window.seNewLook.theme('dark'));
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'nl-probe2';
    d.style.cssText = 'color:#94A3B8';
    document.body.appendChild(d);
  });
  await expect.poll(() => rgb(page, '#nl-probe2', 'color')).not.toBe('rgb(148, 163, 184)');
  const [r2, , b2] = (await rgb(page, '#nl-probe2', 'color')).match(/\d+/g).map(Number);
  expect(r2).toBeGreaterThan(150); // light grey, as in Dark
  expect(r2).toBeGreaterThan(b2); // warm, not slate

  await page.goto(`${srv.base}/portal.html?look=old`);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  await page.goto(`${srv.base}/portal.html`);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  expect(errors).toEqual([]);
});

test('new look Calendar: platform tabs and filter, live ring, counts, key dates and unscheduled in the aside', async ({ page }) => {
  const errors = watchErrors(page);
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const content = [
    { id: 'rec1', status: 'Scheduled', caption: 'Walk on Sunday', platform: 'Instagram', scheduled_date: `${ym}-10T09:00:00.000Z` },
    { id: 'rec2', status: 'Ready for Review', caption: 'Nurse spotlight', platform: 'TikTok', scheduled_date: `${ym}-11` },
    { id: 'rec3', status: 'Approved', caption: 'Five questions for your GP', platform: 'Facebook' },
  ];
  await mockApi(page, srv.base, {
    data: clientData({ content, posts: content }),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/calendar-history') { json(200, { posts: [{ id: 'ig_9', platform: 'instagram', timestamp: `${ym}-12T12:00:00.000Z`, caption: 'Thank you all', status: 'Published' }] }); return 'handled'; }
      if (entry.path === '/api/marketing/key-dates' && entry.method === 'GET') { json(200, { country: 'GB', country_known: true, countries: [{ code: 'GB', name: 'United Kingdom' }], dates: [{ date: `${ym}-20`, name: 'Kindness Day', type: 'awareness' }] }); return 'handled'; }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  await expect(page.locator('.nl-cal h1')).toHaveText('Calendar');
  await expect(page.locator('#nl-cal-sub')).toContainText('1 scheduled · 1 needs review');

  const ig = page.locator(`[data-bq-drop-day="${ym}-10"] .nl-ev`);
  await expect(ig).toHaveClass(/nl-ev--instagram/);
  await expect(ig.locator('.nl-dot')).toHaveClass(/nl-dot--scheduled/);
  await expect(page.locator(`[data-bq-drop-day="${ym}-11"] .nl-ev .nl-dot`)).toHaveClass(/nl-dot--review/);
  await expect(page.locator(`[data-bq-drop-day="${ym}-12"] .nl-ev .nl-dot`)).toHaveClass(/nl-dot--live/);

  await page.click('[data-nl-plat="tiktok"]');
  await expect(page.locator('[data-nl-plat="tiktok"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-bq-drop-day="${ym}-10"] .nl-ev`)).toHaveCount(0);
  await expect(page.locator(`[data-bq-drop-day="${ym}-11"] .nl-ev`)).toHaveCount(1);
  await page.click('[data-nl-plat="all"]');
  await expect(page.locator(`[data-bq-drop-day="${ym}-10"] .nl-ev`)).toHaveCount(1);

  await expect(page.locator('.nl-cal__aside #key-dates-strip .kd-tile').first()).toContainText('20');
  await expect(page.locator(`[data-bq-drop-day="${ym}-20"] .kd-badge`)).toBeVisible();
  await expect(page.locator('#nl-unsched')).toContainText('Five questions for your GP');

  await page.click(`[data-bq-drop-day="${ym}-10"] .nl-ev`);
  await expect(page.locator('#schedule-date-panel')).toHaveCSS('right', '0px');
  expect(errors).toEqual([]);
});
