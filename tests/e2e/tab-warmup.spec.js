// Analytics and Calendar load their data in the background once the portal is up, so a click
// on either shows it at once, even when the server takes seconds. Hermetic: mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const SLOW_MS = 2500;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const noon = () => { const n = new Date(); n.setHours(12, 0, 0, 0); return n.toISOString(); };

const CARD = {
  clientType: 'charity', verdict: 'Reels are carrying the account.', kpis: { views: 184000, followers: 12480, eng_rate: 6.8, untagged: 0 },
  moves: { scale: [], test: [], kill: [] }, ranked: [], rows: [], sources: [{ id: 'instagram', status: 'connected' }], meta_connected: true,
};
const PLAN = {
  week_start: '2026-10-12', week_end: '2026-10-18', today: '2026-10-18', mode: 'grow',
  mode_info: { id: 'grow', label: 'Grow', focus: 'Reach people who do not follow you yet', kpis: [] },
  settings: { reels_per_week: 4, feed_per_week: 2, stories_per_day: 1, default_mode: 'grow' },
  limits: { reels_per_week: [0, 7], feed_per_week: [0, 7], stories_per_day: [0, 8] },
  targets: { reels: 4, feed: 2, stories_per_day: 1 },
  counts: { reels: { filled: 1, in_review: 0, target: 4 }, feed: { filled: 0, in_review: 0, target: 2 } },
  slots: [{ date: '2026-10-18', format: 'reel', goal: 'grow', story_type: 'pov', story_type_label: 'POV', status: 'open', post_id: null }],
  stories: { per_day: 1, frames: '3–8 frames each', tracked: false, note: '' },
};

async function setup(page, { look = 'new' } = {}) {
  const counts = { scorecard: 0, history: 0, planner: 0, keyDates: 0 };
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/analytics/scorecard') { counts.scorecard += 1; await wait(SLOW_MS); json(200, CARD); return 'handled'; }
      if (entry.path === '/api/calendar-history') {
        counts.history += 1; await wait(SLOW_MS);
        json(200, { posts: [{ id: 'ig_1', platform: 'instagram', media_type: 'Image', timestamp: noon(), caption: 'Published from IG', status: 'Published', _source: 'social' }] });
        return 'handled';
      }
      if (entry.path === '/api/meta-planner' && entry.method === 'GET') { counts.planner += 1; await wait(SLOW_MS); json(200, PLAN); return 'handled'; }
      if (entry.path === '/api/marketing/key-dates') {
        counts.keyDates += 1; await wait(SLOW_MS);
        json(200, { country: 'GB', country_known: true, countries: [['GB', 'United Kingdom']], dates: [{ date: '2026-10-31', name: 'Halloween', type: 'cultural' }] });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript((l) => { try { localStorage.setItem('se-look2', l); } catch (_) {} }, look);
  await login(page, srv.base);
  return counts;
}

for (const look of ['new', 'old']) {
  test(`${look} look: after the portal settles, Analytics and Calendar open at once`, async ({ page }) => {
    const errors = watchErrors(page);
    const counts = await setup(page, { look });
    // The warm-up starts once the portal is idle and each request takes 2.5 s.
    await expect.poll(() => counts.scorecard === 1 && counts.history === 1 && counts.planner >= 1, { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(SLOW_MS + 600);

    let t = Date.now();
    await page.click('.dash-nav-item[data-nav="analytics"]');
    if (look === 'new') await expect(page.locator('.nl-an-kpi').first()).toBeVisible({ timeout: 800 });
    else await expect(page.locator('#analytics-body')).toContainText('184,000', { timeout: 800 });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(counts.scorecard, 'no second load right after the warm-up').toBe(1);

    t = Date.now();
    await page.click('.dash-nav-item[data-nav="schedule"]');
    await expect(page.locator('#sched-cal-wrap')).toContainText('Published from IG', { timeout: 800 });
    await expect(page.locator('#meta-week-planner .mwp__title')).toContainText('This week on Meta', { timeout: 800 });
    await expect(page.locator('#key-dates-strip')).toContainText('Halloween', { timeout: 800 });
    expect(Date.now() - t).toBeLessThan(1200);
    expect(counts.history, 'published posts warmed a moment ago are used as they are').toBe(1);
    expect(errors).toEqual([]);
  });
}

test('a click on Analytics while the warm-up is still loading waits for it instead of asking again', async ({ page }) => {
  const counts = await setup(page);
  await expect.poll(() => counts.scorecard, { timeout: 8000 }).toBe(1);
  await page.click('.dash-nav-item[data-nav="analytics"]');
  await expect(page.locator('.nl-an-kpi').first()).toBeVisible({ timeout: SLOW_MS + 1500 });
  expect(counts.scorecard).toBe(1);
  // Refresh still asks the server for new numbers.
  await page.click('#analytics-refresh');
  await expect.poll(() => counts.scorecard, { timeout: 4000 }).toBe(2);
});
