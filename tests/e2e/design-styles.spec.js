// Several carousel design styles per brand: pick one, add a new one from a single reference (the old
// ones stay), make a carousel in the picked style, and the Coach builds a style then the carousel. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sys = (name, pattern) => ({
  name, ratio: '4:5', handle: '@opa', colors: { bg: '#FFFFFF', primary: '#7C3AED' },
  fonts: { heading: { family: 'archivo' }, body: { family: 'inter' } },
  patterns: [{ id: pattern, name: pattern, slots: { title: { kind: 'text', max_chars: 40 } } }],
});
const LILAC = sys('OPA', 'lilachook');
const MINT = sys('OPA', 'blobhook');
const sum = (id, name, colors, active) => ({ id, name, active, ratio: '4:5', layouts: 1, colors, preview_url: '', built_at: null });

function mock(calls) {
  let styles = [sum('style_1', 'OPA lilac', ['#E9DDF6', '#4B2D8F'], true)];
  const systems = { style_1: LILAC, style_2: MINT };
  let buildDone = 0;
  return async (entry, route, json) => {
    const m = route.request().method();
    const url = new URL(route.request().url());
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (entry.path === '/api/design/system' && m === 'GET') {
      const want = url.searchParams.get('style') || styles.find((s) => s.active).id;
      calls.push(['system', want]);
      json(200, { ok: true, enabled: true, styles, style: { id: want, name: styles.find((s) => s.id === want).name }, default_style: styles.find((s) => s.active).id, max_styles: 6, system: systems[want], settings: { medical: 'off' }, recipes: [], figurelabs: false, previews: [{ pattern: Object.keys(systems).length ? systems[want].patterns[0].id : '', url: `${PNG}#${want}` }], fonts: ['archivo', 'inter'] });
      return 'handled';
    }
    if (entry.path === '/api/studio/upload-image') { json(200, { url: 'https://store.test/ref.png' }); return 'handled'; }
    if (entry.path === '/api/design/system/build' && m === 'POST') { calls.push(['build', body()]); json(202, { ok: true, job_id: 'job-build' }); return 'handled'; }
    if (entry.path === '/api/design/carousel' && m === 'POST') { calls.push(['carousel', body()]); json(202, { ok: true, job_id: 'job-car' }); return 'handled'; }
    if (entry.path === '/api/design/styles/active' && m === 'PUT') {
      calls.push(['default', body()]);
      styles = styles.map((s) => ({ ...s, active: s.id === body().id }));
      json(200, { ok: true, styles, default_style: body().id });
      return 'handled';
    }
    if (entry.path.startsWith('/api/design/jobs/')) {
      const id = entry.path.split('/').pop();
      if (id === 'job-build') {
        buildDone += 1;
        if (buildDone < 2) { json(200, { ok: true, job: { id, status: 'running', progress: { stage: 'review', round: 1 } } }); return 'handled'; }
        if (!styles.some((s) => s.id === 'style_2')) styles = [...styles, sum('style_2', body_name(calls), ['#7CC4A4', '#4B2D8F'], false)];
        json(200, { ok: true, job: { id, status: 'done', result: { system: MINT, style: { id: 'style_2', name: body_name(calls) } } } });
        return 'handled';
      }
      const last = (calls.filter((c) => c[0] === 'carousel').pop() || [])[1] || {};
      json(200, { ok: true, job: { id, status: 'done', result: { title: 'Gastric', angle: 'a', caption: 'c', hashtags: ['#a'], slides: [1, 2, 3].map((i) => ({ url: `${PNG}#s${i}`, pattern: 'blobhook', slots: { title: `T${i}` }, critic: { score: 5, problems: [] } })), sources: [], style: { id: last.style_id || 'style_1', name: 'x' } } } });
      return 'handled';
    }
    if (entry.path === '/api/chat/v2') {
      calls.push(['chat', body()]);
      json(200, { reply: 'Building the new style now, then the carousel.', coach_actions: [{ type: 'design_style', name: 'Mint and purple', notes: 'mint #7CC4A4', source_image_url: 'https://store.test/ref.png', then_carousel: { brief: 'What is gastric cancer, eight slides for the UK public', slides: 8 } }] });
      return 'handled';
    }
    return undefined;
  };
}
function body_name(calls) { const b = calls.filter((c) => c[0] === 'build').pop(); return (b && b[1].style_name) || 'Mint and purple'; }

