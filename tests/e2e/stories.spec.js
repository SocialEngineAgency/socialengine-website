// Instagram Stories composer (P3.1), opened from the Calendar planner. Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function plan(storiesPosted = 0) {
  return {
    week_start: '2026-10-05', week_end: '2026-10-11', today: '2026-10-09', mode: 'grow',
    mode_info: { id: 'grow', label: 'Grow', focus: "Reach people who don't follow you yet", kpis: [{ id: 'reach', label: 'Reach', why: 'x' }] },
    settings: { reels_per_week: 4, feed_per_week: 2, stories_per_day: 1, default_mode: 'grow' },
    limits: { reels_per_week: [0, 7], feed_per_week: [0, 7], stories_per_day: [0, 8] },
    targets: { reels: 4, feed: 2, stories_per_day: 1 },
    counts: { reels: { filled: 0, in_review: 0, target: 4 }, feed: { filled: 0, in_review: 0, target: 2 } },
    slots: [{ date: '2026-10-11', format: 'reel', goal: 'grow', story_type: 'pov', story_type_label: 'POV', status: 'open', post_id: null }],
    stories: { per_day: 1, frames: '3–8 frames each', tracked: true, posted: storiesPosted, planned: 0, target: 7, days: [], note: 'Counts Stories made in SocialEngine.' },
    quiet_streak: { weeks: 0 },
  };
}

const STICKERS = { poll: { label: 'Poll' }, quiz: { label: 'Quiz' }, question: { label: 'Questions' }, add_yours: { label: 'Add Yours' }, slider: { label: 'Emoji slider' }, link: { label: 'Link' }, music: { label: 'Music' } };

const AI_DRAFT = {
  story_type: 'tutorial', goal: 'grow', topic: 'planting', mode: 'phone',
  highlight: { name: 'How to', cover_text: '' },
  frames: [
    { text: 'Plant a tree in 3 steps', sub: '', bg: { color: '#16A34A', image_url: '' }, sticker: null },
    { text: 'Dig twice as wide as the roots', sub: '', bg: { color: '#16A34A', image_url: '' }, sticker: null },
    { text: 'Water deeply, then mulch', sub: '', bg: { color: '#16A34A', image_url: '' }, sticker: null },
    { text: 'Would you plant one?', sub: '', bg: { color: '#16A34A', image_url: '' }, sticker: { type: 'poll', prompt: 'Plant one this month?', options: ['Yes', 'Maybe'] } },
  ],
};

function savedStory(draft, overrides = {}) {
  const phone = draft.frames.some((f) => f.sticker);
  return {
    id: 'recSTORY000000001', status: 'Ready for Review', date: '2026-10-09', time: '09:00',
    mode: phone ? 'phone' : 'auto', draft: { ...draft, mode: phone ? 'phone' : 'auto' },
    frame_urls: draft.frames.map((_, i) => `https://cdn.example.test/f${i + 1}.jpg`),
    published_count: 0,
    checklist: phone ? ['Download the 4 frames to your phone.', 'Frame 4: add a Poll sticker in the empty space below the text — "Plant one this month?"', 'Back in SocialEngine: click "Mark as posted".'] : [],
    ...overrides,
  };
}

