// Reels (new look): the shot plan can be changed before anything renders. Add a shot,
// remove and reorder, edit one by hand, ask the AI to change one, undo, and pick a length.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const shot = (n, extra = {}) => ({ id: `shot_${n}`, order: n, title: `Shot ${n}`, duration_target: 5, action: `Maya in scene ${n}, flat vector illustration.`, vo_line: `Line ${n}.`, ...extra });
const LEAFLET = 'https://store.test/leaflet.png';

test('Reels plan: remove and undo, reorder, hand edit with a product, AI change, add a shot', async ({ page }) => {
  const errors = watchErrors(page);
  const project = {
    id: 'proj_plan', status: 'brief_ready', mode: 'video', look: 'stylized', length_seconds: 30, user_prompt: 'Spot the signs',
    references: [{ role: 'character', url: 'https://store.test/maya.png', title: 'Maya' }, { role: 'item', url: LEAFLET, title: 'Leaflet' }],
    agent_brief: { title: 'Spot the signs', shots: [shot(1), shot(2), shot(3)] }, scenes: [], chat: [],
  };
  const calls = [];
  const setShots = (list) => { project.agent_brief = { ...project.agent_brief, shots: list.map((x, i) => ({ ...x, order: i + 1 })) }; };
  await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      const body = entry.body ? JSON.parse(entry.body) : {};
      if (entry.path === '/api/animation/projects/proj_plan/plan' && entry.method === 'PUT') {
        calls.push({ op: 'put', body });
        const old = new Map(project.agent_brief.shots.map((x) => [x.id, x]));
        setShots(body.shots.map((x) => ({ ...old.get(x.id), ...x })));
        json(200, { project });
        return 'handled';
      }
      if (entry.path === '/api/animation/projects/proj_plan/plan/rewrite') {
        calls.push({ op: 'rewrite', body });
        setShots(project.agent_brief.shots.map((x) => (x.id === body.shot_id ? { ...x, action: 'Maya holds the leaflet in her right hand.', items: [LEAFLET] } : x)));
        json(200, { project, shot_id: body.shot_id, note: 'Leaflet in her right hand' });
        return 'handled';
      }
      if (entry.path === '/api/animation/projects/proj_plan/plan/add') {
        calls.push({ op: 'add', body });
        const list = project.agent_brief.shots.slice();
        list.splice(1, 0, shot(9, { action: 'Maya talks to a pharmacist.', vo_line: 'A pharmacist can help.' }));
        setShots(list);
        json(200, { project, shot_id: 'shot_9', position: 2, note: 'A pharmacist moment' });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  // The waiting plan reopens by itself; otherwise open it from Recent.
  await page.waitForSelector('.nl-tplan--edit, [data-open-project="proj_plan"]');
  if (!(await page.locator('.nl-tplan--edit').count())) await page.click('[data-open-project="proj_plan"]');

  const rows = page.locator('.nl-plan__row');
  await expect(rows).toHaveCount(3);
  // One plan, in the thread's collapsible Shot plan section; no second card.
  await expect(page.locator('.nl-tplan')).toHaveCount(1);
  await expect(page.locator('.anim-brief-card')).toHaveCount(0);
  const head = page.locator('.nl-tplan--edit > summary');
  await expect(head).toContainText('3 shots · 0:15');
  await expect(head).toContainText('15s under your 30s');
  await expect(head.locator('[data-plan-accept]')).toBeHidden();
  await head.click();
  await expect(rows.first()).toBeHidden();
  await expect(head.locator('[data-plan-accept]')).toBeVisible();
  await head.click();
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('#anim-accept')).toHaveText(/Accept & generate · 3 shots/);
  await expect(page.locator('#anim-length')).toHaveValue('30');

  // Remove shot 3, then undo.
  await page.click('[data-plan-rm="shot_3"]');
  await expect(rows).toHaveCount(2);
  expect(calls.at(-1).body.shots.map((x) => x.id)).toEqual(['shot_1', 'shot_2']);
  await expect(page.locator('.nl-plan__undo')).toContainText('Shot 3 removed.');
  await page.click('[data-plan-undo]');
  await expect(rows).toHaveCount(3);
  expect(calls.at(-1).body.shots.map((x) => x.id)).toEqual(['shot_1', 'shot_2', 'shot_3']);
  await expect(page.locator('.nl-plan__undo')).toHaveCount(0);

  // Move shot 2 up.
  await page.click('[data-plan-move="-1"][data-id="shot_2"]');
  expect(calls.at(-1).body.shots.map((x) => x.id)).toEqual(['shot_2', 'shot_1', 'shot_3']);
  await expect(rows.first()).toHaveAttribute('data-plan-row', 'shot_2');

  // Edit shot 1 by hand: the line, a longer length, the product.
  await page.click('[data-plan-edit="shot_1"]');
  await page.fill('[data-plan-vo="shot_1"]', 'Persistent heartburn is worth a chat.');
  await page.click('[data-plan-sec="1"]');
  await page.click(`[data-plan-item="${LEAFLET}"]`);
  await page.click('[data-plan-save="shot_1"]');
  const edit = calls.at(-1).body.shots.find((x) => x.id === 'shot_1');
  expect(edit).toMatchObject({ vo_line: 'Persistent heartburn is worth a chat.', duration_target: 6, seconds_manual: true, items: [LEAFLET] });
  await expect(page.locator('[data-plan-row="shot_1"] .nl-plan__tag')).toHaveText('Leaflet');

  // Ask the AI to change shot 3.
  await page.click('[data-plan-ai="shot_3"]');
  await page.fill('[data-plan-ask="shot_3"]', 'Make sure she is holding the leaflet in her right hand');
  await page.press('[data-plan-ask="shot_3"]', 'Enter');
  await expect(page.locator('[data-plan-row="shot_3"] .nl-plan__note')).toContainText('Leaflet in her right hand');
  expect(calls.at(-1)).toEqual({ op: 'rewrite', body: { shot_id: 'shot_3', instruction: 'Make sure she is holding the leaflet in her right hand' } });
  await expect(page.locator('[data-plan-row="shot_3"] .nl-plan__what')).toHaveText('Maya holds the leaflet in her right hand.');

  // Add a shot, written by the AI where it fits.
  await page.click('[data-plan-add]');
  await page.fill('[data-plan-add-text]', 'A pharmacist explaining what to do');
  await page.click('[data-plan-add-go]');
  await expect(rows).toHaveCount(4);
  expect(calls.at(-1)).toEqual({ op: 'add', body: { instruction: 'A pharmacist explaining what to do' } });
  await expect(page.locator('[data-plan-row="shot_9"]')).toHaveClass(/is-new/);
  await expect(page.locator('[data-plan-row="shot_9"] .nl-plan__note')).toContainText('Added as shot 2');
  expect(errors).toEqual([]);
});

test('Reels: the reel length is sent with an idea and remembered', async ({ page }) => {
  const errors = watchErrors(page);
  const calls = await mockApi(page, srv.base, { data: clientData() });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); localStorage.removeItem('se_anim_length'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await expect(page.locator('.nl-ahero #anim-entry-mode [data-entry="prompt"]')).toHaveClass(/active/);
  await expect(page.locator('[data-slot="length"]')).toBeVisible();
  await page.selectOption('#anim-length', '30');
  await page.fill('#anim-prompt', 'Spot the signs early');
  await page.click('#anim-send');
  await expect.poll(() => calls.filter((c) => /\/brief$/.test(c.path)).length).toBeGreaterThan(0);
  const brief = JSON.parse(calls.filter((c) => /\/brief$/.test(c.path)).pop().body);
  expect(brief.length_seconds).toBe(30);
  expect(await page.evaluate(() => localStorage.getItem('se_anim_length'))).toBe('30');
  // A voiceover script sets its own length.
  await page.locator('.nl-ahero #anim-entry-mode [data-entry="vo"]').click();
  await expect(page.locator('[data-slot="length"]')).toBeHidden();
  expect(errors).toEqual([]);
});