test('Carousels tab: a new style is added from one reference next to the old one, and a carousel is made in the picked style', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: mock(calls) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await expect(page.locator('#dsv2-styles .dsv2-stylechip')).toHaveCount(1);
  await expect(page.locator('#dsv2-newstyle')).toBeVisible();

  await page.click('#dsv2-newstyle');
  await expect(page.locator('#dsv2-setup')).toContainText('Add a new style');
  await expect(page.locator('#dsv2-setup')).toContainText('Your other styles stay exactly as they are');
  await page.locator('#dsv2-files').setInputFiles([{ name: 'ref.png', mimeType: 'image/png', buffer: Buffer.from('a') }]);
  await expect(page.locator('#dsv2-thumbs .dsv2-thumb')).toHaveCount(1);
  await page.fill('#dsv2-stylename', 'Mint and purple');
  await page.click('#dsv2-build');
  await expect(page.locator('#dsv2-styles .dsv2-stylechip')).toHaveCount(2, { timeout: 15000 });
  expect(calls.find((c) => c[0] === 'build')[1]).toMatchObject({ add: true, style_name: 'Mint and purple', example_urls: ['https://store.test/ref.png'] });
  expect(calls.find((c) => c[0] === 'build')[1].style_id).toBeUndefined();
  await expect(page.locator('#dsv2-styles .dsv2-stylechip.is-on')).toContainText('Mint and purple');
  await expect(page.locator('#dsv2-styles .dsv2-stylechip', { hasText: 'OPA lilac' })).toContainText('default');

  await page.fill('#dsv2-brief', 'What is gastric cancer, eight slides for the UK public');
  await page.click('#dsv2-go');
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(1);
  expect(calls.find((c) => c[0] === 'carousel')[1].style_id).toBe('style_2');
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });

  await page.click('#dsv2-style-default');
  await expect.poll(() => calls.filter((c) => c[0] === 'default').length).toBe(1);
  expect(calls.find((c) => c[0] === 'default')[1]).toEqual({ id: 'style_2' });
  await page.locator('#dsv2-styles .dsv2-stylechip', { hasText: 'OPA lilac' }).click();
  await expect.poll(() => calls.filter((c) => c[0] === 'system').pop()[1]).toBe('style_1');
  expect(errors).toEqual([]);
});

test('Coach chat: a new style is built from the attached reference, then the carousel is made in it, with no buttons to press', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: mock(calls) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'Create a new carousel design from this reference, then a carousel on gastric cancer');
  await page.click('#chat-send');
  await expect(page.locator('.coach-progress').first()).toContainText('Building your new style', { timeout: 10000 });
  await expect.poll(() => calls.filter((c) => c[0] === 'build').length, { timeout: 15000 }).toBe(1);
  expect(calls.find((c) => c[0] === 'build')[1]).toMatchObject({ add: true, style_name: 'Mint and purple', notes: 'mint #7CC4A4', example_urls: ['https://store.test/ref.png'] });
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length, { timeout: 20000 }).toBe(1);
  expect(calls.find((c) => c[0] === 'carousel')[1]).toMatchObject({ style_id: 'style_2', count: 8, brief: 'What is gastric cancer, eight slides for the UK public' });
  await expect(page.locator('.coach-progress').last()).toContainText('The carousel is ready: 3 slides in "Mint and purple"', { timeout: 15000 });
  await page.getByRole('button', { name: 'Open the carousel' }).click();
  await expect(page).toHaveURL(/#create\/carousels$/);
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });
  expect(errors).toEqual([]);
});

