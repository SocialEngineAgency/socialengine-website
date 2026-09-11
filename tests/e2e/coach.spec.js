// Coach layout (design §4): the composer is always on screen, the message list
// is the only scroller, chips collapse after the first message.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

async function composerInViewport(page) {
  const box = await page.locator('#chat-input').boundingBox();
  const vp = page.viewportSize();
  expect(box, 'composer has a box').toBeTruthy();
  expect(box.y, 'composer top inside viewport').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `composer bottom ${box.y + box.height} inside viewport ${vp.height}`).toBeLessThanOrEqual(vp.height + 0.5);
  expect(box.x + box.width, 'composer right inside viewport').toBeLessThanOrEqual(vp.width + 0.5);
}

for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`composer stays inside the viewport at ${vp.width}x${vp.height}, before and after 20 messages`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    await mockApi(page, srv.base, {
      onRequest: (entry, route, json) => {
        if (entry.path === '/api/chat/v2') { json(200, { reply: 'Reply ' + 'lorem ipsum '.repeat(40) }); return 'handled'; }
        return undefined;
      },
    });
    await login(page, srv.base);
    if (vp.width < 1024) await page.click('#dash-mobile-toggle');
    await page.click('.dash-nav-item[data-nav="ai-coach"]');
    await expect(page.locator('#chat-input')).toBeVisible();
    await composerInViewport(page);

    // Page itself must not scroll — the message list is the scroller.
    const pageScroll = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
    expect(pageScroll, 'document should not overflow the viewport').toBeLessThanOrEqual(1);

    const chips = page.locator('#chat-suggestions');
    await expect(chips).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await page.fill('#chat-input', `Message ${i} ${'words '.repeat(30)}`);
      await page.click('#chat-send');
      await expect(page.locator('.chat-msg--user')).toHaveCount(i + 1);
      await expect(page.locator('.chat-msg--ai:not(.chat-msg--typing)')).toHaveCount(i + 2, { timeout: 10000 }); // welcome + replies
    }
    await expect(chips).toBeHidden();
    await composerInViewport(page);
    const m = await page.evaluate(() => {
      const el = document.getElementById('chat-messages');
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 40 };
    });
    expect(m.scrollHeight, 'messages overflow their own box').toBeGreaterThan(m.clientHeight);
    expect(m.atBottom, 'auto-scrolled to the newest message').toBe(true);
    const pageScrollAfter = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
    expect(pageScrollAfter, 'document still does not overflow').toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('textarea grows to six rows then scrolls', async ({ page }) => {
  await mockApi(page, srv.base);
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  const input = page.locator('#chat-input');
  const one = (await input.boundingBox()).height;
  await input.fill(Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'));
  await input.dispatchEvent('input');
  const tall = (await input.boundingBox()).height;
  expect(tall).toBeGreaterThan(one * 3);
  const maxPx = await input.evaluate((el) => parseFloat(getComputedStyle(el).maxHeight));
  expect(tall).toBeLessThanOrEqual(maxPx + 1);
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await composerInViewport(page);
});
