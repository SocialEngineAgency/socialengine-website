// Animate → Build a Story (new look): kits under the prompt, a kit made from four looks,
// a story written and edited line by line, a scene preview, and the hand-off to the board.
// Hermetic: the API is an in-memory fake of the story routes.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const img = (n) => `https://store.test/${n}.jpg`;

/** A small stand-in for the story API, enough to drive the screens. */
function storyApi() {
  const st = { kits: new Map(), reels: new Map(), calls: [] };
  const kitView = (k) => ({ ...k, reels: [...st.reels.values()].filter((r) => r.kit_id === k.id).map((r) => ({ id: r.id, status: r.status, workflow: 'story', kit_id: r.kit_id })) });
  const summary = (k) => ({ id: k.id, kind: 'story_kit', title: k.title, look: k.look, counts: { character: k.elements.filter((e) => e.type === 'character').length, place: 0, item: 0 }, thumbs: k.elements.map((e) => e.image_url).slice(0, 4), reel_count: 0 });
  let n = 0;
  const handle = async (entry, route, json) => {
    const p = entry.path;
    const body = entry.body ? JSON.parse(entry.body) : {};
    st.calls.push({ method: entry.method, path: p, body });
    let m;
    if (p === '/api/animation/projects' && entry.method === 'GET') {
      json(200, { projects: [...st.reels.values()].map((r) => ({ id: r.id, workflow: 'story', kit_id: r.kit_id, status: r.status, story_title: r.story.title, story_scene_count: r.story.scenes.length })), kits: [...st.kits.values()].map(summary), purged: 0 });
      return 'handled';
    }
    if (p === '/api/animation/kits' && entry.method === 'GET') { json(200, { kits: [...st.kits.values()].map(summary) }); return 'handled'; }
    if (p === '/api/animation/kits' && entry.method === 'POST') {
      const k = { id: 'kit_t1', kind: 'story_kit', mode: 'kit', title: body.title || 'New story kit', look: body.look || 'stylized', elements: [], drafts: [], suggestions: [] };
      st.kits.set(k.id, k);
      json(200, { kit: kitView(k) });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/kits\/([^/]+)$/)) && entry.method === 'GET') {
      const k = st.kits.get(m[1]);
      // Looks finish between polls.
      k.drafts.forEach((d) => { if (d.status === 'working') { d.status = 'ready'; d.options = [1, 2, 3, 4].map((i) => ({ status: 'ready', url: img(`look${i}`) })); } });
      json(200, { kit: kitView(k) });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/kits\/([^/]+)\/options$/))) {
      const k = st.kits.get(m[1]);
      const d = { id: `draft_${++n}`, type: body.type, name: body.name, description: body.description, source: body.source, status: 'working', options: [0, 1, 2, 3].map(() => ({ status: 'working' })) };
      k.drafts.push(d);
      json(200, { kit: kitView(k), draft: d });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/kits\/([^/]+)\/elements$/))) {
      const k = st.kits.get(m[1]);
      const d = k.drafts.find((x) => x.id === body.draft_id);
      const el = { id: `el_${++n}`, type: d.type, name: d.name, description: d.description, source: d.source, image_url: d.options[body.option].url, sheet_status: 'ready', sheet_url: img('sheet') };
      k.elements.push(el);
      k.drafts = k.drafts.filter((x) => x.id !== d.id);
      json(200, { kit: kitView(k), element: el, reel: null });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/kits\/([^/]+)\/reels$/))) {
      const r = { id: 'proj_story1', workflow: 'story', kit_id: m[1], status: 'story', mode: 'video', look: 'stylized', story: { title: '', idea: '', scenes: [], script_source: 'ai' }, scenes: [], chat: [] };
      st.reels.set(r.id, r);
      json(200, { project: r, kit: kitView(st.kits.get(m[1])) });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/projects\/([^/]+)\/story\/write$/))) {
      const r = st.reels.get(m[1]);
      const k = st.kits.get(r.kit_id);
      const maya = k.elements[0].id;
      r.story = {
        title: 'Spot the signs', idea: body.idea, script_source: 'ai',
        scenes: [
          { id: 'sc_aaaaaa0001', line: 'Maya noticed something.', what: 'Maya at the kitchen table', element_ids: [maya], camera: 'push', seconds: 4, preview_url: null },
          { id: 'sc_aaaaaa0002', line: 'Talk to your GP today.', what: 'Maya smiles and picks up the phone', element_ids: [maya], camera: 'still', seconds: 4, preview_url: null },
        ],
      };
      k.suggestions = [{ id: 'need_1', type: 'place', name: 'Kitchen', description: 'A warm kitchen', scene: 1, reel_id: r.id }];
      json(200, { project: r, kit: kitView(k), needed: k.suggestions, stats: {} });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/projects\/([^/]+)\/story$/)) && entry.method === 'PUT') {
      const r = st.reels.get(m[1]);
      const prev = new Map(r.story.scenes.map((s) => [s.id, s]));
      r.story = { ...r.story, ...body, scenes: body.scenes.map((s) => ({ ...s, preview_url: (prev.get(s.id) || {}).preview_url || null, preview_status: (prev.get(s.id) || {}).preview_status || null })) };
      json(200, { project: r, stats: {} });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/projects\/([^/]+)\/story\/scenes\/([^/]+)\/preview$/))) {
      const r = st.reels.get(m[1]);
      const s = r.story.scenes.find((x) => x.id === m[2]);
      s.preview_status = 'working';
      json(200, { project: r });
      s.preview_status = 'ready';
      s.preview_url = img('preview2');
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/projects\/([^/]+)\/story\/make$/))) {
      const r = st.reels.get(m[1]);
      r.status = 'generating';
      r.agent_brief = { title: r.story.title, shots: r.story.scenes.map((s, i) => ({ id: `shot_${i + 1}`, title: `Scene ${i + 1}`, action: s.what, vo_line: s.line })) };
      r.scenes = r.story.scenes.map((s, i) => ({ id: `shot_${i + 1}`, order: i + 1, title: `Scene ${i + 1}`, action: s.what, prompt: s.what, status: 'generating', duration_target: 4 }));
      r.character_pack = { locked: true, cast: [{ name: 'Maya' }], views: [{ label: 'front', url: img('look2') }] };
      json(200, { project: r, started: true });
      return 'handled';
    }
    if ((m = p.match(/^\/api\/animation\/projects\/([^/]+)$/)) && entry.method === 'GET' && st.reels.has(m[1])) {
      json(200, { project: st.reels.get(m[1]) });
      return 'handled';
    }
    return undefined;
  };
  return { st, handle };
}