// ── the rulebook: a carousel is 9:16, and a style of another size says so before any work is paid for ──
function sizeMock(calls) {
  const styles = [
    { ...sum('style_1', 'OPA lilac', ['#E9DDF6', '#4B2D8F'], true), ratio: '1:1' },
    { ...sum('style_2', 'Mint', ['#7CC4A4'], false), ratio: '9:16' },
  ];
  const systems = { style_1: { ...LILAC, ratio: '1:1' }, style_2: { ...MINT, ratio: '9:16' } };
  let built = 0;
  return async (entry, route, json) => {
    const m = route.request().method();
    const url = new URL(route.request().url());
    const body = () => JSON.parse(route.request().postData() || '{}');
    if (entry.path === '/api/design/system' && m === 'GET') {
      const want = url.searchParams.get('style') || 'style_1';
      json(200, { ok: true, enabled: true, styles, style: { id: want, name: styles.find((s) => s.id === want).name }, default_style: 'style_1', max_styles: 6, system: systems[want], settings: { medical: 'off' }, recipes: [], figurelabs: false, previews: [], fonts: ['archivo', 'inter'] });
      return 'handled';
    }
    if (entry.path === '/api/design/system/build' && m === 'POST') { calls.push(['build', body()]); json(202, { ok: true, job_id: 'job-build' }); return 'handled'; }
    if (entry.path === '/api/design/carousel' && m === 'POST') {
      const b = body();
      calls.push(['carousel', b]);
      const style = b.style_id || 'style_1';
      const sys = systems[style];
      if (sys.ratio !== '9:16' && !b.format_override) {
        json(422, { error: 'OPA lilac makes 1:1 carousels, but carousels are 9:16 (the platform rule). Nothing was made. Use "Mint" (9:16), or rebuild this style at 9:16.', code: 'DESIGN_FORMAT', fix: { use_style: 'style_2', rebuild_ratio: '9:16' }, can_override: true });
        return 'handled';
      }
      json(202, { ok: true, job_id: 'job-car' });
      return 'handled';
    }
    if (entry.path.startsWith('/api/design/jobs/')) {
      const id = entry.path.split('/').pop();
      if (id === 'job-build') {
        built += 1;
        if (built < 2) { json(200, { ok: true, job: { id, status: 'running', progress: { stage: 'review', round: 1 } } }); return 'handled'; }
        systems.style_1 = { ...LILAC, ratio: '9:16' };
        styles[0] = { ...styles[0], ratio: '9:16' };
        json(200, { ok: true, job: { id, status: 'done', result: { system: systems.style_1, style: { id: 'style_1', name: 'OPA lilac' } } } });
        return 'handled';
      }
      const last = (calls.filter((c) => c[0] === 'carousel').pop() || [])[1] || {};
      json(200, { ok: true, job: { id, status: 'done', result: { title: 'Gastric', angle: 'a', caption: 'c', hashtags: ['#a'], slides: [1, 2, 3].map((i) => ({ url: `${PNG}#s${i}`, pattern: 'blobhook', slots: { title: `T${i}` }, critic: { score: 5, problems: [] } })), sources: [], style: { id: last.style_id || 'style_1', name: 'x' } } } });
      return 'handled';
    }
    if (entry.path === '/api/chat/v2') {
      calls.push(['chat', body()]);
      json(200, { reply: 'That came out square, so I am rebuilding OPA lilac at 9:16.', coach_actions: [{ type: 'design_style', name: 'OPA lilac', notes: '', source_image_url: 'https://store.test/ref-1.png', example_urls: ['https://store.test/ref-1.png', 'https://store.test/ref-2.png'], ratio: '9:16', rebuild_style_id: 'style_1', then_carousel: { brief: 'What is gastric cancer, eight slides for the UK public', slides: 8 } }] });
      return 'handled';
    }
    return undefined;
  };
}

