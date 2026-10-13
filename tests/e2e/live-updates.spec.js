// Live updates: the API pushes "post X changed" over Server-Sent Events and the
// portal re-reads just that post (/api/posts?ids=), so a new or deleted post
// shows up on Content Review without pressing Refresh. Hermetic (mocked API).
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

function sse(events) {
  return events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

test('a pushed change adds a new post and drops a deleted one, with no full reload', async ({ page }) => {
  const data = clientData({ content: [
    { id: 'recKeep1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Stays put' },
    { id: 'recGone1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'About to be deleted' },
  ] });
  let streamOpen = false;
  let pushed = false;
  const fetchedIds = [];
  const calls = await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/events/ticket') { json(200, { ticket: 't1', url: '/api/events?ticket=t1', expires_in: 60 }); return 'handled'; }
      if (entry.path === '/api/events') {
        // First connection: wait until the test says go, then push two hints.
        const events = [['ready', { id: 1 }]];
        if (streamOpen && !pushed) { pushed = true; events.push(['post', { id: 'recNew1', kind: 'created' }], ['post', { id: 'recGone1', kind: 'deleted' }]); }
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(events) });
        return 'handled';
      }
      if (entry.path === '/api/posts') {
        const ids = new URL(route.request().url()).searchParams.get('ids').split(',');
        fetchedIds.push(...ids);
        const posts = ids.includes('recNew1') ? [{ id: 'recNew1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Fresh from the generator' }] : [];
        json(200, { posts, missing: ids.filter((id) => id !== 'recNew1'), next_cursor: null, total: posts.length });
        return 'handled';
      }
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await expect(page.locator('.studio-card[data-post-id="recGone1"]')).toBeVisible();
  const clientDataBefore = calls.filter((c) => c.path === '/api/client-data').length;

  streamOpen = true; // the next (re)connection carries the hints
  await expect(page.locator('.studio-card[data-post-id="recNew1"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.studio-card[data-post-id="recGone1"]')).toHaveCount(0);
  await expect(page.locator('.studio-card[data-post-id="recKeep1"]')).toBeVisible();
  expect(fetchedIds.sort()).toEqual(['recGone1', 'recNew1']);
  expect(calls.filter((c) => c.path === '/api/client-data').length, 'no full reload').toBe(clientDataBefore);
  expect(calls.some((c) => c.path === '/api/events/ticket' && c.method === 'POST')).toBe(true);
});

test('no live updates when the server has none (old API): no retries, nothing breaks', async ({ page }) => {
  const calls = await mockApi(page, srv.base, {
    data: clientData({ content: [{ id: 'recA', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Hello' }] }),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/events/ticket') { json(404, { error: 'Not found' }); return 'handled'; }
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await expect(page.locator('.studio-card[data-post-id="recA"]')).toBeVisible();
  await page.waitForTimeout(2500);
  expect(calls.filter((c) => c.path === '/api/events/ticket').length).toBe(1);
  expect(calls.filter((c) => c.path === '/api/events').length).toBe(0);
});
