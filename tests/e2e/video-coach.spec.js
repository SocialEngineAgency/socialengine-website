// Video tab Coach: a chat above the Generate form. It asks the shared Coach with surface 'video',
// and a brief it sends back fills the Video form (brief, size, length) without leaving the page.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { await srv.close(); });

const BRIEF = 'Slow push-in on the ceramic mug, steam rising, soft morning window light, shallow depth of field.';

async function openVideo(page, replies) {
  const sent = [];
  await mockApi(page, srv.base, {
    onRequest: (entry, route, json) => {
      if (entry.path === '/api/chat/v2') {
        const body = JSON.parse(entry.body || '{}');
        sent.push(body);
        json(200, replies.shift() || { reply: 'Okay.' });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('creation-studio'));
  await expect(page.locator('#vs-coach')).toBeVisible({ timeout: 15000 });
  return sent;
}

test('the Coach panel is on the Generate view, not on the upload view', async ({ page }) => {
  const errors = watchErrors(page);
  await openVideo(page, []);
  await expect(page.locator('#vsc-details')).toBeVisible();
  await expect(page.locator('.vsc-chip')).toHaveCount(3);
  await page.click('#vs-mode-upload');
  await expect(page.locator('#vs-coach')).toBeHidden();
  await page.click('#vs-mode-make');
  await expect(page.locator('#vs-coach')).toBeVisible();
  expect(errors).toEqual([]);
});

test('talking it through: a reply with a brief fills the form below', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = await openVideo(page, [
    { reply: 'Here is a clip idea. Want it handheld or locked off?' },
    { reply: 'Locked off, then. Loading it into the form.', coach_actions: [{ type: 'create', mode: 'video', destination: 'studio', prompt: BRIEF, aspect_ratio: '9:16' }] },
  ]);
  await page.fill('#vsc-input', 'a video of my mug with steam');
  await page.click('#vsc-send');
  await expect(page.locator('.vsc-bubble', { hasText: 'handheld or locked off' })).toBeVisible();
  await expect(page.locator('#vs-creative-dir')).toHaveValue('');
  await page.fill('#vsc-input', 'locked off');
  await page.press('#vsc-input', 'Enter');
  await expect(page.locator('.vsc-loaded')).toBeVisible();
  await expect(page.locator('#vs-creative-dir')).toHaveValue(BRIEF);
  await expect(page.locator('#vs-aspect')).toHaveValue('9:16');
  expect(sent.length).toBe(2);
  expect(sent[0].surface).toBe('video');
  expect(sent[0].message).toBe('a video of my mug with steam');
  expect(errors).toEqual([]);
});

test('a poster brief or a failed answer does not touch the form', async ({ page }) => {
  const sent = await openVideo(page, [
    { reply: 'That is a poster.', coach_actions: [{ type: 'create', mode: 'image', destination: 'design', prompt: 'A poster of a mug' }] },
  ]);
  await page.click('.vsc-chip >> nth=0');
  await expect(page.locator('.vsc-bubble', { hasText: 'That is a poster.' })).toBeVisible();
  await expect(page.locator('#vs-creative-dir')).toHaveValue('');
  await expect(page.locator('[data-vsc-load]')).toHaveCount(0);
  expect(sent[0].surface).toBe('video');
});

test('the conversation survives switching to Upload and back', async ({ page }) => {
  await openVideo(page, [{ reply: 'Try a slow push-in.' }]);
  await page.fill('#vsc-input', 'ideas?');
  await page.click('#vsc-send');
  await expect(page.locator('.vsc-bubble', { hasText: 'slow push-in' })).toBeVisible();
  await page.click('#vs-mode-upload');
  await page.click('#vs-mode-make');
  await expect(page.locator('.vsc-bubble', { hasText: 'slow push-in' })).toBeVisible();
});

for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }]) {
  test(`looks right at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openVideo(page, [{ reply: 'Locked off, then. Loading it into the form.', coach_actions: [{ type: 'create', mode: 'video', destination: 'studio', prompt: BRIEF, aspect_ratio: '9:16' }] }]);
    await page.fill('#vsc-input', 'a video of my mug with steam');
    await page.click('#vsc-send');
    await expect(page.locator('.vsc-loaded')).toBeVisible();
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.querySelector('.vs-page').scrollWidth - document.querySelector('.vs-page').clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/video-coach-${vp.name}.png` });
  });
}
