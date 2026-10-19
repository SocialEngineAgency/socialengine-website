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

const SWATCH = (c) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="${c}"/></svg>`)}`;
const OPT = (id, type, query, color) => ({
  id: type === 'image' ? `pixabay-photo:${id}` : `pixabay:${id}`, type, query, credit: 'ann', duration: type === 'image' ? 0 : 12,
  url: type === 'image' ? `https://pixabay.com/get/${id}.jpg` : `https://cdn.pixabay.com/video/${id}_medium.mp4`,
  thumb: SWATCH(color), preview: '', source_url: `https://pixabay.com/videos/${id}`,
});

test('Voiceover + footage: footage is found per scene before the Reel is made; pick, More, other searches, then render with the picks', async ({ page }) => {
  const renders = [];
  const scripts = [];
  const searches = [];
  const base = motionMock(renders);
  const data = clientData({ content: [{ id: 'recP1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Why linen should never go in a hot wash.' }] });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/options') {
        json(200, { ...OPTIONS, faceless: { enabled: true, stock: true, stock_source: 'Pixabay', library_media: 2, daily_cap: 5, used_today: 1 } });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/script') {
        scripts.push(JSON.parse(entry.body || '{}'));
        json(200, { scenes: [
          { line: 'Most people wash linen wrong.', search: 'washing machine', searches: ['washing machine', 'laundry', 'clothes'] },
          { line: 'Hot water shrinks it fast.', search: 'steam hot water', searches: ['steam hot water', 'kettle', 'water'] },
        ], cta: 'Shop the linen edit' });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/footage') {
        const body = JSON.parse(entry.body || '{}');
        searches.push(body);
        const answer = (sc) => {
          const q = String(sc.search || '').toLowerCase();
          if (q === 'washing machine') {
            return body.offset
              ? { options: [OPT(4, 'video', 'washing machine', '#334155')], more: false, searched: ['washing machine'], found: ['washing machine'] }
              : { options: [OPT(1, 'video', 'washing machine', '#1e3a8a'), OPT(2, 'video', 'washing machine', '#7c3aed'), OPT(3, 'image', 'washing machine', '#0e7490')], more: true, searched: ['washing machine'], found: ['washing machine'] };
          }
          if (q === 'steam hot water') return { options: [OPT(5, 'video', 'kettle', '#b45309')], more: false, searched: ['steam hot water', 'kettle'], found: ['kettle'] };
          if (q === 'water') return { options: [OPT(6, 'video', 'water', '#0369a1'), OPT(7, 'image', 'water', '#15803d')], more: false, searched: ['water'], found: ['water'] };
          if (q === 'linen') return { options: [OPT(8, 'image', 'linen', '#a16207')], more: false, searched: ['linen'], found: ['linen'] };
          return { options: [], more: false, searched: [q], found: [] };
        };
        json(200, { source: 'Pixabay', scenes: body.scenes.map(answer) });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/render') {
        renders.push({ faceless: true, ...JSON.parse(entry.body || '{}') });
        json(202, { job_id: 'mot_1', status: 'processing', footage: 'stock', used_today: 2, daily_cap: 5 });
        return 'handled';
      }
      if (entry.path === '/api/motion/jobs/mot_1' && renders.some((r) => r.faceless)) {
        json(200, { job_id: 'mot_1', status: 'done', video_url: 'https://cdn.example/reel.mp4', note: 'Footage: 2 Pixabay clips and 1 Pixabay photo.' });
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
  await expect(page.locator('#mr-footage option[value="stock"]')).toHaveText('Stock clips and photos (free, from Pixabay)');
  await expect(page.locator('#mr-stock-credit a')).toHaveAttribute('href', 'https://pixabay.com/');
  await expect(page.locator('#mr-stock-credit')).toContainText('Searching is free');
  await expect(page.locator('input[data-scene-line="0"]')).toHaveValue('Most people wash linen wrong.');
  expect(scripts[0].text).toContain('Why linen should never go in a hot wash.');

  // Both scenes searched in one go, right after the script; the first option is picked; nothing rendered yet.
  const s1 = page.locator('[data-footage="0"]');
  const s2 = page.locator('[data-footage="1"]');
  await expect(s1.locator('.mr-opt')).toHaveCount(3);
  expect(searches[0].scenes.map((x) => x.search)).toEqual(['washing machine', 'steam hot water']);
  expect(searches[0].scenes[1].searches).toEqual(['steam hot water', 'kettle', 'water']);
  expect(renders).toHaveLength(0);
  await expect(s1.locator('.mr-opt').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(s1.locator('.mr-opt').nth(2).locator('.mr-opt__tag')).toHaveText('Photo');
  await expect(s2.locator('.mr-fmsg')).toHaveText('Nothing for "steam hot water", so these are for "kettle".');
  await expect(s2.locator('.mr-chip[data-q="steam hot water"]')).toHaveClass(/mr-chip--none/);
  await expect(page.locator('#mr-stage .mr-peek')).toContainText('Scene 1: Most people wash linen wrong.');

  // Pick another clip; it shows in the 9:16 frame.
  await s1.locator('.mr-opt').nth(1).click();
  await expect(s1.locator('.mr-opt').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(s1.locator('.mr-opt').first()).toHaveAttribute('aria-pressed', 'false');
  // More pages on from what is shown.
  await s1.locator('.mr-more').click();
  await expect(s1.locator('.mr-opt')).toHaveCount(4);
  expect(searches[1]).toMatchObject({ offset: 3, scenes: [{ search: 'washing machine' }] });
  await expect(s1.locator('.mr-more')).toHaveCount(0);
  await expect(s1.locator('.mr-opt').nth(1)).toHaveAttribute('aria-pressed', 'true');

  // One tap on another search; then a typed search that finds nothing says so plainly.
  await s2.locator('.mr-chip[data-q="water"]').click();
  await expect(s2.locator('.mr-opt')).toHaveCount(2);
  await expect(s2.locator('.mr-chip--on')).toHaveText('water');
  await expect(s2.locator('input[data-scene-search="1"]')).toHaveValue('water');
  await s2.locator('input[data-scene-search="1"]').fill('zzz');
  await s2.locator('input[data-scene-search="1"]').press('Enter');
  await expect(s2.locator('.mr-fmsg')).toContainText('Nothing found. Try one or two simple words');
  await s2.locator('.mr-chip[data-q="water"]').click();
  await s2.locator('.mr-opt').nth(1).click();

  // A line written by hand gets footage from its own words when you move on.
  await page.click('#mr-scene-add');
  await page.locator('input[data-scene-line="2"]').fill('Wash it in cool water and hang the linen to dry.');
  await page.locator('input[data-scene-line="2"]').press('Tab');
  await expect(page.locator('[data-footage="2"] .mr-fmsg')).toContainText('Nothing found');
  await page.locator('input[data-scene-search="2"]').fill('linen');
  await page.locator('[data-find="2"]').click();
  await expect(page.locator('[data-footage="2"] .mr-opt')).toHaveCount(1);

  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel.mp4', { timeout: 15000 });
  await expect(page.locator('#mr-note')).toHaveText('Footage: 2 Pixabay clips and 1 Pixabay photo.');
  await expect(page.locator('#mr-cap')).toHaveText('2 of 5 used today');
  const r = renders.find((x) => x.faceless);
  expect(r.kind).toBeUndefined();
  expect(r).toMatchObject({
    footage: 'stock', cta: 'Shop the linen edit', handle: 'linenco',
    scenes: [
      { line: 'Most people wash linen wrong.', search: 'washing machine', pick: { id: 'pixabay:2', url: 'https://cdn.pixabay.com/video/2_medium.mp4', type: 'video' } },
      { line: 'Hot water shrinks it fast.', search: 'water', pick: { id: 'pixabay-photo:7', type: 'image' } },
      { line: 'Wash it in cool water and hang the linen to dry.', search: 'linen', pick: { id: 'pixabay-photo:8' } },
    ],
  });
  await page.click('.mr-tab[data-mode="text"]');
  await expect(page.locator('#mr-lines')).toBeVisible();
});

test('Library footage: no stock search, no pickers, scenes sent without picks', async ({ page }) => {
  const renders = [];
  const searches = [];
  const base = motionMock(renders);
  await mockApi(page, srv.base, {
    data: clientData({}),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/options') {
        json(200, { ...OPTIONS, faceless: { enabled: true, stock: false, stock_source: '', library_media: 4, daily_cap: 5, used_today: 0 } });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/script') {
        json(200, { scenes: [{ line: 'Our shop opens at nine.', search: 'shop front', searches: ['shop front', 'store'] }], cta: '' });
        return 'handled';
      }
      if (entry.path === '/api/motion/faceless/footage') { searches.push(entry.body); json(400, { error: 'off' }); return 'handled'; }
      if (entry.path === '/api/motion/faceless/render') {
        renders.push({ faceless: true, ...JSON.parse(entry.body || '{}') });
        json(202, { job_id: 'mot_1', status: 'processing', footage: 'library', used_today: 1, daily_cap: 5 });
        return 'handled';
      }
      return base(entry, route, json);
    },
  });
  await login(page, srv.base);
  await page.evaluate(() => window.seOpenMotionReel({ kind: 'faceless', text: 'Our shop opens at nine.', name: 'Hours' }));
  await expect(page.locator('input[data-scene-line="0"]')).toHaveValue('Our shop opens at nine.');
  await expect(page.locator('#mr-footage')).toHaveValue('library');
  await expect(page.locator('[data-footage]')).toHaveCount(0);
  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toBeVisible({ timeout: 15000 });
  expect(searches).toHaveLength(0);
  expect(renders.find((x) => x.faceless).scenes[0].pick).toBeUndefined();
});

