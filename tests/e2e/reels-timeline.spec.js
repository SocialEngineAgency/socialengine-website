// Reels (new look): the timeline edits every track, not just the shots. The voiceover and
// the music bed move by dragging or arrow keys, and each track's inspector sets volume,
// on or off, the words (voice), and where the song starts, fades and looping (music).
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const scene = (i) => ({ id: 's' + i, order: i, status: 'ready', duration_target: 5, video_sec: 5, video_url: `https://store.test/s${i}.mp4`, keyframe_url: `https://store.test/k${i}.png`, action: `Shot ${i} action` });
const VO = 'Winter can take its toll on your body and your mind. Look after yourself this season.';
const words = VO.split(' ');
const project = {
  id: 'proj_tl', status: 'ready', mode: 'video', look: 'stylized', agent_brief: { title: 'Winter Wellbeing Reel', shots: [1, 2, 3].map((i) => ({ action: `Shot ${i} action` })) },
  final_url: 'https://store.test/final.mp4', vo_script: VO, vo_url: 'https://store.test/vo.mp3',
  caption_cues: words.map((w, i) => ({ i, text: w, start: i * 0.4, end: i * 0.4 + 0.35 })),
  music_bed_url: 'https://store.test/bed.mp3', music_prompt: 'Warm acoustic guitar, gentle', music_length_ms: 20000,
  pipeline: { assemble: { vo: true, captions: true, music: true, outro: false } },
  scenes: [scene(1), scene(2), scene(3)],
  chat: [{ role: 'user', text: 'A reel about staying well in winter' }, { role: 'system', kind: 'final', text: 'Final reel ready: 3 shots with voiceover and captions.' }],
};

test('Reels timeline: move the voice and the music, set volume, words, song start, fades, loop and captions, then save', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { timeline: null };
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/animation/projects/proj_tl/timeline') {
        sent.timeline = JSON.parse(entry.body || '{}');
        json(200, { ok: true, removed: 0, reordered: false, trimmed: 0, rebuilding: false, revoice: true, project });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_tl"]');

  // Read mode draws the voice from the real word timings and the bed under everything.
  await expect(page.locator('.nl-atl__b--vo')).toHaveCount(1);
  await expect(page.locator('.nl-atl__b--music')).toHaveCount(1);
  await page.click('[data-nl-tl-edit]');
  await expect(page.locator('.nl-tle__row')).toHaveCount(4);
  await page.waitForSelector('.nl-tle__rows[data-probed]');
  await expect(page.locator('[data-tl="save"]')).toBeDisabled();

  // Drag the voiceover later, then type an exact start.
  const vo = page.locator('[data-audio="vo"]');
  const box = await vo.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-insp="vo"]')).toBeVisible();
  await expect(vo).not.toHaveAttribute('aria-label', /starts at 0\.0 seconds/);
  await expect(page.locator('[data-tl="save"]')).toBeEnabled();
  await page.locator('[data-a="vo.start"]').fill('1.5');
  await page.locator('[data-a="vo.start"]').dispatchEvent('change');
  await expect(page.locator('[data-audio="vo"]')).toHaveAttribute('aria-label', /starts at 1\.5 seconds/);
  // Captions move with the voice.
  const capLeft = await page.locator('.nl-tle__cap').first().evaluate((n) => parseFloat(n.style.left));
  expect(capLeft).toBeGreaterThan(9);
  await page.locator('[data-a="vo.volume"]').evaluate((n) => { n.value = '80'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('[data-insp="vo"] output')).toHaveText('80%');
  await page.locator('[data-a="vo.script"]').fill('Winter can take its toll. Look after yourself.');
  await expect(page.locator('[data-tl-play="vo"]')).toBeDisabled();

  // The music bed: song from 12s, fade out, loop, and nudge its start with the arrow keys.
  await page.click('[data-track="music"]');
  await expect(page.locator('[data-insp="music"]')).toBeVisible();
  await page.locator('[data-a="music.in"]').fill('12');
  await page.locator('[data-a="music.in"]').dispatchEvent('change');
  await expect(page.locator('[data-insp="music"] .nl-tle__note')).toContainText('ends before the video does');
  await page.locator('[data-a="music.fade_out"]').fill('2');
  await page.locator('[data-a="music.fade_out"]').dispatchEvent('change');
  await page.locator('[data-insp="music"] .nl-tle__sw', { hasText: 'Loop' }).click();
  await expect(page.locator('.nl-tle__fade--out')).toHaveCount(1);
  await expect(page.locator('[data-audio="music"] .nl-tle__alab')).toContainText('from 12.0s · loops');
  await page.locator('[data-audio="music"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-audio="music"]')).toHaveAttribute('aria-label', /starts at 0\.2 seconds/);

  // Captions off.
  await page.click('[data-track="cap"]');
  await page.locator('[data-insp="cap"] .nl-tle__sw').click();
  await expect(page.locator('[data-track="cap"]')).toContainText('Off');

  await page.click('[data-tl="save"]');
  await expect.poll(() => sent.timeline && sent.timeline.audio).toEqual({
    vo: { start: 1.5, volume: 0.8, script: 'Winter can take its toll. Look after yourself.' },
    music: { start: 0.2, in: 12, fade_out: 2, loop: true },
    captions: { on: false },
  });
  expect(sent.timeline.scene_ids).toEqual(['s1', 's2', 's3']);
  await expect(page.locator('.nl-tle__rows')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Reels timeline: pick another voice for the voiceover and save it', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { timeline: null };
  const voices = {
    default_id: 'rachel_id',
    voices: [
      { id: 'rachel_id', name: 'Standard voice', blurb: 'Clear and neutral.', accent: 'American', gender: 'Female' },
      { id: 'si0svtk05vPEuvwAW93c', name: 'Blondie', blurb: 'A powerful British woman with dramatic flair.', accent: 'British', gender: 'Female', preview_url: 'https://store.test/blondie.mp3' },
    ],
  };
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/animation/voices') { json(200, voices); return 'handled'; }
      if (entry.path === '/api/animation/projects/proj_tl/timeline') {
        sent.timeline = JSON.parse(entry.body || '{}');
        json(200, { ok: true, removed: 0, reordered: false, trimmed: 0, rebuilding: false, revoice: true, project });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_tl"]');
  await page.click('[data-nl-tl-edit]');
  await page.waitForSelector('.nl-tle__rows[data-probed]');
  await expect(page.locator('[data-tl="save"]')).toBeDisabled();

  await page.click('[data-track="vo"]');
  const pick = page.locator('select[data-a="vo.voice"]');
  await expect(pick).toBeVisible();
  await expect(pick).toHaveValue('rachel_id');
  await expect(page.locator('[data-tl="save"]')).toBeDisabled();

  await pick.selectOption('si0svtk05vPEuvwAW93c');
  await expect(page.locator('[data-tl="save"]')).toBeEnabled();
  await expect(page.locator('[data-insp="vo"]')).toContainText('recorded again in the new voice');
  await expect(page.locator('[data-tl-voice-sample]')).toBeVisible();

  await page.click('[data-tl="save"]');
  await expect.poll(() => sent.timeline && sent.timeline.audio).toEqual({ vo: { voice: 'si0svtk05vPEuvwAW93c' } });
  expect(errors).toEqual([]);
});

