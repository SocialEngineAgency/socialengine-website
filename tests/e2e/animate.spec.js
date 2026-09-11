// Animate VO-first entry (design §5). Hermetic — local static server +
// mocked API (see helpers/portal-mock.js).
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, EMAIL } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

async function openAnimate(page) {
  const calls = await mockApi(page, srv.base, { data: clientData() });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('#create-segments [data-segment="animation-studio"]');
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
  return calls;
}

test('VO is the default entry; Send posts vo_script with prompt null', async ({ page }) => {
  const calls = await openAnimate(page);
  const vo = page.locator('#anim-entry-mode [data-entry="vo"]');
  await expect(vo).toHaveClass(/active/);
  await expect(page.locator('#anim-prompt')).toHaveAttribute('placeholder', "Write or paste the voiceover. We'll build the shots around it.");
  await page.fill('#anim-prompt', 'Warm hello. This week only, twenty percent off the silk set.');
  await page.click('#anim-send');
  await expect.poll(() => calls.some((c) => c.path.includes('/brief'))).toBeTruthy();
  const brief = calls.find((c) => c.path.endsWith('/brief'));
  const body = JSON.parse(brief.body);
  expect(body.vo_script).toMatch(/Warm hello/);
  expect(body.prompt).toBeNull();
});

test('Describe a video keeps the old prompt path and is remembered per client', async ({ page }) => {
  const calls = await openAnimate(page);
  await page.click('#anim-entry-mode [data-entry="prompt"]');
  await expect(page.locator('#anim-prompt')).toHaveAttribute('placeholder', /Describe a character/);
  expect(await page.evaluate((email) => localStorage.getItem('se_anim_entry:' + email), EMAIL)).toBe('prompt');
  await page.fill('#anim-prompt', 'A woman walks through a sunlit loft holding the silk robe.');
  await page.click('#anim-send');
  await expect.poll(() => calls.some((c) => c.path.includes('/brief'))).toBeTruthy();
  const body = JSON.parse(calls.find((c) => c.path.endsWith('/brief')).body);
  expect(body.prompt).toMatch(/sunlit loft/);
  expect(body.vo_script).toBeFalsy();

  await page.click('.dash-nav-item[data-nav="dashboard"]');
  await page.click('.dash-nav-item[data-nav="create"]');
  await expect(page.locator('#create-segments [data-segment="animation-studio"]')).toHaveClass(/active/);
  await expect(page.locator('#anim-entry-mode [data-entry="prompt"]')).toHaveClass(/active/);
});

test('remix session sends via the VO path', async ({ page }) => {
  const calls = await mockApi(page, srv.base, { data: clientData() });
  await login(page, srv.base);
  await page.evaluate(() => {
    window.__SE_ANIM_REMIX_SESSION = {
      referenceUrl: 'https://cdn.example.com/still.jpg',
      prompt: 'Hook: the silk set you keep meaning to try.',
      target_seconds: 24,
      format_template_id: 'remix-24s',
    };
  });
  await page.evaluate(() => window.switchNav('animation-studio'));
  await expect(page.locator('#dash-content .anim-shell')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => calls.some((c) => c.path.includes('/brief'))).toBeTruthy();
  const body = JSON.parse(calls.find((c) => c.path.endsWith('/brief')).body);
  expect(body.vo_script).toMatch(/silk set/);
  expect(body.prompt).toBeNull();
});
