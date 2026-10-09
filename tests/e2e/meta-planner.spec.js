// Meta weekly mix planner on the Calendar (P1.1 / P1.2). Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function plan(mode = 'grow') {
  const grow = mode === 'grow';
  return {
    week_start: '2026-10-05',
    week_end: '2026-10-11',
    today: '2026-10-09',
    mode,
    mode_info: {
      id: mode,
      label: grow ? 'Grow' : 'Engage',
      focus: grow ? "Reach people who don't follow you yet" : 'Deepen the relationship with people who already follow you',
      kpis: grow
        ? [{ id: 'reach', label: 'Reach', why: 'x' }, { id: 'sends_per_reach', label: 'Sends ÷ reach', why: 'x' }]
        : [{ id: 'replies', label: 'Replies & comments', why: 'x' }],
    },
    settings: { reels_per_week: 4, feed_per_week: 2, stories_per_day: 1, default_mode: 'grow' },
    limits: { reels_per_week: [0, 7], feed_per_week: [0, 7], stories_per_day: [0, 8] },
    targets: { reels: grow ? 4 : 3, feed: 2, stories_per_day: grow ? 1 : 2 },
    counts: { reels: { filled: 2, in_review: 0, target: grow ? 4 : 3 }, feed: { filled: 0, in_review: 1, target: 2 } },
    slots: [
      { date: '2026-10-05', format: 'reel', goal: 'grow', story_type: 'bts', story_type_label: 'Behind the scenes', status: 'filled', post_id: 'rec1' },
      { date: '2026-10-06', format: 'feed', goal: mode, story_type: 'listicle', story_type_label: 'Listicle', status: 'in_review', post_id: 'rec2' },
      { date: '2026-10-07', format: 'reel', goal: mode, story_type: 'tutorial', story_type_label: 'Tutorial / how-to', status: 'missed', post_id: null },
      { date: '2026-10-08', format: 'feed', goal: mode, story_type: 'qa', story_type_label: 'Q&A', status: 'missed', post_id: null },
      { date: '2026-10-09', format: 'reel', goal: mode, story_type: 'facts_list', story_type_label: 'Facts list', status: 'filled', post_id: 'rec3' },
      { date: '2026-10-11', format: 'reel', goal: mode, story_type: 'pov', story_type_label: 'POV', status: 'open', post_id: null },
    ],
    stories: { per_day: grow ? 1 : 2, frames: '3–8 frames each', tracked: false, note: "SocialEngine can't publish Stories yet." },
    quiet_streak: { weeks: 1, last_week: { published: 2, target: 6 }, message: 'Last week you published 2 of 6 planned Meta posts.' },
  };
}

test('Calendar shows the week plan; Engage saves the week; an open Reel slot opens Animate with its story type', async ({ page }) => {
  let mode = 'grow';
  const posts = [];
  const data = clientData();
  data.story_types = [{ id: 'pov', label: 'POV' }, { id: 'bts', label: 'Behind the scenes' }];
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/meta-planner' && entry.method === 'GET') { json(200, plan(mode)); return 'handled'; }
      if (entry.path === '/api/meta-planner' && entry.method === 'POST') {
        const b = JSON.parse(entry.body || '{}');
        posts.push(b);
        if (b.mode) mode = b.mode;
        json(200, { success: true, plan: plan(mode) });
        return 'handled';
      }
      if (entry.path === '/api/calendar-history') { json(200, { posts: [] }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  const card = page.locator('#meta-week-planner');
  await expect(card.locator('.mwp__title')).toContainText('This week on Meta');
  await expect(card.locator('.mwp__quiet')).toContainText('2 of 6');
  await expect(card.locator('.mwp__slot')).toHaveCount(6);
  await expect(card.locator('.mwp__meter').first()).toContainText('2/4');

  await card.locator('[data-mwp-mode="engage"]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ week: '2026-10-05', mode: 'engage' });
  await expect(card.locator('[data-mwp-mode="engage"]')).toHaveClass(/is-on/);
  await expect(card.locator('.mwp__meter').first()).toContainText('2/3');

  await card.locator('.mwp__slot--open').click();
  await expect(page.locator('#anim-story-type')).toHaveValue('pov', { timeout: 15000 });
});
