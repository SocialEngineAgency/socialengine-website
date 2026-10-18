// Reels (new look): each shot is checked after it renders. The card says Checking while
// it runs, Checked when it is clean, and shows what was wrong when a shot needs a look;
// the thread says when a broken shot was redone. The page keeps polling until the check lands.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const scene = (i, check) => ({
  id: 's' + i, order: i, status: 'ready', duration_target: 5, video_sec: 5,
  video_url: `https://store.test/s${i}.mp4`, keyframe_url: `https://store.test/k${i}.png`, action: `Shot ${i} action`,
  ...(check ? { check: { video_url: `https://store.test/s${i}.mp4`, ...check } } : {}),
});

test('Reels shot check: checking, checked, and a shot to look at; the thread says what was redone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  const project = {
    id: 'proj_chk', status: 'ready', mode: 'video', look: 'stylized', agent_brief: { title: 'Spot the signs', shots: [1, 2, 3].map((i) => ({ action: `Shot ${i} action` })) },
    final_url: 'https://store.test/final.mp4', vo_script: 'Spot the signs early.',
    pipeline: { assemble: { vo: true, captions: true, music: false, outro: false } },
    scenes: [
      scene(1, { status: 'pass' }),
      scene(2, { status: 'flagged', summary: "Maya's face has no eyes in frames 3 and 4" }),
      scene(3, { status: 'checking', started_at: new Date().toISOString() }),
    ],
    chat: [
      { role: 'user', text: 'A reel about spotting the signs' },
      { role: 'system', kind: 'shot_check', text: "Shot 2 check: Maya's face has no eyes in frames 3 and 4. Redoing it once." },
      { role: 'system', kind: 'shot_check', text: 'Shot 1 redone and checked: it looks right now.' },
    ],
  };
  await mockApi(page, srv.base, { data: clientData(), animProjects: [project] });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_chk"]');

  const card = (i) => page.locator(`.anim-shot[data-scene="s${i}"]`);
  await expect(card(1).locator('.nl-shot__st')).toHaveText('Checked');
  await expect(card(1).locator('.nl-shot__dot--pass')).toHaveCount(1);
  await expect(card(2).locator('.nl-shot__st')).toHaveText('Flagged');
  await expect(card(2).locator('.nl-shot__chk--warn')).toHaveText("Maya's face has no eyes in frames 3 and 4");
  await expect(card(3).locator('.nl-shot__st')).toHaveText('Checking');
  await expect(page.locator('.nl-tsys--warn')).toContainText('Redoing it once');
  await expect(page.locator('.nl-tsys--ok')).toContainText('redone and checked');

  // The check lands on the server; the page is still polling and shows it.
  project.scenes[2].check = { status: 'pass', video_url: 'https://store.test/s3.mp4' };
  await expect(card(3).locator('.nl-shot__st')).toHaveText('Checked', { timeout: 10000 });

  // A check from an older take doesn't describe the clip shown now.
  project.scenes[1].video_url = 'https://store.test/s2b.mp4';
  project.scenes[1].active_take_id = 'take_b';
  await page.click('.nl-aproj');
  await page.click('[data-open-project="proj_chk"]');
  await expect(card(2).locator('.nl-shot__st')).toHaveText('Ready');
  await expect(card(2).locator('.nl-shot__chk')).toHaveCount(0);
  expect(errors).toEqual([]);
});
