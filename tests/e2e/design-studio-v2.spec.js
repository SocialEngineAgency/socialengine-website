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
  patterns: [
    { id: 'hook', name: 'Hook', slots: { title: { kind: 'text', max_chars: 40 }, art: { kind: 'image' } } },
    { id: 'list', name: 'Checklist', slots: { heading: { kind: 'text', max_chars: 40 }, points: { kind: 'list', max_chars: 30, max_items: 4 } } },
  ],
};
const RESULT = {
  title: 'Heartburn myths', angle: 'Myth-busting hook',
  caption: 'Know the facts.', hashtags: ['#heartburn', '#health'],
  slides: [1, 2, 3].map((i) => ({ url: `${PNG}#slide${i}`, pattern: 'hook', slots: { title: `Title ${i}`, art: 'https://store.test/art.png' }, critic: { score: i === 2 ? 3 : 5, problems: i === 2 ? ['busy layout'] : [] } })),
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
    if (entry.path === '/api/design/slide' && m === 'POST') { calls.push(['slide', body()]); json(202, { ok: true, job_id: 'job-slide' }); return 'handled'; }
    if (entry.path === '/api/design/slide/preview' && m === 'POST') {
      const b = body();
      calls.push(['preview', b]);
      const sl = b.slide.slots || {};
      const st = b.slide.style || {};
      json(200, { ok: true, width: 1080, height: 1350, html: `<!doctype html><html><head><style>body{margin:0;width:1080px;height:1350px;background:${st.bg ? '#7C3AED' : '#fff'}}h1{font-size:90px}</style></head><body><h1 data-slot="title">${String(sl.title || sl.heading || '')}</h1><ul data-slot="points">${[].concat(sl.points || []).map((x) => `<li>${x}</li>`).join('')}</ul><img data-slot="art" src="${sl.art || ''}"></body></html>` });
      return 'handled';
    }
    if (entry.path === '/api/design/slides/render' && m === 'POST') { calls.push(['renderAll', body()]); json(202, { ok: true, job_id: 'job-renderall' }); return 'handled'; }
    if (entry.path === '/api/design/carousel' && m === 'POST') { calls.push(['carousel', body()]); json(202, { ok: true, job_id: 'job-car' }); return 'handled'; }
    if (entry.path.startsWith('/api/design/jobs/')) {
      const id = entry.path.split('/').pop();
      polls[id] = (polls[id] || 0) + 1;
      if (polls[id] <= runningPolls) { json(200, { ok: true, job: { id, status: 'running', progress: polls[id] === 1 ? { stage: id === 'job-build' ? 'review' : 'critic', round: 1 } : { stage: 'fix', round: 1, slides: [2] } } }); return 'handled'; }
      if (id === 'job-build') system = SYSTEM;
      if (id === 'job-slide') {
        const req = calls.filter((c) => c[0] === 'slide').pop()[1];
        const slots = req.create ? { title: 'When to see a GP' } : req.slide.slots;
        json(200, { ok: true, job: { id, status: 'done', result: { slide: { url: `${PNG}#edited${calls.filter((c) => c[0] === 'slide').length}`, pattern: req.create ? 'hook' : req.slide.pattern, slots, style: req.slide.style || {}, issues: [{ type: 'too_long', severity: 'soft', detail: 'title is 45 chars (max 40)' }] } } } });
        return 'handled';
      }
      if (id === 'job-renderall') {
        const req = calls.filter((c) => c[0] === 'renderAll').pop()[1];
        json(200, { ok: true, job: { id, status: 'done', result: { slides: req.slides.map((x, k) => ({ url: `${PNG}#renum${k + 1}-${x.slots.title || ''}`, issues: [] })) } } });
        return 'handled';
      }
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


async function openEditor(page, calls, slide = 1) {
  await mockApi(page, srv.base, { onRequest: designMock({ hasSystem: true, calls }) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.locator('#dsv2-brief').fill('Heartburn myths vs facts for adults over 40');
  await page.locator('#dsv2-go').click();
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });
  await page.locator(`#dsv2-done [data-edit="${slide}"]`).click();
  const ed = page.locator('.dsv2-ed');
  await expect(ed).toContainText('slide 2 of 3');
  return ed;
}
const liveFrame = (ed) => ed.locator('.dsv2-ed-stage iframe.is-on').contentFrame();

test('Editor: live preview while typing, text styling, Save & next slide, undo/redo', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  const ed = await openEditor(page, calls);
  await expect(liveFrame(ed).locator('h1')).toHaveText('Title 2');
  const title = ed.locator('[data-slot="title"]');
  const look = await title.evaluate((n) => { const c = getComputedStyle(n); return { color: c.color, bg: c.backgroundColor }; });
  expect(look).toEqual({ color: 'rgb(248, 250, 252)', bg: 'rgb(10, 15, 30)' });
  await expect(ed.locator('label[for="dsv2-ed-f-title"]')).toContainText('Headline');

  await title.fill('Live headline');
  await expect(liveFrame(ed).locator('h1')).toHaveText('Live headline');
  await expect(ed.locator('#dsv2-ed-badge')).toHaveText('Unsaved changes');
  expect(calls.filter((c) => c[0] === 'slide')).toHaveLength(0);

  await ed.locator('[data-size="1"][data-name="title"]').click();
  await ed.locator('[data-size="1"][data-name="title"]').click();
  await expect(ed.locator('[data-field="title"] .dsv2-ed-seg span')).toHaveText('120%');
  await ed.locator('[data-align="left"][data-name="title"]').click();
  await ed.locator('[data-color="primary"][data-name="title"]').click();
  await expect.poll(() => (calls.filter((c) => c[0] === 'preview').pop() || [0, {}])[1].slide?.style?.slots?.title).toEqual({ size: 2, align: 'left', color: 'primary' });

  await ed.locator('#dsv2-ed-next').click();
  await expect(ed).toContainText('slide 3 of 3');
  const saved = calls.find((c) => c[0] === 'slide')[1];
  expect(saved).toMatchObject({ index: 1, total: 3, slide: { pattern: 'hook', slots: { title: 'Live headline' }, style: { slots: { title: { size: 2, align: 'left', color: 'primary' } } } } });
  await expect(page.locator('#dsv2-done .dsv2-slide img').nth(1)).toHaveAttribute('src', /#edited1$/);
  await expect(ed.locator('#dsv2-ed-finish')).toBeVisible();

  await ed.locator('.dsv2-ed-thumb[data-slide="1"]').click();
  await expect(ed).toContainText('slide 2 of 3');
  await ed.locator('#dsv2-ed-undo').click();
  await expect(page.locator('#dsv2-done .dsv2-slide img').nth(1)).toHaveAttribute('src', /#slide2$/);
  await expect(ed.locator('[data-slot="title"]')).toHaveValue('Title 2');
  await ed.locator('#dsv2-ed-redo').click();
  await expect(ed.locator('[data-slot="title"]')).toHaveValue('Live headline');
  expect(errors).toEqual([]);
});

test('Editor: click text on the slide to select it; layout switch keeps the words; background and picture controls preview live', async ({ page }) => {
  const calls = [];
  const ed = await openEditor(page, calls);
  await ed.locator('[data-tab="background"]').click();
  await liveFrame(ed).locator('h1').click();
  await expect(ed.locator('.dsv2-ed-tab.is-on')).toHaveText('Text');
  await expect(ed.locator('[data-field="title"]')).toHaveClass(/is-sel/);
  await expect(ed.locator('[data-slot="title"]')).toBeFocused();

  await ed.locator('[data-tab="layout"]').click();
  await ed.locator('[data-layout="list"]').click();
  await ed.locator('[data-tab="text"]').click();
  await expect(ed.locator('[data-slot="heading"]')).toHaveValue('Title 2');
  await expect(liveFrame(ed).locator('h1')).toHaveText('Title 2');

  await ed.locator('[data-tab="background"]').click();
  await ed.locator('[data-bg="primary"]').click();
  await expect.poll(() => (calls.filter((c) => c[0] === 'preview').pop() || [0, {}])[1].slide?.style?.bg).toBe('primary');

  await ed.locator('[data-tab="layout"]').click();
  await ed.locator('[data-layout="hook"]').click();
  await ed.locator('[data-tab="picture"]').click();
  await ed.locator('[data-art="zoom"]').fill('1.5');
  await expect.poll(() => (calls.filter((c) => c[0] === 'preview').pop() || [0, {}])[1].slide?.style?.art?.zoom).toBe(1.5);
});

test('Editor: move, delete and add slides; page numbers re-render in the new order', async ({ page }) => {
  const calls = [];
  const ed = await openEditor(page, calls);
  page.on('dialog', (d) => d.accept());
  await ed.locator('[data-op="right"]').click();
  await expect(ed).toContainText('slide 3 of 3');
  await expect.poll(() => calls.filter((c) => c[0] === 'renderAll').length).toBe(1);
  expect(calls.find((c) => c[0] === 'renderAll')[1].slides.map((x) => x.slots.title)).toEqual(['Title 1', 'Title 3', 'Title 2']);
  await expect(page.locator('#dsv2-done .dsv2-slide img').nth(2)).toHaveAttribute('src', /#renum3-Title 2$/);

  await ed.locator('[data-op="del"]').click();
  await expect(ed).toContainText('slide 2 of 2');
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(2);

  await ed.locator('.dsv2-ed-thumb[data-slide="0"]').click();
  await ed.locator('#dsv2-ed-add').click();
  await ed.locator('#dsv2-ed-addtext').fill('when to see a GP');
  await ed.locator('#dsv2-ed-addgo').click();
  await expect(ed).toContainText('slide 2 of 3');
  const made = calls.filter((c) => c[0] === 'slide').pop()[1];
  expect(made).toMatchObject({ create: true, instruction: 'when to see a GP', index: 1, total: 3 });
  expect(made.context).toMatch(/1\. Title 1/);
  await expect(ed.locator('[data-slot="title"]')).toHaveValue('When to see a GP');
  await expect.poll(() => calls.filter((c) => c[0] === 'renderAll').length).toBe(3);
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3);
});