test('Music: AI music made to fit is the default, with an optional style; tracks show their length and whether they repeat; Make it now saves and selects a track', async ({ page }) => {
  const renders = [];
  const made = [];
  const base = motionMock(renders);
  await mockApi(page, srv.base, {
    data: clientData({}),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/options') {
        json(200, { ...OPTIONS, ai_music: true, music: [{ id: 'm1', name: 'Warm acoustic', url: 'https://cdn.example/music/warm.mp3', length_ms: 6000 }, { id: 'm2', name: 'Long bed', url: 'https://cdn.example/music/long.mp3', length_ms: 95000 }] });
        return 'handled';
      }
      if (entry.path === '/api/motion/music') {
        made.push(JSON.parse(entry.body || '{}'));
        json(200, { track: { id: 'm3', name: 'Reel music: calm acoustic', url: 'https://cdn.example/music/made.mp3', length_ms: 19000, label: 'calm acoustic' } });
        return 'handled';
      }
      return base(entry, route, json);
    },
  });
  await login(page, srv.base);
  await page.evaluate(() => window.seOpenMotionReel({ kind: 'text', lines: 'Linen hates hot water.\nIt *shrinks* in one wash.\nCold wash, low spin.\nHang it to dry.', name: 'Linen care' }));
  const sel = page.locator('#mr-music');
  await expect(sel).toHaveValue('ai');
  await expect(sel.locator('option[value="https://cdn.example/music/warm.mp3"]')).toHaveText('Warm acoustic · 0:06');
  await expect(page.locator('#mr-music-ai')).toBeVisible();
  await expect(page.locator('#mr-music-fit')).toContainText('the music is made to that length');

  await sel.selectOption('https://cdn.example/music/warm.mp3');
  await expect(page.locator('#mr-music-ai')).toBeHidden();
  await expect(page.locator('#mr-music-fit')).toContainText('this track is 0:06, so it repeats to fill the Reel');
  await expect(page.locator('#mr-music-preview')).toHaveAttribute('src', 'https://cdn.example/music/warm.mp3');
  await sel.selectOption('https://cdn.example/music/long.mp3');
  await expect(page.locator('#mr-music-fit')).toContainText('this track is 1:35, so it fades out when the Reel ends');

  await sel.selectOption('ai');
  await page.locator('#mr-music-style').fill('soft piano');
  await page.click('#mr-music-gen');
  await expect(sel).toHaveValue('https://cdn.example/music/made.mp3');
  await expect(sel.locator('option[value="https://cdn.example/music/made.mp3"]')).toHaveText('Reel music: calm acoustic · 0:19');
  expect(made[0]).toMatchObject({ style: 'soft piano', kind: 'text' });
  expect(made[0].text).toContain('Linen hates hot water.');
  expect(made[0].seconds).toBeGreaterThan(8);

  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toBeVisible({ timeout: 15000 });
  expect(renders[0]).toMatchObject({ kind: 'text', music_url: 'https://cdn.example/music/made.mp3' });
  expect(renders[0].music).toBeUndefined();

  await sel.selectOption('ai');
  await page.click('#mr-go');
  await expect.poll(() => renders.length).toBe(2);
  expect(renders[1]).toMatchObject({ music: 'ai', music_style: 'soft piano' });
  expect(renders[1].music_url).toBeUndefined();
});

