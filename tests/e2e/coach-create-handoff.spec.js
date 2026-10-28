// Main Coach "Create this now": shown only when this reply commits to making something, and on the Video tab
// the brief it fills is brought into view.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors, CHARITY_CAPS } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const BRIEF = 'Slow push-in on a runner at dawn, Cardiff castle behind, breath in the cold air, warm light.';
const CARDIFF = 'Here is your post: Lace up for the Cardiff Half Marathon 2027. Register now at the link in our bio and join Team OPA.\n\n'
  + 'Would you like me to build a carousel or a short reel around this to give it more reach? A carousel tends to perform well for race sign-ups.';

async function openCoach(page, replies) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, srv.base, {
    data: clientData({ capabilities: CHARITY_CAPS }),
    onRequest: (entry, route, json) => {
      if (entry.path === '/api/chat/v2') { json(200, replies.shift() || { reply: 'Okay.' }); return 'handled'; }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
}

async function ask(page, text) {
  const before = await page.locator('.chat-msg--ai').count();
  await page.fill('#chat-input', text);
  await page.click('#chat-send');
  await expect(page.locator('.chat-msg--ai')).toHaveCount(before + 1, { timeout: 10000 });
  return page.locator('.chat-msg--ai').last();
}

test('a reply offering a carousel or a reel has no Create this now, even after an earlier one did', async ({ page }) => {
  const errors = watchErrors(page);
  await openCoach(page, [
    { reply: 'Create this now is below.', coach_actions: [{ type: 'create', destination: 'studio', mode: 'video', prompt: BRIEF }] },
    { reply: CARDIFF },
  ]);
  const first = await ask(page, 'make a reel of a runner at dawn in Cardiff');
  await expect(first.locator('.coach-action-btn[data-type="create"]')).toHaveCount(1);
  const second = await ask(page, 'write an instagram post for runners signing up to the Cardiff Half');
  await expect(second).toContainText('Would you like me to build a carousel');
  await expect(second.locator('.coach-action-btn')).toHaveCount(0);
  await expect(second.locator('.coach-library-offer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Create this now to the Video tab fills the brief and brings it into view', async ({ page }) => {
  const errors = watchErrors(page);
  await openCoach(page, [
    { reply: 'Create this now is below.', coach_actions: [{ type: 'create', destination: 'studio', mode: 'video', prompt: BRIEF }] },
  ]);
  const msg = await ask(page, 'make a reel of a runner at dawn in Cardiff');
  await msg.locator('.coach-action-btn[data-type="create"]').click();
  const dir = page.locator('#vs-creative-dir');
  await expect(dir).toHaveValue(BRIEF, { timeout: 10000 });
  await expect(dir).toBeInViewport({ timeout: 5000 });
  await page.screenshot({ path: 'test-results/coach-create-handoff-video.png' });
  expect(errors).toEqual([]);
});