test('Planner → Make a Story → AI draft with a poll → phone mode → save → checklist → Mark as posted refreshes the planner', async ({ page }) => {
  let posted = 0;
  let stories = [];
  const saves = [];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/meta-planner' && entry.method === 'GET') { json(200, plan(posted)); return 'handled'; }
      if (entry.path === '/api/calendar-history') { json(200, { posts: [] }); return 'handled'; }
      if (entry.path === '/api/stories/draft') { json(200, { draft: AI_DRAFT, validation: { ok: true, errors: [], warnings: ['Frame 1 hook is fine'], mode: 'phone' } }); return 'handled'; }
      if (entry.path === '/api/stories' && entry.method === 'GET') { json(200, { stories, stickers: STICKERS }); return 'handled'; }
      if (entry.path === '/api/stories' && entry.method === 'POST') {
        const body = JSON.parse(entry.body || '{}');
        saves.push(body);
        const s = savedStory(body.draft);
        stories = [s];
        json(200, { story: s, validation: { ok: true, errors: [], warnings: [] } });
        return 'handled';
      }
      if (/\/api\/stories\/recSTORY000000001\/mark-posted$/.test(entry.path)) {
        posted = 1;
        stories = [{ ...stories[0], status: 'Published' }];
        json(200, { story: stories[0] });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  const card = page.locator('#meta-week-planner');
  await expect(card.locator('.mwp__meter--stories')).toContainText('0/7');
  await card.locator('[data-mwp-story="new"]').click();

  const modal = page.locator('.sc-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#sc-type')).toHaveValue('pov');
  await page.fill('#sc-topic', 'planting');
  await page.click('#sc-ai');
  await expect(page.locator('#sc-frames .sc-fchip[data-sc-frame]')).toHaveCount(4);
  await expect(page.locator('#sc-mode')).toContainText('Post from phone');
  await expect(page.locator('#sc-preview')).toContainText('Plant a tree in 3 steps');

  await page.locator('[data-sc-frame="3"]').click();
  await expect(page.locator('#sc-sticker')).toHaveValue('poll');
  await expect(page.locator('#sc-preview .sc-psticker')).toContainText('Poll sticker');

  await page.click('#sc-save');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].draft.frames).toHaveLength(4);
  expect(saves[0].draft.frames[3].sticker).toMatchObject({ type: 'poll', options: ['Yes', 'Maybe'] });
  expect(saves[0].date).toBe('2026-10-09');

  const story = page.locator('.sc-card[data-sc-story="recSTORY000000001"]');
  await expect(story).toContainText('Post from phone');
  await expect(story.locator('.sc-thumbs img')).toHaveCount(4);
  await expect(story.locator('.sc-check')).toContainText('Poll sticker');
  await expect(story.locator('[data-sc-dl]')).toBeVisible();

  await story.locator('[data-sc-posted]').click();
  await expect(story).toContainText('Published');
  await expect(card.locator('.mwp__meter--stories')).toContainText('1/7');
});

test('Manual Story: server rejection is shown; an auto Story offers Post now', async ({ page }) => {
  let stories = [];
  let reject = true;
  const approvals = [];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/meta-planner' && entry.method === 'GET') { json(200, plan(0)); return 'handled'; }
      if (entry.path === '/api/calendar-history') { json(200, { posts: [] }); return 'handled'; }
      if (entry.path === '/api/stories' && entry.method === 'GET') { json(200, { stories, stickers: STICKERS }); return 'handled'; }
      if (entry.path === '/api/stories' && entry.method === 'POST') {
        const body = JSON.parse(entry.body || '{}');
        if (reject) {
          reject = false;
          json(422, { error: 'Frame 3 is empty — add text or a background image.', code: 'STORY_INVALID', validation: { ok: false, errors: ['Frame 3 is empty — add text or a background image.'], warnings: [] } });
          return 'handled';
        }
        const s = savedStory(body.draft);
        stories = [s];
        json(200, { story: s, validation: { ok: true, errors: [], warnings: [] } });
        return 'handled';
      }
      if (entry.path === '/api/approve-post') {
        approvals.push(JSON.parse(entry.body || '{}'));
        stories = [{ ...stories[0], status: 'Published' }];
        json(200, { success: true, status: 'Published', message: 'Post approved and published.' });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  await page.locator('#meta-week-planner [data-mwp-story="new"]').click();

  await expect(page.locator('#sc-save')).toBeDisabled();
  await page.fill('#sc-text', 'Three things nobody tells new volunteers');
  await expect(page.locator('#sc-save')).toBeEnabled();
  await expect(page.locator('#sc-mode')).toContainText('Auto-publish');
  await page.locator('[data-sc-frame="1"]').click();
  await page.fill('#sc-text', 'Bring water');

  await page.click('#sc-save');
  await expect(page.locator('#sc-msgs')).toContainText('Frame 3 is empty');

  await page.locator('[data-sc-frame="2"]').click();
  await page.fill('#sc-text', 'Wear real shoes');
  await page.click('#sc-save');
  const story = page.locator('.sc-card[data-sc-story="recSTORY000000001"]');
  await expect(story).toContainText('Auto-publish');
  await story.locator('[data-sc-now]').click();
  await expect.poll(() => approvals.length).toBe(1);
  expect(approvals[0]).toEqual({ postId: 'recSTORY000000001', publishNow: true });
  await expect(story).toContainText('Published');
});