test('Carousel → Reel sends slides in order with seconds per slide; a failed render shows the reason', async ({ page }) => {
  const renders = [];
  const base = motionMock(renders);
  await mockApi(page, srv.base, {
    data: clientData({}),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/jobs/mot_1' && renders.length === 1) {
        json(200, { job_id: 'mot_1', status: 'failed', error: 'The render worker is busy. Try again in a minute.', detail: 'render worker 429: busy' });
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
  await expect(page.locator('#mr-error-detail')).toHaveText('Details: render worker 429: busy');
  await expect(page.locator('#mr-stage')).toContainText('This one did not count toward today.');
  expect(renders[0]).toMatchObject({ kind: 'carousel', slides: ['https://cdn.example/s1.png', 'https://cdn.example/s3.png'], seconds_per_slide: 3.5, name: 'Linen care' });
  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel.mp4', { timeout: 15000 });
});

test('End card: shown under a finished Reel, remade by typing or in plain words, the new video replaces the old', async ({ page }) => {
  const renders = [];
  const edits = [];
  let remade = false;
  const base = motionMock(renders, { pollsBeforeDone: 0 });
  const data = clientData({ content: [{ id: 'recP1', status: 'Ready for Review', platform: 'instagram', full_post_text: 'Most people wash linen wrong.\n\n#linen' }] });
  await mockApi(page, srv.base, {
    data,
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/motion/jobs/mot_1/end-card') {
        edits.push(JSON.parse(entry.body || '{}'));
        json(202, { job_id: 'mot_2', status: 'processing', said: 'Shortened the line and used your green.' });
        return 'handled';
      }
      if (entry.path === '/api/motion/jobs/mot_2') {
        remade = true;
        json(200, { job_id: 'mot_2', status: 'done', video_url: 'https://cdn.example/reel2.mp4', end_card: { cta: 'Book a check', handle: 'linenco', palette: { bg: '#102030', accent: '#22C55E' } } });
        return 'handled';
      }
      if (entry.path === '/api/motion/jobs/mot_1') {
        json(200, { job_id: 'mot_1', status: 'done', video_url: 'https://cdn.example/reel.mp4', end_card: { cta: 'Learn the signs, speak to your GP', handle: 'linenco', palette: { bg: '#102030', accent: '#22C55E' } } });
        return 'handled';
      }
      return base(entry, route, json);
    },
  });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.studio-card[data-post-id="recP1"] .studio-card__caption');
  await page.locator('.mr-attach').first().click();
  await page.click('#mr-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel.mp4', { timeout: 15000 });
  await expect(page.locator('#mr-end-cta')).toHaveValue('Learn the signs, speak to your GP');
  await expect(page.locator('#mr-end-handle')).toHaveValue('linenco');
  await page.fill('#mr-end-cta', 'Book a check');
  await page.fill('#mr-end-ask', 'shorter, and use our green');
  await page.click('#mr-end-go');
  await expect(page.locator('#mr-video')).toHaveAttribute('src', 'https://cdn.example/reel2.mp4', { timeout: 15000 });
  await expect(page.locator('#mr-end-said')).toHaveText('Shortened the line and used your green.');
  await expect(page.locator('#mr-download')).toHaveAttribute('href', 'https://cdn.example/reel2.mp4');
  expect(remade).toBe(true);
  expect(edits[0]).toMatchObject({ cta: 'Book a check', handle: 'linenco', instruction: 'shorter, and use our green', palette: { bg: '#102030', accent: '#22c55e' } });
});
