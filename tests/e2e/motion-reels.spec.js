// Motion Reels (HyperFrames): text Reel from a caption, carousel → Reel. Hermetic — mocked API.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const OPTIONS = {
  enabled: true,
  defaults: { palette: { bg: '#102030', accent: '#22C55E' }, handle: 'linenco', cta: 'Shop the linen edit' },
  fonts: ['inter', 'poppins', 'montserrat', 'dmsans', 'playfair'],
  music: [{ name: 'Warm acoustic', url: 'https://cdn.example/music/warm.mp3' }],
  daily_cap: 20,
  used_today: 2,
};

function motionMock(renders, { pollsBeforeDone = 1 } = {}) {
  let polls = 0;
  return async (entry, route, json) => {
    if (entry.path === '/api/motion/options') { json(200, OPTIONS); return 'handled'; }
    if (entry.path === '/api/motion/beats') {
      json(200, { beats: ['Linen hates hot water.', 'It *shrinks* fast.', 'Cold wash, hang dry.'], cta: '' });
      return 'handled';
    }
    if (entry.path === '/api/motion/render') {
      renders.push(JSON.parse(entry.body || '{}'));
      json(202, { job_id: 'mot_1', status: 'processing', used_today: 3, daily_cap: 20 });
      return 'handled';
    }
    if (entry.path === '/api/motion/jobs/mot_1') {
      polls += 1;
      json(200, polls > pollsBeforeDone
        ? { job_id: 'mot_1', status: 'done', video_url: 'https://cdn.example/reel.mp4' }
        : { job_id: 'mot_1', status: 'processing', video_url: null });
      return 'handled';
    }
    return undefined;
  };
}

test('Text Reel from a Content Review caption: writes beats, sends brand defaults, shows the finished video', async ({ page }) => {
  const renders = [];
  const data = clientData({ content: [{ id: 'recP1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Most people wash linen wrong. Hot water shrinks it.\n\n#linen' }] });
  await mockApi(page, srv.base, { data, onRequest: motionMock(renders) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-card[data-post-id="recP1"] .studio-card__caption');
  await expect(page.locator('.post-caption-edit[data-post-id="recP1"]')).toBeVisible();
  await page.locator('.mr-attach').first().click();
  await expect(page.locator('#mr-lines')).toHaveValue('Linen hates hot water.\nIt *shrinks* fast.\nCold wash, hang dry.');
  await expect(page.locator('#mr-cta')).toHaveValue('Shop the linen edit');
  await expect(page.locator('#mr-cap')).toHaveText('2 of 20 used today');
  await page.selectOption('#mr-style', 'pop');
  await page.selectOption('#mr-music', 'https://cdn.example/music/warm.mp3');
  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel.mp4', { timeout: 15000 });
  await expect(page.locator('#mr-download')).toBeVisible();
  await expect(page.locator('#mr-cap')).toHaveText('3 of 20 used today');
  expect(renders[0]).toMatchObject({
    kind: 'text', style: 'pop', handle: 'linenco', cta: 'Shop the linen edit',
    beats: ['Linen hates hot water.', 'It *shrinks* fast.', 'Cold wash, hang dry.'],
    palette: { bg: '#102030', accent: '#22c55e' }, music_url: 'https://cdn.example/music/warm.mp3',
  });
});

test('Voiceover + footage tab: writes the script, edits scenes and footage words, renders with stock clips', async ({ page }) => {
  const renders = [];
  const scripts = [];
  const base = motionMock(renders);
  const data = clientData({ content: [{ id: 'recP1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Why linen should never go in a hot wash.' }] });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/options') {
        json(200, { ...OPTIONS, faceless: { enabled: true, stock: true, library_media: 2, daily_cap: 5, used_today: 1 } });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/script') {
        scripts.push(JSON.parse(entry.body || '{}'));
        json(200, { scenes: [{ line: 'Most people wash linen wrong.', search: 'washing machine' }, { line: 'Hot water shrinks it fast.', search: 'steam hot water' }], cta: 'Shop the linen edit' });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/render') {
        renders.push({ faceless: true, ...JSON.parse(entry.body || '{}') });
        json(202, { job_id: 'mot_1', status: 'processing', footage: 'stock', used_today: 2, daily_cap: 5 });
        return 'handled';
      }
      return base(entry, route, json);
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-card[data-post-id="recP1"] .studio-card__caption');
  await page.locator('.mr-attach').first().click();
  await page.click('.mr-tab[data-mode="faceless"]');
  await expect(page.locator('#mr-cap')).toHaveText('1 of 5 used today');
  await expect(page.locator('input[data-scene-line="0"]')).toHaveValue('Most people wash linen wrong.');
  expect(scripts[0].text).toContain('Why linen should never go in a hot wash.');
  await page.locator('input[data-scene-search="1"]').fill('kettle boiling');
  await page.click('#mr-scene-add');
  await page.locator('input[data-scene-line="2"]').fill('Wash it cold and hang it dry.');
  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel.mp4', { timeout: 15000 });
  await expect(page.locator('#mr-cap')).toHaveText('2 of 5 used today');
  const r = renders.find((x) => x.faceless);
  expect(r.kind).toBeUndefined();
  expect(r).toMatchObject({
    footage: 'stock', cta: 'Shop the linen edit', handle: 'linenco',
    scenes: [
      { line: 'Most people wash linen wrong.', search: 'washing machine' },
      { line: 'Hot water shrinks it fast.', search: 'kettle boiling' },
      { line: 'Wash it cold and hang it dry.', search: '' },
    ],
  });
  await page.click('.mr-tab[data-mode="text"]');
  await expect(page.locator('#mr-lines')).toBeVisible();
});

test('Carousel → Reel sends slides in order with seconds per slide; a failed render shows the reason', async ({ page }) => {
  const renders = [];
  const base = motionMock(renders);
  await mockApi(page, srv.base, {
    data: clientData({}),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/jobs/mot_1' && renders.length === 1) {
        json(200, { job_id: 'mot_1', status: 'failed', error: 'The render worker is busy. Try again in a minute.' });
        return 'handled';
      }
      return base(entry, route, json);
    },
  });
  await login(page, srv.base);
  await page.evaluate(() => window.seOpenMotionReel({ kind: 'carousel', slides: ['https://cdn.example/s1.png', 'http://insecure/s2.png', 'https://cdn.example/s3.png'], name: 'Linen care' }));
  await expect(page.locator('.mr-thumbs img')).toHaveCount(2);
  await page.selectOption('#mr-secs', '3.5');
  await page.click('#mr-go');
  await expect(page.locator('#mr-stage')).toContainText('The render worker is busy', { timeout: 15000 });
  expect(renders[0]).toMatchObject({ kind: 'carousel', slides: ['https://cdn.example/s1.png', 'https://cdn.example/s3.png'], seconds_per_slide: 3.5, name: 'Linen care' });
  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel.mp4', { timeout: 15000 });
});
