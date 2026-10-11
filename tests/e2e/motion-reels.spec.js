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
