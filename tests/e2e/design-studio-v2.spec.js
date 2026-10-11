// Create → Design (Design Studio v2): teach the brand system, design a carousel, queue it, and the Coach handoff. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SYSTEM = {
  name: 'Clinic', ratio: '4:5', handle: '@clinic',
  colors: { bg: '#FFFFFF', text: '#111111', primary: '#7C3AED' },
  fonts: { heading: { family: 'archivo' }, body: { family: 'inter' } },
  patterns: [{ id: 'hook', name: 'Hook' }, { id: 'list', name: 'Checklist' }],
};
const RESULT = {
  title: 'Heartburn myths', angle: 'Myth-busting hook',
  caption: 'Know the facts.', hashtags: ['#heartburn', '#health'],
  slides: [1, 2, 3].map((i) => ({ url: `${PNG}#slide${i}`, pattern: 'hook', critic: { score: i === 2 ? 3 : 5, problems: i === 2 ? ['busy layout'] : [] } })),
  sources: ['https://www.nhs.uk/conditions/heartburn-and-acid-reflux/'],
};

function designMock({ hasSystem, calls, chatReply, figurelabs = false, medical = 'off', classify = false, runningPolls = 1 }) {
  let system = hasSystem ? SYSTEM : null;
  let settings = { medical };
  let uploads = 0;
  const polls = {};
  return async (entry, route, json) => {
    const m = route.request().method();
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (entry.path === '/api/design/system') {
      json(200, { ok: true, enabled: true, system, settings, figurelabs, previews: system ? [{ pattern: 'hook', url: `${PNG}#p1` }, { pattern: 'list', url: `${PNG}#p2` }] : [], fonts: ['archivo', 'inter'] });
      return 'handled';
    }
    if (entry.path === '/api/studio/upload-image') { uploads += 1; json(200, { url: `https://store.test/ex${uploads}.png` }); return 'handled'; }
    if (entry.path === '/api/design/system/build' && m === 'POST') { calls.push(['build', body()]); json(202, { ok: true, job_id: 'job-build' }); return 'handled'; }
    if (entry.path === '/api/design/carousel' && m === 'POST') { calls.push(['carousel', body()]); json(202, { ok: true, job_id: 'job-car' }); return 'handled'; }
    if (entry.path.startsWith('/api/design/jobs/')) {
      const id = entry.path.split('/').pop();
      polls[id] = (polls[id] || 0) + 1;
      if (polls[id] <= runningPolls) { json(200, { ok: true, job: { id, status: 'running', progress: polls[id] === 1 ? { stage: id === 'job-build' ? 'review' : 'critic', round: 1 } : { stage: 'fix', round: 1, slides: [2] } } }); return 'handled'; }
      if (id === 'job-build') system = SYSTEM;
      json(200, { ok: true, job: { id, status: 'done', result: id === 'job-build' ? { system: SYSTEM } : RESULT } });
      return 'handled';
    }
    if (entry.path === '/api/design/settings' && m === 'PUT') { calls.push(['settings', body()]); settings = { medical: body().medical }; json(200, { ok: true, settings }); return 'handled'; }
    if (entry.path === '/api/design/classify' && m === 'POST') { calls.push(['classify', body()]); json(200, { ok: true, medical: classify }); return 'handled'; }
    if (entry.path === '/api/design/system/previews' && m === 'POST') { calls.push(['previews']); json(200, { ok: true, previews: [{ pattern: 'hook', url: `${PNG}#fresh` }] }); return 'handled'; }
    if (entry.path === '/api/studio/design-queue' && m === 'POST') { calls.push(['queue', body()]); json(200, { ok: true }); return 'handled'; }
    if (entry.path === '/api/chat/v2' && chatReply) { json(200, chatReply); return 'handled'; }
    return undefined;
  };
}

test('Design tab: teach the brand from example slides, then the system and Make card appear', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: false, calls }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await expect(page).toHaveURL(/#create\/design$/);
  await expect(page.locator('#create-segments .create-seg[data-segment="brand-design"]')).toHaveClass(/active/);
  await expect(page.locator('#dsv2-setup')).toBeVisible();
  await expect(page.locator('#dsv2-make')).toHaveCount(0);

  await page.locator('#dsv2-files').setInputFiles([
    { name: '1.png', mimeType: 'image/png', buffer: Buffer.from('a') },
    { name: '2.png', mimeType: 'image/png', buffer: Buffer.from('b') },
  ]);
  await expect(page.locator('#dsv2-thumbs .dsv2-thumb')).toHaveCount(2);
  await page.locator('#dsv2-notes').fill('UK spelling');
  await page.locator('#dsv2-ratio').selectOption('9:16');
  await page.locator('#dsv2-build').click();
  await expect(page.locator('#dsv2-build-status')).toContainText('Comparing layouts');
  await expect(page.locator('#dsv2-system')).toContainText('Clinic design system', { timeout: 10000 });
  await expect(page.locator('#dsv2-system .dsv2-patterns figure')).toHaveCount(2);
  await expect(page.locator('#dsv2-make')).toBeVisible();
  expect(calls.find((c) => c[0] === 'build')[1]).toMatchObject({ example_urls: ['https://store.test/ex1.png', 'https://store.test/ex2.png'], notes: 'UK spelling', ratio: '9:16' });
  expect(errors).toEqual([]);
});

