// Inbox: conversation list + thread on the stored inbox. Hermetic.
// Sort, filters, search, unread, done, sending, the 24-hour note, phone layout.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

function seed() {
  return [
    { id: 'instagram:new', type: 'dm', platform: 'instagram', username: 'maya.k', text: 'Do you ship to Canada?', timestamp: ago(0.01), last_inbound_at: ago(0.01), created_time: ago(0.02), needs_reply: true, unread: true, status: 'open', recipient_id: 'u-maya',
      thread: [{ id: 'm1', text: 'Do you ship to Canada?', timestamp: ago(0.01), from_us: false, username: 'maya.k' }] },
    { id: 'instagram:old49', type: 'dm', platform: 'instagram', username: 'old.friend', text: 'Are you open on Sundays?', timestamp: ago(49), last_inbound_at: ago(49), created_time: ago(49), needs_reply: true, unread: true, status: 'open', recipient_id: 'u-old',
      thread: [{ id: 'm2', text: 'Are you open on Sundays?', timestamp: ago(49), from_us: false, username: 'old.friend' }] },
    { id: 'fbc1', type: 'comment', platform: 'facebook', username: 'Jess L', text: 'Ordered Friday, no tracking yet', timestamp: ago(1), last_inbound_at: ago(1), created_time: ago(1), needs_reply: true, unread: false, status: 'open', post_caption: 'Weekend restock',
      thread: [{ id: 'fbc1', text: 'Ordered Friday, no tracking yet', timestamp: ago(1), from_us: false, username: 'Jess L' }] },
    { id: 'instagram:done1', type: 'dm', platform: 'instagram', username: 'theo.g', text: 'Thanks!', timestamp: ago(2), needs_reply: false, unread: false, status: 'open', is_from_us: true,
      thread: [{ id: 'm3', text: 'Restock lands Friday.', timestamp: ago(2), from_us: true, username: 'You' }] },
  ];
}

async function setup(page) {
  const items = seed();
  const posts = [];
  const queries = [];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/inbox' && entry.method === 'GET') {
        const q = new URL(route.request().url()).searchParams;
        queries.push(Object.fromEntries(q.entries()));
        let list = items.slice();
        const status = q.get('status') || 'all';
        if (status === 'needs_reply') list = list.filter((i) => i.status === 'open' && i.needs_reply);
        if (status === 'done') list = list.filter((i) => i.status === 'done');
        if (q.get('platform')) list = list.filter((i) => i.platform === q.get('platform'));
        if (q.get('type')) list = list.filter((i) => i.type === q.get('type'));
        if (q.get('q')) list = list.filter((i) => `${i.username} ${i.text}`.toLowerCase().includes(q.get('q').toLowerCase()));
        list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (q.get('sort') === 'oldest') list.reverse();
        const counts = {
          all: items.length,
          needs_reply: items.filter((i) => i.status === 'open' && i.needs_reply).length,
          done: items.filter((i) => i.status === 'done').length,
          dm: items.filter((i) => i.type === 'dm').length, comment: 1, mention: 0,
        };
        json(200, { connected: true, total: items.length, unreplied: counts.needs_reply, counts, items: list, has_more: false, source: 'meta', sync: { quick_at: ago(0), deep_at: ago(0), deep_running: false, oldest_at: ago(49) }, ranking_tip: 'Replying helps.', auto_reply_enabled: false, auto_reply_mode: 'draft' });
        return 'handled';
      }
      if (entry.path === '/api/inbox/state') {
        const b = JSON.parse(entry.body || '{}');
        posts.push({ path: entry.path, body: b });
        for (const id of b.ids) {
          const it = items.find((i) => i.id === id);
          if (!it) continue;
          if (b.status) it.status = b.status;
          if (b.read !== undefined) it.unread = !b.read;
        }
        json(200, { success: true, counts: { needs_reply: items.filter((i) => i.status === 'open' && i.needs_reply).length, done: items.filter((i) => i.status === 'done').length } });
        return 'handled';
      }
      if (entry.path === '/api/inbox/reply') {
        const b = JSON.parse(entry.body || '{}');
        posts.push({ path: entry.path, body: b });
        json(200, { success: true, message_id: 'mid.9', message: 'Message sent.' });
        return 'handled';
      }
      if (entry.path === '/api/inbox/canned-responses') { json(200, { canned: [{ id: 'q1', label: 'Shipping', text: 'We ship worldwide in 5 to 7 days.' }] }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="inbox"]');
  return { items, posts, queries };
}

