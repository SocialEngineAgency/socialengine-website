// Brand carousel templates in Design Studio: build one from example slides, then turn the poster into slides. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TEMPLATE = {
  type: 'carousel_template', version: 2, id: '', name: 'Read from slides', aspect: '4:5',
  fonts: { heading: 'inter', body: 'inter' },
  palette: { bg: '#FFFFFF', fg: '#111111', accent: '#1F4E79', muted: '#666666' },
  layouts: { cover: { objects: [] }, content: { objects: [{ kind: 'text', slot: 'title' }] }, cta: { objects: [] } },
};

test('example slides → review → saved default → Build in brand template → edit one slide', async ({ page }) => {
  const calls = [];
  let saved = [];
  let uploads = 0;
  await mockApi(page, srv.base, {
    onRequest: async (entry, route, json) => {
      const body = () => JSON.parse(route.request().postData() || '{}');
      const m = route.request().method();
      if (entry.path === '/api/studio/upload-image') { uploads += 1; json(200, { url: `https://store.test/ex${uploads}.png` }); return 'handled'; }
      if (entry.path === '/api/carousel-templates' && m === 'GET') {
        json(200, { templates: saved, fonts: [{ id: 'inter', name: 'Inter' }, { id: 'montserrat', name: 'Montserrat' }] });
        return 'handled';
      }
      if (entry.path === '/api/carousel-templates' && m === 'POST') {
        const b = body();
        calls.push(['save', b]);
        const t = { ...b.template, id: 'ct_1', is_default: true };
        saved = [t];
        json(200, { template: t, templates: saved });
        return 'handled';
      }
      if (entry.path === '/api/carousel-templates/extract') {
        calls.push(['extract', body()]);
        json(200, { template: TEMPLATE, previews: { cover: PNG, content: PNG, cta: PNG }, fonts: [{ id: 'inter', name: 'Inter' }, { id: 'montserrat', name: 'Montserrat' }] });
        return 'handled';
      }
      if (entry.path === '/api/carousel-templates/fill') {
        calls.push(['fill', body()]);
        json(200, { template_id: 'ct_1', slides: [
          { index: 1, layout: 'cover', kicker: 'Guide', title: 'Stages', body: '', art_box: null },
          { index: 2, layout: 'content', kicker: 'Stage II', title: 'Locally advanced', body: 'Muscle layer.', art_box: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
          { index: 3, layout: 'cta', kicker: '', title: 'Talk to your GP', body: '', art_box: null },
        ] });
        return 'handled';
      }
      if (entry.path === '/api/carousel-templates/render') {
        const b = body();
        calls.push(['render', b]);
        const idx = b.only_index ? [b.only_index] : b.slides.map((_, i) => i + 1);
        json(200, { slides: idx.map((i) => ({ index: i, url: `${PNG}#s${i}${b.only_index ? '-v2' : ''}`, layout: b.slides[i - 1].layout, overflow: [] })) });
        return 'handled';
      }
      return undefined;
    },
  });
  await login(page, srv.base);
  await page.evaluate(() => {
    window._studioReference = { url: 'https://store.test/master.png', type: 'image', title: '4K poster' };
    window.switchNav('design-studio');
  });

  const build = page.locator('#cs-build-template');
  await expect(build).toBeDisabled();

  await page.locator('summary', { hasText: 'Saved & templates' }).click();
  await page.locator('#sct-files').setInputFiles([
    { name: '1.png', mimeType: 'image/png', buffer: Buffer.from('a') },
    { name: '2.png', mimeType: 'image/png', buffer: Buffer.from('b') },
    { name: '3.png', mimeType: 'image/png', buffer: Buffer.from('c') },
  ]);
  const review = page.locator('#sct-review');
  await expect(review).toBeVisible();
  expect(calls.find((c) => c[0] === 'extract')[1].slide_urls).toEqual(['https://store.test/ex1.png', 'https://store.test/ex2.png', 'https://store.test/ex3.png']);
  await review.locator('#sct-name').fill('Clinic stages');
  await review.locator('#sct-font-heading').selectOption('montserrat');
  await review.locator('#sct-save').click();
  await expect(review).toHaveCount(0);
  const save = calls.find((c) => c[0] === 'save')[1];
  expect(save.template.name).toBe('Clinic stages');
  expect(save.template.fonts.heading).toBe('montserrat');
  expect(save.make_default).toBe(true);
  await expect(page.locator('#cs-brand-templates')).toContainText('Clinic stages');

  await page.locator('summary').filter({ has: page.locator('span', { hasText: /^Carousel$/ }) }).click();
  await expect(build).toBeEnabled();
  await page.locator('#cs-tpl-count').selectOption('3');
  await build.click();
  await expect(page.locator('#cs-slide-strip .cs-slide-btn')).toHaveCount(3);
  const fill = calls.find((c) => c[0] === 'fill')[1];
  expect(fill).toMatchObject({ template_id: 'ct_1', master_image_url: 'https://store.test/master.png', count: 3 });
  await expect(page.locator('#cs-slide-redo')).toBeHidden();

  await page.locator('#cs-slide-strip .cs-slide-btn').nth(1).click();
  const editor = page.locator('#cs-tpl-editor');
  await expect(editor).toContainText('Slide 2 of 3');
  await expect(editor.locator('#sct-e-title')).toHaveValue('Locally advanced');
  await editor.locator('#sct-e-title').fill('Stage II: locally advanced');
  await editor.locator('#sct-e-apply').click();
  await expect.poll(() => calls.filter((c) => c[0] === 'render').length).toBe(2);
  const redo = calls.filter((c) => c[0] === 'render')[1][1];
  expect(redo.only_index).toBe(2);
  expect(redo.slides[1].title).toBe('Stage II: locally advanced');
  await expect(page.locator('#cs-slide-strip .cs-slide-btn').nth(1).locator('img')).toHaveAttribute('src', /#s2-v2$/);
});