test('Design tab: brief → progress → slides with review scores, caption and sources → queue', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls }) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('#create-segments .create-seg[data-segment="brand-design"]');
  await expect(page.locator('#dsv2-make')).toBeVisible();
  await page.locator('#dsv2-brief').fill('Heartburn myths vs facts for adults over 40');
  await expect(page.locator('#dsv2-slides')).toHaveValue('auto');
  await expect(page.locator('#dsv2-platform')).toHaveCount(0);
  await page.evaluate(() => {
    window.__clientData = window.__clientData || {};
    window.__clientData.client = Object.assign({}, window.__clientData.client, { social_connected_platforms: ['instagram', 'facebook'] });
  });
  await page.locator('#dsv2-slides').selectOption('5');
  await page.locator('#dsv2-go').click();
  await expect(page.locator('#dsv2-make-status')).toContainText('Creative director review');
  const done = page.locator('#dsv2-done');
  await expect(done.locator('.dsv2-slide')).toHaveCount(3, { timeout: 10000 });
  await expect(done).toContainText('3/5');
  await expect(done).toContainText('busy layout');
  await expect(page.locator('#dsv2-caption')).toHaveValue('Know the facts.\n\n#heartburn #health');
  await expect(done.locator('.dsv2-sources a')).toHaveAttribute('href', /nhs\.uk/);
  await expect(page.locator('#dsv2-go')).toBeEnabled();
  expect(calls.find((c) => c[0] === 'carousel')[1]).toMatchObject({ brief: 'Heartburn myths vs facts for adults over 40', count: 5, research: true });
  expect(calls.find((c) => c[0] === 'carousel')[1].platform).toBeUndefined();
  await expect(page.locator('#dsv2-posts-to')).toHaveText('Posts to Instagram + Facebook');

  await page.locator('#dsv2-queue').click();
  await expect.poll(() => calls.filter((c) => c[0] === 'queue').length).toBe(1);
  const q = calls.find((c) => c[0] === 'queue')[1];
  expect(q.image_urls).toHaveLength(3);
  expect(q.caption).toContain('#heartburn');
  expect(q.platform).toBe('Instagram,Facebook');
});

test('Coach design_carousel → Design this carousel → Design tab starts with the brief and poster', async ({ page }) => {
  const calls = [];
  const chatReply = { reply: 'Designing your carousel now.', coach_actions: [{ type: 'design_carousel', brief: 'Five signs of reflux and when to see a GP', slides: 6, source_image_url: 'https://store.test/poster.png' }] };
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls, chatReply }) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'make a carousel about reflux signs');
  await page.click('#chat-send');
  const btn = page.locator('.coach-action-btn[data-type="design_carousel"]');
  await expect(btn).toBeVisible({ timeout: 10000 });
  await btn.click();
  await expect(page).toHaveURL(/#create\/design$/);
  await expect(page.locator('#dsv2-brief')).toHaveValue('Five signs of reflux and when to see a GP');
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(1);
  expect(calls.find((c) => c[0] === 'carousel')[1]).toMatchObject({ count: 6, source_image_url: 'https://store.test/poster.png' });
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });
});

test('All Tools has a Brand Design card that opens the Design tab', async ({ page }) => {
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls: [] }) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-studio"]');
  await page.click('#aist-brand-design');
  await expect(page.locator('#dsv2-make')).toBeVisible();
});

test('Design tab scrolls with the mouse wheel and slides open in a viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const calls = [];
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.locator('#dsv2-brief').fill('Heartburn myths vs facts for adults over 40');
  await page.locator('#dsv2-go').click();
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });

  const scroller = page.locator('.dsv2-scroll');
  await scroller.evaluate((n) => { n.style.scrollBehavior = 'auto'; n.scrollTop = 0; });
  await page.mouse.move(640, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate((n) => n.scrollTop)).toBeGreaterThan(200);
  await expect(page.locator('#dsv2-caption')).toBeInViewport();

  await page.locator('#dsv2-done [data-open="1"]').click();
  const lb = page.locator('.dsv2-lb');
  await expect(lb.locator('.dsv2-lb-count')).toHaveText('2 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(lb.locator('.dsv2-lb-count')).toHaveText('3 / 3');
  await page.keyboard.press('Escape');
  await expect(lb).toHaveCount(0);
});