test('Reels timeline: the voice list arriving mid-drag does not swap the voiceover bar out from under the pointer', async ({ page }) => {
  const errors = watchErrors(page);
  let release;
  const held = new Promise((r) => { release = r; });
  const voices = {
    default_id: 'rachel_id',
    voices: [
      { id: 'rachel_id', name: 'Standard voice', blurb: 'Clear and neutral.', accent: 'American', gender: 'Female' },
      { id: 'si0svtk05vPEuvwAW93c', name: 'Blondie', blurb: 'A powerful British woman with dramatic flair.', accent: 'British', gender: 'Female' },
    ],
  };
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/animation/voices') { await held; json(200, voices); return 'handled'; }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_tl"]');
  await page.click('[data-nl-tl-edit]');
  await page.waitForSelector('.nl-tle__rows[data-probed]');

  // Open the voiceover track: the voice list is requested and held back.
  await page.click('[data-track="vo"]');
  await expect(page.locator('[data-insp="vo"]')).toBeVisible();
  const vo = page.locator('[data-audio="vo"]');
  await vo.evaluate((e) => { e.dataset.same = 'yes'; });
  const box = await vo.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 3 });

  // The list lands while the bar is still held: nothing is redrawn under the pointer.
  release();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-audio="vo"]')).toHaveAttribute('data-same', 'yes');
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();

  // Once it lands, the panel picks up the voice choice and the move counts.
  await expect(page.locator('select[data-a="vo.voice"]')).toBeVisible();
  await expect(page.locator('[data-audio="vo"]')).not.toHaveAttribute('aria-label', /starts at 0\.0 seconds/);
  await expect(page.locator('[data-tl="save"]')).toBeEnabled();
  expect(errors).toEqual([]);
});
