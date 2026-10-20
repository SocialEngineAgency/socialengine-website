// The work panel beside the Coach chat: while the Coach builds a style and a carousel, a slim panel shows the
// steps, the plan and small pictures of the slides as they appear; when it is done it holds the finished slides
// and a button to the tab where they live. The chat gets the same plain button, and the way back to the tab
// is saved with the message. Hermetic: the test holds each step of the job until it has looked at it, so it
// never depends on timing. Screenshots go to SE_SHOTS when it is set.
const zlib = require('zlib');
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const SHOTS = process.env.SE_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

// Small real pictures (a 9:16 slide with a title and a few lines) so the tiles have something to show.
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const [r, g, b] = pixel(x, y);
    const o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([head, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const SLIDES = [
  { top: '#EFE6FA', bottom: '#CDB8F0', ink: '#2B1860', bars: [[22, 120, 150, 16], [22, 146, 120, 16], [22, 172, 140, 16], [22, 230, 90, 7], [22, 246, 120, 7]] },
  { top: '#2B1860', bottom: '#4B2D8F', ink: '#F3ECFF', bars: [[22, 60, 110, 14], [22, 110, 160, 9], [22, 140, 150, 9], [22, 170, 165, 9], [22, 200, 130, 9], [22, 230, 155, 9]] },
  { top: '#E3F6EE', bottom: '#B9E4D1', ink: '#16483A', bars: [[22, 130, 140, 16], [22, 156, 100, 16], [22, 240, 120, 30]] },
];
const slideData = (i) => {
  const s = SLIDES[i % 3];
  const top = hex(s.top); const bottom = hex(s.bottom); const ink = hex(s.ink);
  const buf = png(108, 192, (x, y) => (s.bars.some(([bx, by, bw, bh]) => x >= bx / 2 && x < (bx + bw) / 2 && y >= by / 2 && y < (by + bh) / 2) ? ink : mix(top, bottom, y / 191)));
  return buf;
};
const dataUri = (i) => `data:image/png;base64,${slideData(i).toString('base64')}`;
const FINAL = (n) => `https://store.test/final-${n}.png`;

const LILAC = {
  name: 'OPA', ratio: '9:16', handle: '@opa', colors: { bg: '#FFFFFF', primary: '#7C3AED' },
  fonts: { heading: { family: 'archivo' }, body: { family: 'inter' } },
  patterns: [{ id: 'hook', name: 'hook', slots: { title: { kind: 'text', max_chars: 40 } } }],
};
const sum = (id, name, active) => ({ id, name, active, ratio: '9:16', layouts: 1, colors: ['#E9DDF6', '#4B2D8F'], preview_url: '', built_at: null });

// `st` is the job's state; the test moves it on when it is ready for the next step.
function newState() { return { build: 'draft', car: 'queued', slides: 0, pv: 1 }; }
const move = (st, patch) => { Object.assign(st, patch, { pv: st.pv + 1 }); };

function mock(calls, st) {
  let styles = [sum('style_1', 'OPA lilac', true)];
  return async (entry, route, json) => {
    const m = route.request().method();
    const url = new URL(route.request().url());
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (entry.path === '/api/design/system' && m === 'GET') {
      const want = url.searchParams.get('style') || 'style_1';
      json(200, { ok: true, enabled: true, styles, style: { id: want, name: 'x' }, default_style: 'style_1', max_styles: 6, system: LILAC, settings: { medical: 'off' }, recipes: [], figurelabs: false, previews: [], fonts: ['archivo', 'inter'] });
      return 'handled';
    }
    if (entry.path === '/api/design/system/build' && m === 'POST') { calls.push(['build', body()]); json(202, { ok: true, job_id: 'job-build' }); return 'handled'; }
    if (entry.path === '/api/design/carousel' && m === 'POST') { calls.push(['carousel', body()]); json(202, { ok: true, job_id: 'job-car' }); return 'handled'; }
    if (entry.path === '/api/design/jobs/job-build/live') {
      const since = url.searchParams.get('since');
      calls.push(['live-build', since]);
      if (since && Number(since) === st.pv) { json(200, { ok: true, pv: st.pv, total: 2, outline: [], slides: [], unchanged: true }); return 'handled'; }
      json(200, { ok: true, pv: st.pv, total: 2, outline: ['Cover', 'List'], slides: st.build === 'draft' ? [] : [0, 1].map((i) => ({ n: i + 1, label: i ? 'list' : 'cover', src: dataUri(i) })) });
      return 'handled';
    }
    if (entry.path === '/api/design/jobs/job-car/live') {
      const since = url.searchParams.get('since');
      calls.push(['live', since]);
      if (since && Number(since) === st.pv) { json(200, { ok: true, pv: st.pv, total: 3, outline: [], slides: [], unchanged: true }); return 'handled'; }
      json(200, { ok: true, pv: st.pv, total: 3, outline: st.car === 'queued' ? [] : ['Sleep is a skill', 'Three habits that help', 'Try it tonight'], slides: [0, 1, 2].slice(0, st.slides).map((i) => ({ n: i + 1, label: 'slide', src: dataUri(i) })) });
      return 'handled';
    }
    if (entry.path === '/api/design/jobs/job-build') {
      if (st.build !== 'done') { json(200, { ok: true, job: { id: 'job-build', status: 'running', progress: st.build === 'draft' ? { stage: 'draft' } : { stage: 'review', round: 1, pv: st.pv, total: 2 } } }); return 'handled'; }
      if (!styles.some((s) => s.id === 'style_2')) styles = [...styles, sum('style_2', 'Mint and purple', false)];
      json(200, { ok: true, job: { id: 'job-build', status: 'done', result: { system: LILAC, style: { id: 'style_2', name: 'Mint and purple' }, previews: [{ pattern: 'hook', url: FINAL(90) }] } } });
      return 'handled';
    }
    if (entry.path === '/api/design/jobs/job-car') {
      if (st.car === 'queued') { json(200, { ok: true, job: { id: 'job-car', status: 'running', progress: { stage: 'queued', ahead: 1 } } }); return 'handled'; }
      if (st.car !== 'done') {
        // Like the server: pictures and the plan only start to count (pv) once the plan is made.
        const progress = st.car === 'plan' ? { stage: 'plan' } : st.car === 'art' ? { stage: 'art', pv: st.pv, total: 3 } : { stage: 'critic', round: 1, pv: st.pv, total: 3 };
        json(200, { ok: true, job: { id: 'job-car', status: 'running', progress } });
        return 'handled';
      }
      json(200, { ok: true, job: { id: 'job-car', status: 'done', result: { title: 'Sleep', angle: 'a', caption: 'c', hashtags: ['#a'], slides: [1, 2, 3].map((n) => ({ url: FINAL(n), pattern: 'hook', slots: { title: `T${n}` }, critic: { score: 5, problems: [] } })), sources: [], style: { id: 'style_2', name: 'Mint and purple' } } } });
      return 'handled';
    }
    if (entry.path === '/api/chat/v2') {
      calls.push(['chat', body()]);
      json(200, { reply: 'Building the new style now, then the carousel. You can follow it in the Carousels tab.', coach_actions: [{ type: 'design_style', name: 'Mint and purple', notes: '', source_image_url: 'https://store.test/ref.png', ratio: '9:16', then_carousel: { brief: 'Sleep, three habits', slides: 3 } }] });
      return 'handled';
    }
    return undefined;
  };
}

// The finished pictures live on a made-up host; serve them from here.
async function serveFinals(page) {
  await page.route('https://store.test/**', (route) => {
    const n = Number((route.request().url().match(/final-(\d+)/) || [])[1] || 1);
    route.fulfill({ status: 200, contentType: 'image/png', body: png(432, 768, (x, y) => {
      const s = SLIDES[(n - 1) % 3];
      const top = hex(s.top); const bottom = hex(s.bottom); const ink = hex(s.ink);
      return s.bars.some(([bx, by, bw, bh]) => x >= bx * 2 && x < (bx + bw) * 2 && y >= by * 2 && y < (by + bh) * 2) ? ink : mix(top, bottom, y / 767);
    }) });
  });
}

test('Coach chat: a work panel shows the steps, the plan and the slides as they appear, then a button to the Carousels tab', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  const st = newState();
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, srv.base, { onRequest: mock(calls, st) });
  await serveFinals(page);
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'Create a new carousel design from this reference, then a carousel on sleep');
  await page.click('#chat-send');

  // The panel sits beside the chat and starts on the style.
  const panel = page.locator('.chat-workspace > .sw');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel).toHaveAttribute('data-s', 'running');
  await expect(panel.locator('.sw__title')).toContainText('Mint and purple');
  await expect(panel.locator('.sw__step')).toHaveCount(3);
  await expect(panel.locator('.sw__step[data-st="active"]')).toContainText('Study the references');
  await shot(page, 'panel-1-start');

  // Matching the layouts: the layouts show up one by one as they are checked.
  move(st, { build: 'review' });
  await expect(panel.locator('.sw__step[data-st="active"]')).toContainText('Match the layouts', { timeout: 10000 });
  await expect(panel.locator('.sw__tile.has-img')).toHaveCount(2, { timeout: 10000 });
  await shot(page, 'panel-2-style');

  // The style is saved; the carousel is next, with its own steps. Waiting in line says so.
  move(st, { build: 'done' });
  await expect(panel.locator('.sw__step')).toHaveCount(5, { timeout: 15000 });
  await expect(panel.locator('.sw__past')).toContainText('Style built');
  expect(calls.some((c) => c[0] === 'carousel' && c[1].style_id === 'style_2'), 'the carousel uses the new style').toBe(true);
  move(st, { car: 'plan' });
  await expect(panel.locator('.sw__step[data-st="active"]')).toContainText('Plan the slides', { timeout: 10000 });
  move(st, { car: 'art' });
  await expect(panel.locator('.sw__step[data-st="active"]')).toContainText('Draw the artwork', { timeout: 10000 });
  await expect(panel.locator('.sw__tile')).toHaveCount(3, { timeout: 10000 }); // the plan, as three empty frames
  await expect(panel.locator('.sw__plan').first()).toContainText('Sleep is a skill');
  await expect(panel.locator('.sw__tile.has-img')).toHaveCount(0);
  await shot(page, 'panel-3-plan');

  // The slides arrive as they are drawn.
  move(st, { car: 'critic', slides: 2 });
  await expect(panel.locator('.sw__tile.has-img')).toHaveCount(2, { timeout: 10000 });
  await expect(panel.locator('.sw__step[data-st="active"]')).toContainText('Review and polish');
  expect(calls.some((c) => c[0] === 'live' && c[1] === null), 'the first ask for pictures has no since').toBe(true);
  await shot(page, 'panel-4-slides');
  move(st, { slides: 3 });
  await expect(panel.locator('.sw__tile.has-img')).toHaveCount(3, { timeout: 10000 });
  // Nothing new: the next ask is told "unchanged" and sends no pictures.
  await expect.poll(() => calls.filter((c) => c[0] === 'live' && c[1]).length, { timeout: 10000 }).toBeGreaterThan(0);

  // Finished: the real slides, a quiet "done" state and the way to the tab.
  move(st, { car: 'done' });
  await expect(panel).toHaveAttribute('data-s', 'done', { timeout: 15000 });
  await expect(panel.locator('.sw__title')).toContainText('Your carousel is ready');
  await expect(panel.locator('a.sw__tile')).toHaveCount(3);
  await expect(panel.locator('a.sw__tile').first()).toHaveAttribute('href', FINAL(1));
  await expect.poll(() => panel.locator('a.sw__tile img').evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
  await shot(page, 'panel-5-done');

  // The chat got the same plain button, not the old gradient one, and the panel has the main one.
  const chatBtn = page.locator('.chat-msg--ai .sw-btn--chip', { hasText: 'Open Carousels' });
  await expect(chatBtn).toBeVisible();
  expect(await chatBtn.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  await expect(page.locator('.coach-action-btn', { hasText: 'Open the carousel' })).toHaveCount(0);
  // The tab named in the reply is a link.
  await expect(page.locator('.chat-msg--ai a.sw-link[data-sw-tab="carousels"]').first()).toBeVisible();

  // Leaving the Coach and coming back: the panel is still there, and so is the saved way to the tab.
  await page.click('.dash-nav-item[data-nav="dashboard"]');
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await expect(page.locator('.chat-workspace > .sw[data-s="done"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.chat-msg--ai button[data-sw-tab="carousels"]').first()).toBeVisible();

  // The button goes to the Carousels tab.
  await page.locator('.chat-workspace > .sw').getByRole('button', { name: /Open in Carousels/ }).click();
  await expect(page).toHaveURL(/#create\/carousels$/);
  expect(errors).toEqual([]);
});

test('Coach chat: a tab named in a reply opens when clicked', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, {
    onRequest: (entry, route, json) => {
      if (entry.path === '/api/chat/v2') { json(200, { reply: 'It is waiting for you in Content Review.' }); return 'handled'; }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'where is it');
  await page.click('#chat-send');
  const link = page.locator('.chat-msg--ai a.sw-link[data-sw-tab="review"]');
  await expect(link).toBeVisible({ timeout: 10000 });
  await link.click();
  await expect(page.locator('.dash-nav-item[data-nav="content"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('a failed build shows what happened and leaves no button to a tab', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  const base = mock(calls, newState());
  await mockApi(page, srv.base, {
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/design/jobs/job-build') { json(200, { ok: true, job: { id: 'job-build', status: 'failed', error: 'Design failed. Try again.' } }); return 'handled'; }
      return base(entry, route, json);
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'new style from this');
  await page.click('#chat-send');
  const panel = page.locator('.chat-workspace > .sw');
  await expect(panel).toHaveAttribute('data-s', 'failed', { timeout: 20000 });
  await expect(panel.locator('.sw__err')).toContainText('Design failed');
  await expect(panel.getByRole('button', { name: /Open in/ })).toHaveCount(0);
  await expect(panel.locator('.sw__x')).toBeVisible();
  await panel.locator('.sw__x').click();
  await expect(panel).toHaveCount(0);
  expect(errors.filter((e) => !/Design failed/.test(e))).toEqual([]);
});