test('Refresh previews re-renders the layout previews', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.locator('#dsv2-system summary').click();
  await page.locator('#dsv2-refresh').click();
  await expect(page.locator('#dsv2-system .dsv2-patterns img')).toHaveCount(1);
  await expect(page.locator('#dsv2-system .dsv2-patterns img')).toHaveAttribute('src', /#fresh$/);
  expect(calls.filter((c) => c[0] === 'previews')).toHaveLength(1);
});

test('Slides defaults to Auto: no count is sent, so the engine picks the length', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.locator('#dsv2-brief').fill('Heartburn myths vs facts for adults over 40');
  await page.locator('#dsv2-go').click();
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(1);
  expect(calls.find((c) => c[0] === 'carousel')[1].count).toBeUndefined();
});

test('Medical accuracy: setting saves, "ask" checks the topic and asks; the answer is sent with the carousel', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls, figurelabs: true, medical: 'ask', classify: true }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await expect(page.locator('#dsv2-medical-chip')).toContainText('asks for medical or scientific topics');
  await page.locator('#dsv2-brief').fill("Barrett's oesophagus: what it is and when to see a GP");
  await page.locator('#dsv2-go').click();
  const ask = page.locator('#dsv2-medical-ask');
  await expect(ask).toContainText('This looks like a medical or scientific topic');
  expect(calls.filter((c) => c[0] === 'carousel')).toHaveLength(0);
  await ask.locator('[data-medical="yes"]').click();
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(1);
  expect(calls.find((c) => c[0] === 'carousel')[1].medical).toBe(true);
  expect(calls.find((c) => c[0] === 'classify')[1].brief).toMatch(/Barrett/);
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });

  await page.locator('#dsv2-system summary').click();
  await page.locator('#dsv2-medical').selectOption('always');
  await expect.poll(() => calls.filter((c) => c[0] === 'settings').length).toBe(1);
  expect(calls.find((c) => c[0] === 'settings')[1]).toEqual({ medical: 'always' });
  await expect(page.locator('#dsv2-medical-chip')).toContainText('on (FigureLabs)');
  expect(errors).toEqual([]);
});

test('Medical accuracy: Coach "ask" handoff asks instead of auto-starting', async ({ page }) => {
  const calls = [];
  const chatReply = { reply: 'Designing it now.', coach_actions: [{ type: 'design_carousel', brief: "Barrett's oesophagus: symptoms and risk", medical: 'ask' }] };
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls, chatReply, figurelabs: true, medical: 'ask' }) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', "carousel on Barrett's");
  await page.click('#chat-send');
  await page.locator('.coach-action-btn[data-type="design_carousel"]').click();
  await expect(page.locator('#dsv2-medical-ask')).toContainText('This looks like a medical or scientific topic');
  expect(calls.filter((c) => c[0] === 'classify' || c[0] === 'carousel')).toHaveLength(0);
  await page.locator('#dsv2-medical-ask [data-medical="no"]').click();
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(1);
  expect(calls.find((c) => c[0] === 'carousel')[1].medical).toBe(false);
});

test('Medical accuracy setting is not shown for brands without FigureLabs', async ({ page }) => {
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls: [] }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await expect(page.locator('#dsv2-make')).toBeVisible();
  await expect(page.locator('#dsv2-medical')).toHaveCount(0);
  await expect(page.locator('#dsv2-medical-chip')).toBeEmpty();
});

test('Progress updates in place between polls (no flicker)', async ({ page }) => {
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls: [], runningPolls: 2 }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.locator('#dsv2-brief').fill('Heartburn myths vs facts for adults over 40');
  await page.locator('#dsv2-go').click();
  await expect(page.locator('#dsv2-make-status')).toContainText('Creative director review');
  await page.evaluate(() => { document.querySelector('#dsv2-make-status .dsv2-progress').dataset.marker = 'same'; });
  await expect(page.locator('#dsv2-make-status')).toContainText('Fixing weak slides (round 1, slide 2)', { timeout: 10000 });
  await expect(page.locator('#dsv2-make-status .dsv2-progress')).toHaveAttribute('data-marker', 'same');
  await expect(page.locator('#dsv2-make-status .dsv2-step.is-now')).toHaveText('Polish');
});