test('needs reply first, sort oldest, filter by platform, search', async ({ page }) => {
  const { queries } = await setup(page);
  const rows = page.locator('#inbox-list .inbox-item');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.inbox-filter.active')).toContainText('Needs reply');
  await expect(rows.first()).toContainText('maya.k');
  await expect(page.locator('.inbox-item[data-item-id="instagram:old49"]')).toContainText('Waiting 7w');
  await expect(page.locator('#inbox-list')).not.toContainText('theo.g');

  await page.selectOption('#inbox-sort', 'oldest');
  await expect(rows.first()).toContainText('old.friend');
  expect(queries[queries.length - 1].sort).toBe('oldest');

  await page.selectOption('#inbox-platform', 'facebook');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Jess L');
  await page.selectOption('#inbox-platform', '');

  await page.fill('#inbox-search', 'sunday');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('old.friend');
  await page.fill('#inbox-search', '');
  await expect(rows).toHaveCount(3);

  await page.click('.inbox-filter[data-status="all"]');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('.ibx-foot')).toContainText('Messages back to');
});

test('opening marks read; reply sends with the inbox id; done moves it out of Needs reply', async ({ page }) => {
  const { posts } = await setup(page);
  const maya = page.locator('.inbox-item[data-item-id="instagram:new"]');
  await expect(maya.locator('.ibx-dot')).toHaveCount(1);
  await maya.click();
  const thread = page.locator('#inbox-thread-pane');
  await expect(thread.locator('.ibx-thread-name')).toHaveText('@maya.k');
  await expect(thread).toContainText('Do you ship to Canada?');
  await expect(maya.locator('.ibx-dot')).toHaveCount(0);
  await expect.poll(() => posts.find((p) => p.body.read === true)?.body.ids).toEqual(['instagram:new']);

  await thread.locator('.inbox-canned-chip', { hasText: 'Shipping' }).click();
  await expect(thread.locator('.inbox-reply-text')).toHaveValue('We ship worldwide in 5 to 7 days.');
  await thread.locator('.inbox-send-btn').click();
  await expect(thread.locator('.ibx-msg.me')).toContainText('We ship worldwide');
  const sent = posts.find((p) => p.path === '/api/inbox/reply');
  expect(sent.body).toMatchObject({ itemId: 'instagram:new', inboxId: 'instagram:new', itemType: 'dm', recipient_id: 'u-maya' });
  await expect(maya.locator('.ibx-wait')).toHaveCount(0);

  await thread.locator('#inbox-done-btn').click();
  await expect(page.locator('#inbox-list .inbox-item[data-item-id="instagram:new"]')).toHaveCount(0);
  expect(posts.find((p) => p.body.status === 'done').body.ids).toEqual(['instagram:new']);
  await expect(thread.locator('.ibx-thread-name')).not.toHaveText('@maya.k');

  await page.click('.inbox-filter[data-status="done"]');
  await expect(page.locator('#inbox-list .inbox-item')).toHaveCount(1);
  await page.locator('#inbox-list .inbox-item').first().click();
  await expect(page.locator('#inbox-done-btn')).toContainText('Reopen');
});

test('a DM older than 24 hours explains the reply window', async ({ page }) => {
  await setup(page);
  await page.locator('.inbox-item[data-item-id="instagram:old49"]').click();
  await expect(page.locator('#inbox-thread-pane .ibx-window')).toContainText('more than 24 hours ago');
  await expect(page.locator('#inbox-thread-pane .ibx-window a')).toHaveAttribute('href', 'https://www.instagram.com/direct/inbox/');
});

test('on a phone the list and the conversation take turns', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#inbox-list .inbox-item').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const list = page.locator('.ibx-list');
  const thread = page.locator('#inbox-thread-pane');
  await expect(list).toBeVisible();
  await expect(thread).toBeHidden();
  await page.locator('.inbox-item[data-item-id="fbc1"]').click();
  await expect(thread).toBeVisible();
  await expect(list).toBeHidden();
  await expect(thread).toContainText('On your post: Weekend restock');
  await page.click('#inbox-back-btn');
  await expect(list).toBeVisible();
});