async function openAnimate(page) {
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await page.route('https://store.test/*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="#888"/></svg>' }));
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
}

test('Build a Story: a kit from four looks, a written story, a preview, then the reel on the board', async ({ page }) => {
  const errors = watchErrors(page);
  const fake = storyApi();
  await mockApi(page, srv.base, { data: clientData(), onRequest: fake.handle });
  await openAnimate(page);

  // Prompt stays the default; story kits sit under it.
  await expect(page.locator('.nl-wf [data-wf="prompt"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#nl-ahero-t')).toHaveText('Describe your video');
  await expect(page.locator('.nl-skrow')).toContainText('Story kits');
  await page.click('.nl-skrow [data-row-new]');

  // Build a story: a new kit.
  await expect(page.locator('.nl-wf [data-wf="story"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.nl-anim')).toBeHidden();
  await page.fill('[data-kit-name]', 'Winter wellbeing');
  await page.click('[data-kit-create]');
  await expect(page.locator('.nl-ssteps .nl-step--now')).toContainText('Cast and world');
  await expect(page.locator('.nl-spanel h3')).toHaveText('New character');

  // Four looks, pick one, lock it.
  await page.fill('[data-p-name]', 'Maya');
  await page.fill('[data-p-about]', 'Community nurse in her mid 30s');
  await page.click('[data-make-looks]');
  await expect(page.locator('.nl-sopt, .nl-slook').first()).toBeVisible();
  await expect(page.locator('[data-pick]')).toHaveCount(4, { timeout: 8000 });
  await expect(page.locator('[data-lock]')).toBeDisabled();
  await page.click('[data-pick="1"]');
  await expect(page.locator('[data-lock]')).toHaveText(/Lock look 2/);
  await page.click('[data-lock]');
  await expect(page.locator('.nl-ssec--character .nl-sel')).toHaveCount(1);
  await expect(page.locator('.nl-ssec--character .nl-sel')).toContainText('Maya');
  await expect(page.locator('.nl-ssec--character .nl-sbadge')).toHaveText('Locked');
  const options = fake.st.calls.find((c) => /\/options$/.test(c.path));
  expect(options.body).toMatchObject({ type: 'character', name: 'Maya', source: 'describe' });

  // The story: written for us, then edited.
  await page.click('[data-next-story]');
  await expect(page.locator('.nl-ssteps .nl-step--now')).toContainText('Story');
  await page.fill('[data-w-idea]', 'A nurse notices the signs early');
  await page.click('[data-w-go]');
  await expect(page.locator('.nl-sline')).toHaveCount(2);
  await expect(page.locator('.nl-sban--need')).toContainText('Kitchen');
  await expect(page.locator('.nl-sscene[data-scene]')).toHaveCount(2);
  await page.locator('[data-line="sc_aaaaaa0001"]').fill('Maya noticed something was off.');
  await expect.poll(() => fake.st.calls.filter((c) => c.method === 'PUT').length, { timeout: 5000 }).toBeGreaterThan(0);
  const put = fake.st.calls.filter((c) => c.method === 'PUT').pop();
  expect(put.body.script_source).toBe('client');
  expect(put.body.scenes[0].line).toBe('Maya noticed something was off.');

  // Inspector: scene 2, camera, preview.
  await page.click('.nl-sscene[data-scene="sc_aaaaaa0002"]');
  await expect(page.locator('.nl-sinsp h3')).toHaveText('Scene 2');
  await page.click('[data-cam="orbit"]');
  await page.click('.nl-sinsp [data-preview]');
  await expect(page.locator('.nl-sscene[data-scene="sc_aaaaaa0002"] .nl-sscene__m > img')).toBeVisible({ timeout: 8000 });

  // Make: the reel opens on the board with the story steps above it.
  await page.click('[data-make]');
  await expect(page.locator('.nl-story')).toBeHidden();
  await expect(page.locator('.nl-anim')).toBeVisible();
  await expect(page.locator('.nl-ssteps .nl-step--now')).toContainText('Make');
  const make = fake.st.calls.find((c) => /\/story\/make$/.test(c.path));
  expect(make).toBeTruthy();
  const lastPut = fake.st.calls.filter((c) => c.method === 'PUT').pop();
  expect(lastPut.body.scenes[1].camera).toBe('orbit');

  // Back to Prompt: the prompt home again.
  await page.click('.nl-wf [data-wf="prompt"]');
  await expect(page.locator('#nl-ahero-t')).toHaveText('Describe your video');
  await expect(page.locator('.nl-ssteps')).toBeHidden();
  expect(errors).toEqual([]);
});
