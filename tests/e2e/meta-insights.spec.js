// Meta Insights lens in Analytics (P4.1–P4.3). Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const DEFS = {
  accounts_reached: { label: 'Accounts reached', def: 'Unique accounts that saw any of your content in the period.' },
  non_follower_reach: { label: 'Reach from non-followers', def: "Accounts reached that don't follow you — discovery." },
  sends_per_reach: { label: 'Sends ÷ reach', def: "Share of people reached who sent it on — Meta's strongest growth signal." },
  follows: { label: 'Follows', def: 'Accounts that followed you from this post.' },
  accounts_engaged: { label: 'Accounts engaged', def: 'x' },
  interactions: { label: 'Interactions', def: 'x' },
  interactions_per_reach: { label: 'Interactions ÷ reach', def: 'x' },
  comments: { label: 'Comments', def: 'x' },
  avg_watch_sec: { label: 'Avg watch time', def: 'Average seconds a Reel was watched per play.' },
  likes_per_reach: { label: 'Likes ÷ reach', def: 'x' },
};

function post(id, score, extra = {}) {
  return {
    id, permalink: `https://instagram.com/p/${id}`, format: 'reel', story_type: 'tutorial', opener: 'pov',
    first_line: `POV: post ${id}`, goal_score: score,
    metrics: { reach: 1200, sends_per_reach: 0.021, avg_watch_sec: 6.4, comments: 9 }, ...extra,
  };
}

function insights(goal = 'grow', brief = null) {
  return {
    connected: true, period: '30d', goal, definitions: DEFS, eligible: 8, brief,
    sources: { instagram: 'connected', facebook: 'basic', threads: 'export', whatsapp_channel: 'export' },
    scorecard: {
      goal, primary: goal, posts_measured: 8, reels_measured: 5,
      grow: [
        { id: 'accounts_reached', value: 5400 },
        { id: 'non_follower_reach', value: 2700, share: 0.5 },
        { id: 'sends_per_reach', value: 0.018, median: true },
        { id: 'follows', value: 31 },
      ],
      engage: [
        { id: 'accounts_engaged', value: 610 },
        { id: 'interactions', value: 980 },
        { id: 'interactions_per_reach', value: 0.06, median: true },
        { id: 'comments', value: 44 },
      ],
      reels: [{ id: 'avg_watch_sec', value: 5.2, median: true }, { id: 'likes_per_reach', value: 0.04, median: true }, { id: 'sends_per_reach', value: 0.02, median: true }],
    },
    winners: [post('w1', 92), post('w2', 81)],
    losers: [post('l1', 12, { story_type: 'facts_list', opener: 'generic', first_line: 'Check this out' })],
    patterns: {
      keep: [{ kind: 'story_type', value: 'tutorial', count: 2 }],
      avoid: [{ kind: 'story_type', value: 'facts_list', count: 1 }, { kind: 'fatigue', value: 'tutorial', count: 5, of: 8 }],
    },
  };
}

const BRIEF = {
  generated_at: '2026-10-09T10:00:00Z', goal: 'grow', week_start: '2026-10-12',
  summary: 'Tutorial reels with POV openers win; generic openers lose.',
  keep: ['Tutorial reels (2 of 3 winners)'], avoid: ['Generic "check this out" openers'],
  hooks_from_comments: ['Where do I sign up?'],
  ideas: [
    { date: '2026-10-13', format: 'reel', story_type: 'pov', goal: 'grow', hook: 'POV: your first volunteer shift', angle: 'Follow one volunteer from 8am.', why: 'POV openers win' },
    { date: '2026-10-15', format: 'feed', story_type: 'listicle', goal: 'grow', hook: '5 things nobody tells you', angle: 'Carousel of tips.', why: 'Saves' },
  ],
};

async function openInsights(page) {
  await page.click('.dash-nav-item[data-nav="analytics"]');
  await page.locator('[data-book="insights"]').click();
}

test('Insights lens shows Grow/Engage scorecards, definitions, winners/losers; goal pill refetches', async ({ page }) => {
  const gets = [];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/analytics/scorecard') { json(200, { empty: true, sources: [], rows: [], meta_connected: true }); return 'handled'; }
      if (entry.path === '/api/meta-insights' && entry.method === 'GET') {
        const goal = new URL(route.request().url()).searchParams.get('goal') || 'grow';
        gets.push(goal);
        json(200, insights(goal));
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await openInsights(page);
  const root = page.locator('#mi-root');
  await expect(root).toContainText('8 POSTS MEASURED');
  await expect(page.locator('#mi-panel-grow')).toContainText('THIS GOAL');
  await expect(page.locator('#mi-panel-grow')).toContainText('50% of reach');
  await expect(page.locator('#mi-panel-grow .mi-kpi').nth(2)).toHaveAttribute('title', /strongest growth signal/);
  await expect(page.locator('#mi-panel-reels')).toContainText('5.2s');
  await expect(page.locator('#mi-winners .mi-post')).toHaveCount(2);
  await expect(page.locator('#mi-losers')).toContainText('Check this out');
  await expect(page.locator('#mi-patterns')).toContainText('Resting Tutorial — 5 of your last 8 posts');
  await expect(page.locator('#mi-export-note')).toContainText('Threads and WhatsApp Channel');

  await page.locator('[data-mi-goal="engage"]').click();
  await expect(page.locator('#mi-panel-engage')).toContainText('THIS GOAL');
  expect(gets).toContain('engage');
});

test('Not connected shows the honest reason; Generate next week fills ideas and Make in Animate hands off', async ({ page }) => {
  let connected = false;
  let briefPosts = 0;
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/analytics/scorecard') { json(200, { empty: true, sources: [], rows: [], meta_connected: true }); return 'handled'; }
      if (entry.path === '/api/meta-insights' && entry.method === 'GET') {
        if (!connected) json(200, { connected: false, definitions: DEFS, reason: "Publishing-only connections can't read Meta Insights." });
        else json(200, insights('grow'));
        return 'handled';
      }
      if (entry.path === '/api/meta-insights/next-week-brief') { briefPosts += 1; json(200, { brief: BRIEF }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await openInsights(page);
  await expect(page.locator('#mi-not-connected')).toContainText("can't read Meta Insights");

  connected = true;
  await page.click('#analytics-refresh');
  await page.locator('#mi-brief-btn').click();
  await expect.poll(() => briefPosts).toBe(1);
  await expect(page.locator('#mi-brief')).toContainText('Tutorial reels with POV openers win');
  await expect(page.locator('#mi-brief')).toContainText('Where do I sign up?');
  await expect(page.locator('.mi-idea')).toHaveCount(2);

  await page.locator('[data-mi-make="animate"][data-mi-idea="0"]').click();
  await expect(page.locator('#anim-story-type')).toHaveValue('pov', { timeout: 15000 });
  await expect(page.locator('#anim-prompt')).toHaveValue(/POV: your first volunteer shift/, { timeout: 15000 });
});
