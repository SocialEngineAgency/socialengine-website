// Reels (new look): the voiceover has a Save button and keeps unsaved words through every
// redraw; the change box sits next to Tweak, which lights up once there is something to
// do; the captions can say different words from the voice (OPA on screen while the voice
// says O P A), in the Captions card and line by line under the timeline.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const VO = 'Support from O P A is always here for you and your family this autumn';
const scene = (i) => ({ id: 's' + i, order: i, status: 'ready', duration_target: 5, video_sec: 5, video_url: `https://store.test/s${i}.mp4`, keyframe_url: `https://store.test/k${i}.png`, action: `Shot ${i} action` });
const makeProject = () => ({
  id: 'proj_w', status: 'ready', mode: 'video', look: 'stylized', agent_brief: { title: 'Autumn support', shots: [1, 2].map((i) => ({ action: `Shot ${i} action` })) },
  final_url: 'https://store.test/final.mp4', vo_script: VO, vo_url: 'https://store.test/vo.mp3',
  caption_cues: VO.split(' ').map((w, i) => ({ i, text: w, start: i * 0.4, end: i * 0.4 + 0.35 })),
  pipeline: { assemble: { vo: true, captions: true, music: false, outro: false } },
  // Shot 2 is still being checked, so the page keeps polling (and redrawing).
  scenes: [scene(1), { ...scene(2), check: { status: 'checking', video_url: 'https://store.test/s2.mp4', started_at: new Date(Date.now() + 3600e3).toISOString() } }],
  chat: [{ role: 'user', text: 'A reel about support' }, { role: 'system', kind: 'final', text: 'Final reel ready: 2 shots with voiceover and captions.' }],
});

async function open(page, project, sent) {
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/animation/projects/proj_w/settings') {
        const body = JSON.parse(entry.body || '{}');
        sent.settings.push(body);
        if (body.vo_script != null) project.vo_script = body.vo_script;
        if (body.caption_script != null) {
          if (body.caption_script) { project.caption_script = body.caption_script; project.caption_source = 'client'; } else { delete project.caption_script; delete project.caption_source; }
        }
        json(200, { project: { ...project } });
        return 'handled';
      }
      if (entry.path === '/api/animation/projects/proj_w/generate-vo') {
        const body = JSON.parse(entry.body || '{}');
        sent.tweak.push(body);
        project.vo_script = 'Support from O P A is here for you.';
        json(200, { project: { ...project }, vo_script: project.vo_script, revised: true });
        return 'handled';
      }
      if (entry.path === '/api/animation/projects/proj_w/timeline') {
        sent.timeline = JSON.parse(entry.body || '{}');
        json(200, { ok: true, removed: 0, reordered: false, trimmed: 0, rebuilding: false, project: { ...project } });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_w"]');
}

const card = (page, title) => page.locator('.nl-lane', { has: page.locator('.nl-lane__t', { hasText: title }) });

test('Voiceover: Save lights up, unsaved words survive a redraw, and Tweak sits by the change box', async ({ page }) => {
  const errors = watchErrors(page);
  const project = makeProject();
  const sent = { settings: [], tweak: [], timeline: null };
  await open(page, project, sent);
  const vo = card(page, 'Voiceover');
  await vo.locator('.nl-lane__edit').click();
  const save = vo.locator('#anim-vo-save');
  await expect(save).toBeDisabled();
  await expect(vo.locator('#anim-vo-state')).toHaveText('Saved');

  await vo.locator('#anim-vo-script').fill(`${VO}. Reach out today.`);
  await expect(save).toBeEnabled();
  await expect(save).toHaveClass(/is-lit/);
  await expect(vo.locator('#anim-vo-state')).toHaveText('Not saved');

  // Something else lands (a new chat line): the page redraws, the typed words stay.
  project.chat = [...project.chat, { role: 'system', kind: 'shot_check', text: 'Shot 1 redone and checked: it looks right now.' }];
  await expect(page.locator('.nl-tsys', { hasText: 'redone and checked' })).toHaveCount(1, { timeout: 10000 });
  await expect(card(page, 'Voiceover').locator('#anim-vo-script')).toHaveValue(`${VO}. Reach out today.`);

  await card(page, 'Voiceover').locator('#anim-vo-save').click();
  await expect.poll(() => sent.settings.length).toBe(1);
  expect(sent.settings[0]).toEqual({ vo_script: `${VO}. Reach out today.` });
  await expect(card(page, 'Voiceover').locator('#anim-vo-state')).toHaveText('Saved');
  await expect(card(page, 'Voiceover').locator('#anim-vo-save')).toBeDisabled();

  // Tweak: off until there is a change to make, then lit; it sends the change.
  const lane = card(page, 'Voiceover');
  const tweak = lane.locator('#anim-vo-generate');
  await expect(tweak).toHaveText('Tweak');
  await expect(tweak).toBeDisabled();
  await expect(lane.locator('#anim-vo-direction')).toHaveAttribute('placeholder', /Describe your changes/);
  await lane.locator('#anim-vo-direction').fill('Make it shorter');
  await expect(tweak).toBeEnabled();
  await expect(tweak).toHaveClass(/is-lit/);
  await tweak.click();
  await expect.poll(() => sent.tweak.length).toBe(1);
  expect(sent.tweak[0].direction).toBe('Make it shorter');
  await expect(card(page, 'Voiceover').locator('#anim-vo-script')).toHaveValue('Support from O P A is here for you.');
  await expect(card(page, 'Voiceover').locator('#anim-vo-direction')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('Captions: their own words in the Captions card, and line by line under the timeline', async ({ page }) => {
  const errors = watchErrors(page);
  const project = makeProject();
  const sent = { settings: [], tweak: [], timeline: null };
  await open(page, project, sent);
  const caps = card(page, 'Captions');
  await caps.locator('.nl-lane__edit').click();
  const words = caps.locator('#anim-cap-words');
  await expect(words).toHaveValue(VO);
  await expect(caps.locator('#anim-cap-state')).toHaveText('Following the voiceover');
  await words.fill(VO.replace('O P A', 'OPA'));
  await expect(caps.locator('#anim-cap-words-save')).toBeEnabled();
  await caps.locator('#anim-cap-words-save').click();
  await expect.poll(() => sent.settings.length).toBe(1);
  expect(sent.settings[0]).toEqual({ caption_script: VO.replace('O P A', 'OPA') });
  await expect(card(page, 'Captions').locator('#anim-cap-state')).toHaveText('Your own words');
  await expect(card(page, 'Captions').locator('.nl-lane__sum')).toHaveCount(1);

  // Under the timeline: click Captions, change one line, save.
  await page.click('[data-nl-tl-edit]');
  await page.waitForSelector('.nl-tle__rows[data-probed]');
  await page.click('[data-track="cap"]');
  const lines = page.locator('[data-cap-line]');
  await expect(lines.first()).toBeVisible();
  const n = await lines.count();
  expect(n).toBeGreaterThan(2);
  await lines.first().fill('Support from OPA,');
  await expect(page.locator('.nl-tle__cap').first()).toHaveText('Support from OPA,');
  await expect(page.locator('[data-tl="save"]')).toBeEnabled();
  await page.click('[data-tl="save"]');
  await expect.poll(() => sent.timeline && sent.timeline.audio && sent.timeline.audio.captions).toBeTruthy();
  expect(sent.timeline.audio.captions.text.startsWith('Support from OPA,')).toBe(true);
  expect(sent.timeline.audio.vo).toBeUndefined();
  expect(errors).toEqual([]);
});