test('Carousels tab: a style of the wrong size is refused before any work, and the owner can use the style that fits', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: sizeMock(calls) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.fill('#dsv2-brief', 'What is gastric cancer, eight slides for the UK public');
  await page.locator('#dsv2-slides').selectOption('8');
  await page.click('#dsv2-go');
  const ask = page.locator('#dsv2-make-status .dsv2-ask');
  await expect(ask).toContainText('OPA lilac makes 1:1 carousels, but carousels are 9:16');
  await expect(ask).toContainText('Nothing was made');
  await expect(page.locator('#dsv2-go')).toBeEnabled();
  expect(calls.filter((c) => c[0] === 'carousel')).toHaveLength(1);

  await ask.getByRole('button', { name: 'Use Mint' }).click();
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(2);
  const second = calls.filter((c) => c[0] === 'carousel')[1][1];
  expect(second).toMatchObject({ style_id: 'style_2', brief: 'What is gastric cancer, eight slides for the UK public', count: 8 });
  expect(second.format_override).toBeUndefined();
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });
  expect(errors).toEqual([]);
});

test('Carousels tab: "Make it anyway" makes the wrong-size carousel on purpose, once', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: sizeMock(calls) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.fill('#dsv2-brief', 'What is gastric cancer, eight slides for the UK public');
  await page.click('#dsv2-go');
  await page.locator('#dsv2-make-status .dsv2-ask').getByRole('button', { name: 'Make it anyway' }).click();
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length).toBe(2);
  expect(calls.filter((c) => c[0] === 'carousel')[1][1].format_override).toBe(true);
  await expect(page.locator('#dsv2-done .dsv2-slide')).toHaveCount(3, { timeout: 10000 });
  // The next one asks again: the override was for that carousel only.
  await page.click('#dsv2-go');
  await expect(page.locator('#dsv2-make-status .dsv2-ask')).toContainText('Nothing was made');
  expect(calls.filter((c) => c[0] === 'carousel')[2][1].format_override).toBeUndefined();
});

test('the new-style form defaults to 9:16 and says carousels need it when another shape is picked', async ({ page }) => {
  const calls = [];
  await mockApi(page, srv.base, { onRequest: sizeMock(calls) });
  await login(page, srv.base);
  await page.evaluate(() => window.switchNav('brand-design'));
  await page.click('#dsv2-newstyle');
  await expect(page.locator('#dsv2-ratio')).toHaveValue('9:16');
  await expect(page.locator('#dsv2-ratio-hint')).toHaveText('');
  await page.locator('#dsv2-ratio').selectOption('1:1');
  await expect(page.locator('#dsv2-ratio-hint')).toContainText('Carousels are 9:16');
});

test('Coach chat: a wrong-size style is rebuilt in place from its own references, then the carousel is made in it', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = [];
  await mockApi(page, srv.base, { onRequest: sizeMock(calls) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await page.fill('#chat-input', 'it came out 1:1, fix it');
  await page.click('#chat-send');
  await expect(page.locator('.coach-progress').first()).toContainText('Rebuilding your style "OPA lilac" at 9:16', { timeout: 10000 });
  await expect.poll(() => calls.filter((c) => c[0] === 'build').length, { timeout: 15000 }).toBe(1);
  const build = calls.find((c) => c[0] === 'build')[1];
  expect(build).toMatchObject({ style_id: 'style_1', ratio: '9:16', style_name: 'OPA lilac', example_urls: ['https://store.test/ref-1.png', 'https://store.test/ref-2.png'] });
  expect(build.add).toBeUndefined();
  await expect.poll(() => calls.filter((c) => c[0] === 'carousel').length, { timeout: 20000 }).toBe(1);
  const car = calls.find((c) => c[0] === 'carousel')[1];
  expect(car).toMatchObject({ style_id: 'style_1', count: 8 });
  expect(car.source_image_url, 'a rebuild\'s references are the look to copy, not a poster to turn into a carousel').toBeUndefined();
  expect(car.format_override).toBeUndefined();
  await expect(page.locator('.coach-progress').last()).toContainText('The carousel is ready: 3 slides in "OPA lilac"', { timeout: 15000 });
  expect(errors).toEqual([]);
});
