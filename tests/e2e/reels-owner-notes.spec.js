// Reels (new look): the owner adds what they saw that the shot check missed ("her head goes through the
// windshield"). The note shows under the check, can be removed, turns the button into Regenerate with fixes even
// when the check passed, and the regenerate goes out with the shot's words (the server adds the notes).
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const scene = (i, extra = {}) => ({
  id: 's' + i, order: i, status: 'ready', duration_target: 5, video_sec: 5,
  video_url: `https://store.test/s${i}.mp4`, keyframe_url: `https://store.test/k${i}.png`, action: `Bunny drives, shot ${i}.`, ...extra,
});

test('notes on a shot: add, show, remove, and they make it Regenerate with fixes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('https://store.test/**', (r) => r.fulfill({ status: 404, body: '' }));
  const project = {
    id: 'proj_notes', status: 'ready', mode: 'video', look: 'stylized', agent_brief: { title: 'Night drive', shots: [1, 2].map((i) => ({ action: `Bunny drives, shot ${i}.` })) },
    final_url: 'https://store.test/final.mp4', vo_script: 'Eleven at night.',
    pipeline: { assemble: { vo: true, captions: true, music: false, outro: false } },
    scenes: [scene(1, { check: { status: 'pass', video_url: 'https://store.test/s1.mp4', frames: 6 } }), scene(2)],
    chat: [{ role: 'user', text: 'A night drive' }],
  };
  const sent = { notes: [], deleted: [], regen: [] };
  let seq = 0;
  await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      const m = entry.path.match(/^\/api\/animation\/projects\/proj_notes\/scenes\/(s\d)\/notes(?:\/([^/]+))?$/);
      if (m && entry.method === 'POST') {
        const body = JSON.parse(entry.body || '{}');
        sent.notes.push(body.note);
        const s = project.scenes.find((x) => x.id === m[1]);
        s.owner_notes = [...(s.owner_notes || []), { id: `n_${++seq}`, note: body.note, video_url: s.video_url }];
        json(200, { project, scene: s });
        return 'handled';
      }
      if (m && entry.method === 'DELETE') {
        sent.deleted.push(m[2]);
        const s = project.scenes.find((x) => x.id === m[1]);
        s.owner_notes = (s.owner_notes || []).filter((n) => n.id !== m[2]);
        json(200, { project, scene: s });
        return 'handled';
      }
      if (/\/scenes\/s1\/regenerate$/.test(entry.path)) {
        sent.regen.push(JSON.parse(entry.body || '{}'));
        json(200, { project, started: false });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await page.click('[data-open-project="proj_notes"]');

  await page.locator('.anim-shot[data-scene="s1"]').click();
  const bar = page.locator('.nl-shotbar');
  await expect(bar.locator('.nl-shotchk')).toContainText('Looks right.');
  const regen = bar.locator('button', { hasText: /^Regenerate/ });
  await expect(regen).toHaveText('Regenerate');

  // The check passed, but the owner saw something.
  const input = bar.locator('[data-note-input]');
  await expect(input).toHaveAttribute('placeholder', /check missed/);
  await input.fill('her head goes through the windshield');
  await input.press('Enter');
  await expect.poll(() => sent.notes).toEqual(['her head goes through the windshield']);
  await expect(page.locator('.nl-shotbar .nl-mynotes__list li')).toHaveCount(1);
  await expect(page.locator('.nl-shotbar .nl-mynotes')).toContainText('You noted');
  await expect(page.locator('.nl-shotbar .nl-mynotes')).toContainText('her head goes through the windshield');
  await expect(page.locator('.nl-shotbar .nl-mynotes__hint')).toContainText('the next check looks for them');
  await expect(page.locator('.nl-shotbar button', { hasText: /^Regenerate/ })).toHaveText('Regenerate with fixes');

  // A second note with the Add button, then remove the first.
  await page.locator('.nl-shotbar [data-note-input]').fill('her hand goes through the door');
  await page.locator('.nl-shotbar .nl-mynotes__add button').click();
  await expect(page.locator('.nl-shotbar .nl-mynotes__list li')).toHaveCount(2);
  await page.locator('.nl-shotbar [data-note-del="n_1"]').click();
  await expect.poll(() => sent.deleted).toEqual(['n_1']);
  await expect(page.locator('.nl-shotbar .nl-mynotes__list li')).toHaveCount(1);
  await expect(page.locator('.nl-shotbar .nl-mynotes__list')).toContainText('her hand goes through the door');

  await page.locator('.nl-shotbar button', { hasText: 'Regenerate with fixes' }).click();
  await expect.poll(() => sent.regen.length).toBe(1);
  expect(sent.regen[0].action).toBe('Bunny drives, shot 1.');

  // Another shot has its own (empty) notes.
  await page.locator('.anim-shot[data-scene="s2"]').click();
  await expect(page.locator('.nl-shotbar .nl-mynotes__list')).toHaveCount(0);
  await expect(page.locator('.nl-shotbar button', { hasText: /^Regenerate/ })).toHaveText('Regenerate');
  expect(errors).toEqual([]);
});
