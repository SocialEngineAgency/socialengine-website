// Library: the browsable grid, filters, detail panel and multi-select. Hermetic: /api/assets is the shared mock,
// and the routes it does not know (label, sheet, drafts, harvest) are answered here.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors, CHARITY_CAPS, COMMERCE_CAPS } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const url = (id) => `https://store.test/${id}.png`;
const lab = (summary, subjects, aliases, collection) => ({ analysis: { summary, subjects, aliases, collection } });

function charityAssets() {
  return [
    { id: 'a1', kind: 'character', name: 'Volunteers, spring walk', url: url('a1'), collection: 'Spring walk 2026', ...lab('Eight volunteers in blue T-shirts at a start line.', ['Volunteers', 'Banner'], ['walk team'], 'Spring walk 2026') },
    { id: 'a2', kind: 'character', name: 'Dr. Amara', url: url('a2'), collection: 'Clinic days', ...lab('A doctor in a white coat.', ['Doctor'], [], 'Clinic days') },
    { id: 'a3', kind: 'setting', name: 'Clinic waiting room', url: url('a3'), collection: 'Clinic days' },
    { id: 'a4', kind: 'item', name: 'Collection tin', url: url('a4'), collection: 'Winter appeal', ...lab('A red collection tin.', ['Tin'], ['donation tin'], 'Winter appeal') },
    { id: 'a5', kind: 'scene', name: 'Finish line, fun run', url: url('a5'), collection: 'Spring walk 2026', ...lab('Runners at a finish line.', ['Runners'], [], 'Spring walk 2026') },
    { id: 'a6', kind: 'style', name: 'Winter appeal look', url: url('a6'), collection: 'Winter appeal' },
    { id: 'a7', kind: 'outro', name: 'Thank-you outro', url: 'https://store.test/a7.mp4', content_type: 'video/mp4' },
    { id: 'a8', kind: 'music', name: 'Opening theme', url: 'https://store.test/a8.mp3', content_type: 'audio/mpeg' },
    { id: 'l1', kind: 'logo', name: 'OPA logo', url: url('l1') },
    { id: 'k1', kind: 'color', name: 'Pink', hex: '#E0457B' },
    { id: 'k2', kind: 'color', name: 'Navy', hex: '#2B2D6E' },
  ];
}

function storeAssets() {
  return [
    { id: 's1', kind: 'item', name: 'Linen shirt, sand', url: url('s1'), collection: 'Autumn edit', ...lab('A sand-colored linen shirt on a hanger.', ['Shirt', 'Linen'], ['sand shirt'], 'Autumn edit') },
    { id: 's2', kind: 'character', name: 'Studio model, Ana', url: url('s2'), collection: 'Studio shoot' },
    { id: 's3', kind: 'scene', name: 'Autumn flat lay', url: url('s3') },
  ];
}

// Extra routes the shared mock does not have. `st` collects what was sent.
function libApi(st) {
  return async (entry, route, json) => {
    const p = entry.path;
    if (!p.startsWith('/api/assets') && !p.startsWith('/api/studio/media-library')) return undefined;
    st.calls = st.calls || [];
    const body = entry.body && entry.body[0] === '{' ? JSON.parse(entry.body) : {};
    if (p === '/api/assets' && entry.method === 'GET') {
      st.gets = (st.gets || 0) + 1;
      if (st.failFirstGet && st.gets === 1) { json(500, { error: 'The Library could not be reached.' }); return 'handled'; }
      return undefined;
    }
    if (p === '/api/assets/harvest') { st.harvest = (st.harvest || 0) + 1; json(200, { added: [{ id: 'k9' }, { id: 'k8' }], assets: st.after || st.assets }); return 'handled'; }
    if (p === '/api/assets/analyze-missing') {
      st.analyzeMissing = (st.analyzeMissing || 0) + 1;
      st.assets = st.assets.map((a) => (a.analysis || !['scene', 'character', 'item', 'setting', 'style', 'plate', 'logo'].includes(a.kind) ? a : { ...a, ...lab(`A picture of ${a.name}.`, [a.name], [], '') }));
      json(200, { labeled: 2, remaining: 0, assets: st.assets }); return 'handled';
    }
    let m = p.match(/^\/api\/assets\/([^/]+)\/analyze$/);
    if (m) { st.analyzed = (st.analyzed || []).concat(m[1]); st.assets = st.assets.map((a) => (a.id === m[1] ? { ...a, ...lab('Freshly labeled.', ['Fresh'], [], '') } : a)); json(200, { assets: st.assets }); return 'handled'; }
    m = p.match(/^\/api\/assets\/([^/]+)\/more-like-this$/);
    if (m) { st.more = { id: m[1], body }; json(200, { drafts: [{ id: 'd1', url: url('d1'), name: 'Draft one', kind: 'item', collection: 'Winter appeal' }, { id: 'd2', url: url('d2'), name: 'Draft two', kind: 'item' }] }); return 'handled'; }
    m = p.match(/^\/api\/assets\/([^/]+)\/generate-views$/);
    if (m) { st.views = (st.views || []).concat(m[1]); json(200, { assets: st.assets.map((a) => (a.id === m[1] ? { ...a, multiview_kind: 'sheet', sheet_url: url('sheet') } : a)) }); return 'handled'; }
    if (p === '/api/assets/generate') { st.generate = body; json(200, { drafts: [{ id: 'g1', url: url('g1'), name: 'Diagram one', kind: 'scene' }] }); return 'handled'; }
    if (p === '/api/assets/drafts/accept') { st.accepted = body; st.assets = st.assets.concat([{ id: 'acc1', kind: body.kind || 'scene', name: body.name, url: body.url }]); json(200, { assets: st.assets }); return 'handled'; }
    if (p === '/api/assets/drafts/reject') { st.rejected = body; json(200, { ok: true }); return 'handled'; }
    if (p === '/api/assets/from-url') { st.fromUrl = (st.fromUrl || []).concat(body); json(200, { assets: st.assets.concat([{ id: 'past1', kind: 'style', name: body.name, url: body.url }]) }); return 'handled'; }
    if (p.startsWith('/api/studio/media-library')) { json(200, { items: [{ id: 'post1', title: 'Spring post', image_url: url('post1') }, { id: 'post2', title: 'Video only', image_url: '' }] }); return 'handled'; }
    return undefined;
  };
}

async function open(page, { assets, caps, look = 'new', theme = 'dark', st = {}, client } = {}) {
  await page.addInitScript((l) => { try { localStorage.setItem('se-look2', l.look); localStorage.setItem('se-nl-theme', l.theme); } catch (_) {} }, { look, theme });
  st.assets = assets;
  const calls = await mockApi(page, srv.base, {
    data: clientData({ capabilities: caps || CHARITY_CAPS, client: client || { business_name: 'OPA Cancer Charity' } }),
    assets,
    onRequest: libApi(st),
  });
  // Pictures are blocked by the harness; answer them so tiles show a real image where they have one.
  await page.route('https://store.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#456"/></svg>' }));
  await login(page, srv.base);
  if ((page.viewportSize() || {}).width < 900) await page.evaluate(() => window.switchNav('library'));
  else await page.click('.dash-nav-item[data-nav="library"]');
  await expect(page.locator('#brand-library')).toBeVisible({ timeout: 15000 });
  return calls;
}

const tiles = (page) => page.locator('#brand-library .lb-tile:not(.lb-draft)');
const tileNames = (page) => page.locator('#brand-library .lb-tile .lb-name').allTextContents();

test('the grid shows items, kind chips, label dots, the brand strip and the charity wording', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { assets: charityAssets() });
  await expect(page.locator('.lb-h1')).toHaveText('Library');
  await expect(page.locator('.lb-sub')).toHaveText('Everything Create and Coach can use: your logo, colors, people, places, things and looks.');
  await expect(tiles(page)).toHaveCount(11);
  // newest first: the list arrives oldest first, so the last one added is first; logo and colors go last
  const names = await tileNames(page);
  expect(names[0]).toBe('Opening theme');
  expect(names.slice(-3).sort()).toEqual(['Navy', 'OPA logo', 'Pink']);
  await expect(page.locator('.lb-listing .lb-h2')).toHaveText('All items');
  await expect(page.locator('.lb-hd .lb-meta')).toHaveText('11 items. Newest first.');
  // kind chip and state dot on a tile
  const tin = page.locator('.lb-tile', { hasText: 'Collection tin' });
  await expect(tin.locator('.lb-kind')).toHaveText('Item');
  await expect(tin.locator('.lb-dot--ok')).toHaveCount(1);
  await expect(page.locator('.lb-tile', { hasText: 'Clinic waiting room' }).locator('.lb-dot--warn')).toHaveCount(1);
  await expect(page.locator('.lb-tile', { hasText: 'Opening theme' }).locator('.lb-dot')).toHaveCount(0);
  // side bar: charity wording, counts
  const side = page.locator('#lb-side');
  await expect(side).toContainText('People and characters');
  await expect(side.locator('[data-view="g:people"] .lb-n')).toHaveText('2');
  await expect(side).toContainText('Things');
  await expect(side).not.toContainText('Products');
  await expect(side.locator('[data-view="smart:label"] .lb-n')).toHaveText('3');
  await expect(side.locator('[data-view="c:Clinic days"] .lb-n')).toHaveText('2');
  // brand strip: the logo, and the two colors with their codes
  await expect(page.locator('.lb-logo img')).toHaveAttribute('src', url('l1'));
  await expect(page.locator('.lb-sw')).toHaveCount(2);
  await expect(page.locator('.lb-sw').first()).toContainText('#E0457B');
  await expect(page.locator('.lb-sw__c').first()).toHaveCSS('background-color', 'rgb(224, 69, 123)');
  await expect(page.locator('.lb-legend')).toContainText('A green dot means the picture has an AI label');
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('a store sees store wording: Products, Models and people, and a Product chip', async ({ page }) => {
  await open(page, { assets: storeAssets(), caps: COMMERCE_CAPS, client: { business_name: 'Linen and Co' } });
  await expect(page.locator('.lb-sub')).toHaveText('Everything Create and Coach can use: your logo, colors, products, models, places and looks.');
  await expect(page.locator('#brand-library-x, #brand-lib-filter')).toHaveAttribute('placeholder', 'Search by name, product, person or place');
  const side = page.locator('#lb-side');
  await expect(side).toContainText('Products');
  await expect(side).toContainText('Models and people');
  await expect(side).not.toContainText('People and characters');
  await expect(page.locator('.lb-tile', { hasText: 'Linen shirt' }).locator('.lb-kind')).toHaveText('Product');
  await expect(page.locator('.lb-tile', { hasText: 'Studio model' }).locator('.lb-kind')).toHaveText('Person');
  // no logo yet: the box shows the store's initials and says so
  await expect(page.locator('.lb-logo')).toHaveText('LC');
  await expect(page.locator('.lb-brand__t')).toContainText('No logo yet');
  await expect(page.locator('.lb-brand__lbl')).toContainText('No colors yet');
  // the diagram maker is for charities
  await page.click('#lb-add');
  await expect(page.locator('#lb-menu [role="menuitem"]')).toHaveText([/Upload files/, /Import past content/]);
});

test('type, collection and search narrow the grid, and the count line and heading follow', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await page.click('#lb-side [data-view="g:people"]');
  await expect(page.locator('#lb-side [data-view="g:people"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#lb-side [data-view="all"]')).toHaveAttribute('aria-current', 'false');
  await expect(page.locator('.lb-listing .lb-h2')).toHaveText('People and characters');
  expect((await tileNames(page)).sort()).toEqual(['Dr. Amara', 'Volunteers, spring walk']);
  await expect(page.locator('.lb-hd .lb-meta')).toHaveText('2 of 11 items. Newest first.');

  await page.click('#lb-side [data-view="c:Winter appeal"]');
  await expect(page.locator('.lb-listing .lb-h2')).toHaveText('Winter appeal');
  expect((await tileNames(page)).sort()).toEqual(['Collection tin', 'Winter appeal look']);

  await page.click('#lb-side [data-view="all"]');
  await page.fill('#brand-lib-filter', 'donation');
  expect(await tileNames(page)).toEqual(['Collection tin']);
  await expect(page.locator('.lb-hd .lb-meta')).toHaveText('1 of 11 items. Newest first.');
  await page.fill('#brand-lib-filter', 'zebra');
  await expect(page.locator('.lb-empty')).toContainText('Nothing matches "zebra"');
  await page.click('.lb-empty [data-a="clear-filters"]');
  await expect(tiles(page)).toHaveCount(11);
  await expect(page.locator('#brand-lib-filter')).toHaveValue('');
});

test('sorting: oldest first, newest first and by name', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await page.selectOption('#lb-sort', 'old');
  expect((await tileNames(page))[0]).toBe('Volunteers, spring walk');
  await expect(page.locator('.lb-hd .lb-meta')).toHaveText('11 items. Oldest first.');
  await page.selectOption('#lb-sort', 'name');
  expect((await tileNames(page))[0]).toBe('Clinic waiting room');
  await page.selectOption('#lb-sort', 'new');
  expect((await tileNames(page))[0]).toBe('Opening theme');
});

test('picking an item fills the detail panel: what the AI sees, tags, actions', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await page.click('.lb-tile__main[data-id="a1"]');
  const panel = page.locator('#lb-panel');
  await expect(panel.locator('.lb-h2')).toHaveText('Volunteers, spring walk');
  await expect(panel.locator('.lb-badge')).toHaveText('Character');
  await expect(panel).toContainText('Spring walk 2026');
  await expect(panel).not.toContainText('Added', { timeout: 500 }); // the server sends no date, so none is shown
  await expect(panel).toContainText('Eight volunteers in blue T-shirts at a start line.');
  await expect(panel.locator('.lb-tag')).toHaveText(['Volunteers', 'Banner']);
  await expect(panel).toContainText('Also called: walk team');
  await expect(panel.getByRole('button', { name: 'Use in a post' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'More like this' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Turnaround sheet' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Label again' })).toBeVisible();
  await expect(page.locator('.lb-tile__main[data-id="a1"]')).toHaveAttribute('aria-current', 'true');

  // an unlabeled picture says so and offers a label
  await page.click('.lb-tile__main[data-id="a3"]');
  await expect(panel).toContainText('No label yet');
  await expect(panel.getByRole('button', { name: 'Label with AI' })).toBeVisible();
  // a setting can not make a turnaround sheet; an outro is not a picture, so no AI box and no Use button
  await expect(panel.getByRole('button', { name: 'Turnaround sheet' })).toHaveCount(0);
  await page.click('.lb-tile__main[data-id="a7"]');
  await expect(panel.locator('video')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Use in a post' })).toHaveCount(0);
  await expect(panel.locator('.lb-ai')).toHaveCount(0);
  await page.click('.lb-tile__main[data-id="a8"]');
  await expect(panel.locator('audio')).toHaveCount(1);
  await page.click('.lb-tile__main[data-id="k1"]');
  await expect(panel).toContainText('#E0457B');
});

test('Use in a post hands the still to Create the way Use now used to', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await page.click('.lb-tile__main[data-id="a2"]');
  await page.getByRole('button', { name: 'Use in a post' }).click();
  const ref = await page.evaluate(() => window.__SE_ANIM_PENDING_REF);
  expect(ref).toMatchObject({ url: url('a2'), title: 'Dr. Amara', role: 'character' });
  expect(await page.evaluate(() => window._studioReference)).toMatchObject({ url: url('a2'), source: 'library' });
  await expect(page.locator('#toast-container, .toast').filter({ hasText: 'Ready. Open Post or Reels' }).first()).toBeVisible();
});

test('ticking boxes selects several: a bulk panel with Clear, Change type and Delete', async ({ page }) => {
  const st = {};
  const calls = await open(page, { assets: charityAssets(), st });
  // nothing was clicked, so the shown item does not count: one tick is one item
  await page.locator('.lb-tile[data-id="a2"] .lb-chk input').check();
  await expect(page.locator('#lb-panel .lb-h2')).toHaveText('Dr. Amara');
  await page.locator('.lb-tile[data-id="a3"] .lb-chk input').check();
  await page.locator('.lb-tile[data-id="a4"] .lb-chk input').check();
  const panel = page.locator('#lb-panel');
  await expect(panel.locator('.lb-h2')).toHaveText('3 selected');
  await expect(page.locator('.lb-tile[data-sel="1"]')).toHaveCount(3);
  await expect(panel.locator('[data-a="bulk-label"]')).toHaveText('Label 1 with AI'); // only the waiting room has no label
  await expect(panel.locator('[data-a="bulk-delete"]')).toHaveText('Delete 3');
  await expect(panel.locator('[data-a="open-gen"]')).toBeEnabled();
  // untick one: two selected
  await page.locator('.lb-tile[data-id="a4"] .lb-chk input').uncheck();
  await expect(panel.locator('.lb-h2')).toHaveText('2 selected');
  // change type of both
  await panel.locator('[data-a="bulk-kind"]').selectOption('style');
  await expect.poll(() => calls.filter((c) => c.method === 'PATCH').map((c) => c.path).sort()).toEqual(['/api/assets/a2', '/api/assets/a3']);
  await expect(page.locator('.lb-tile[data-id="a2"] .lb-kind')).toHaveText('Style');
  await expect(page.locator('.lb-tile[data-id="a3"] .lb-kind')).toHaveText('Style');
  // clear
  await page.click('#lb-panel [data-a="clear"]');
  await expect(page.locator('.lb-tile[data-sel="1"]')).toHaveCount(1);
});

test('bulk delete asks once and removes every selected item', async ({ page }) => {
  const calls = await open(page, { assets: charityAssets() });
  await page.click('.lb-tile__main[data-id="a1"]');
  await page.locator('.lb-tile[data-id="a2"] .lb-chk input').check(); // a1 was clicked, so it counts too
  await expect(page.locator('#lb-panel .lb-h2')).toHaveText('2 selected');
  let asked = 0;
  page.on('dialog', (d) => { asked += 1; d.accept(); });
  await page.click('#lb-panel [data-a="bulk-delete"]');
  await expect.poll(() => calls.filter((c) => c.method === 'DELETE').map((c) => c.path).sort()).toEqual(['/api/assets/a1', '/api/assets/a2']);
  await expect(tiles(page)).toHaveCount(9);
  expect(asked).toBe(1);
  await expect(page.locator('.lb-tile[data-id="a1"]')).toHaveCount(0);
});

test('Needs a label lists unlabeled pictures, and Label with AI labels them all', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  await page.click('#lb-side [data-view="smart:label"]');
  await expect(page.locator('.lb-listing .lb-h2')).toHaveText('Needs a label');
  expect((await tileNames(page)).sort()).toEqual(['Clinic waiting room', 'OPA logo', 'Winter appeal look']);
  await page.click('#brand-lib-label-missing');
  await expect.poll(() => st.analyzeMissing).toBe(1);
  await expect(page.locator('.lb-empty')).toContainText('Every picture has a label');
  await expect(page.locator('#lb-side [data-view="smart:label"] .lb-n')).toHaveText('0');
});

test('Label with AI on one picture calls analyze for just that picture', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  await page.click('.lb-tile__main[data-id="a3"]');
  await page.getByRole('button', { name: 'Label with AI' }).click();
  await expect.poll(() => st.analyzed).toEqual(['a3']);
  await expect(page.locator('#lb-panel')).toContainText('Freshly labeled.');
  await expect(page.locator('.lb-tile[data-id="a3"] .lb-dot--ok')).toHaveCount(1);
});

test('Import from website imports the logo and colors', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  st.after = charityAssets().concat([{ id: 'k3', kind: 'color', hex: '#F2B84B' }]);
  await page.click('#brand-lib-harvest');
  await expect.poll(() => st.harvest).toBe(1);
  await expect(page.locator('.lb-sw')).toHaveCount(3);
  await expect(page.locator('.lb-sw').last()).toContainText('#F2B84B');
});

test('clicking a color copies its code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.base });
  await open(page, { assets: charityAssets() });
  await page.locator('.lb-sw', { hasText: '#2B2D6E' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#2B2D6E');
});

test('upload from the Add menu: type and collection go with each file', async ({ page }) => {
  const calls = await open(page, { assets: charityAssets() });
  await expect(page.locator('#lb-up')).toBeHidden();
  await page.click('#lb-add');
  await expect(page.locator('#lb-add')).toHaveAttribute('aria-expanded', 'true');
  await page.click('#lb-menu >> text=Upload files');
  await expect(page.locator('#lb-up')).toBeVisible();
  await page.selectOption('#brand-lib-kind', 'style');
  await page.fill('#brand-lib-collection', 'Autumn ride');
  await page.setInputFiles('#brand-lib-file', [
    { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from('1') },
    { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from('2') },
  ]);
  await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path === '/api/assets').length).toBe(2);
  const bodies = calls.filter((c) => c.method === 'POST' && c.path === '/api/assets').map((c) => c.body);
  for (const b of bodies) {
    expect(b).toContain('name="kind"');
    expect(b).toContain('style');
    expect(b).toContain('Autumn ride');
  }
  expect(bodies.join('')).toContain('one');
  expect(bodies.join('')).toContain('two');
  await expect(page.locator('#toast-container, .toast').filter({ hasText: 'Saved 2 files to the library' }).first()).toBeVisible();
});

test('a failed upload says why, in the card and in a toast, and keeps the card open', async ({ page }) => {
  await open(page, { assets: charityAssets(), st: {} });
  await page.route('**/api/assets', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 413, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ error: 'That file is too big.' }) })
    : route.fallback()));
  await page.click('#lb-add');
  await page.click('#lb-menu >> text=Upload files');
  await page.setInputFiles('#brand-lib-file', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await expect(page.locator('#lb-up-err')).toHaveText('That file is too big.');
  await expect(page.locator('#lb-up')).toBeVisible();
});

test('Add menu: keyboard, Escape and outside clicks', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await page.focus('#lb-add');
  await page.keyboard.press('Enter');
  await expect(page.locator('#lb-menu')).toBeVisible();
  await expect(page.locator('#lb-menu .lb-menu__i').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lb-menu .lb-menu__i').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lb-menu')).toBeHidden();
  await expect(page.locator('#lb-add')).toBeFocused();
  await page.click('#lb-add');
  await expect(page.locator('#lb-menu')).toBeVisible();
  await page.click('.lb-h1');
  await expect(page.locator('#lb-menu')).toBeHidden();
});

test('Import past content lists past posts and saves the ticked ones as Style stills', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  await page.click('#lb-add');
  await page.click('#brand-lib-import-past');
  await expect(page.locator('#lb-past')).toBeVisible();
  await expect(page.locator('#lb-past .lb-pastcard')).toHaveCount(1); // the video-only row is skipped
  await page.click('#brand-lib-past-add');
  await expect(page.locator('.lb-pastcard')).toHaveCount(1);
  expect(st.fromUrl).toBeUndefined(); // nothing ticked, nothing saved
  await page.check('#lb-past [data-past-pick]');
  await page.click('#brand-lib-past-add');
  await expect.poll(() => (st.fromUrl || []).length).toBe(1);
  expect(st.fromUrl[0]).toMatchObject({ url: url('post1'), kind: 'style', name: 'Spring post', source: 'content', created_from_id: 'post1' });
});

test('More like this makes drafts in To review; add one, use one, reject one', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  await page.click('.lb-tile__main[data-id="a4"]');
  page.once('dialog', (d) => d.accept('more red tins'));
  await page.getByRole('button', { name: 'More like this' }).click();
  await expect.poll(() => st.more).toMatchObject({ id: 'a4', body: { prompt: 'more red tins', count: 3 } });
  await expect(page.locator('.lb-listing .lb-h2')).toHaveText('To review');
  await expect(page.locator('#lb-side [data-view="smart:review"] .lb-n')).toHaveText('2');
  await expect(page.locator('.lb-draft')).toHaveCount(2);
  await expect(page.locator('#lb-aside')).toContainText('Nothing is saved until you choose Add to library');

  await page.locator('.lb-draft', { hasText: 'Draft one' }).getByRole('button', { name: 'Use in a post' }).click();
  expect((await page.evaluate(() => window.__SE_ANIM_PENDING_REF)).title).toBe('Draft one');

  await page.locator('.lb-draft', { hasText: 'Draft one' }).getByRole('button', { name: 'Add to library' }).click();
  await expect.poll(() => st.accepted).toMatchObject({ url: url('d1'), name: 'Draft one', kind: 'item' });
  await expect(page.locator('.lb-draft')).toHaveCount(1);

  page.once('dialog', (d) => d.accept('too dark'));
  await page.locator('.lb-draft', { hasText: 'Draft two' }).getByRole('button', { name: 'Reject' }).click();
  await expect.poll(() => st.rejected).toMatchObject({ reason: 'too dark' });
  await expect(page.locator('.lb-empty')).toContainText('Nothing to review');
  await page.click('#lb-side [data-view="all"]');
  await expect(page.locator('.lb-tile[data-id="acc1"]')).toHaveCount(1);
});

test('Make diagrams (charity): needs 2 to 8 ticked stills, then sends their ids', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  await page.click('#lb-add');
  await page.click('#lb-menu >> text=Make diagrams');
  await expect(page.locator('#lb-gen')).toBeVisible();
  await expect(page.locator('#lb-gen')).toContainText('FigureLabs diagrams only');
  await expect(page.locator('#lb-gen-count')).toContainText('None ticked yet');
  await page.locator('.lb-tile[data-id="a1"] .lb-chk input').check();
  await expect(page.locator('#lb-gen-count')).toContainText('1 picture ticked');
  await page.click('#brand-lib-generate');
  await expect(page.locator('#toast-container, .toast').filter({ hasText: 'Select 2' }).first()).toBeVisible();
  expect(st.generate).toBeUndefined();
  await page.locator('.lb-tile[data-id="a2"] .lb-chk input').check();
  await page.locator('.lb-tile[data-id="a8"] .lb-chk input').check(); // music is not a still, so it does not count
  await expect(page.locator('#lb-gen-count')).toContainText('2 pictures ticked. Ready');
  await page.fill('#brand-lib-gen-prompt', '3 labeled diagrams');
  await page.selectOption('#brand-lib-gen-kind', 'plate');
  await page.click('#brand-lib-generate');
  await expect.poll(() => st.generate).toMatchObject({ prompt: '3 labeled diagrams', kind: 'plate', asset_ids: ['a1', 'a2'].sort() });
  await expect(page.locator('.lb-listing .lb-h2')).toHaveText('To review');
  await expect(page.locator('.lb-draft')).toHaveCount(1);
});

test('Turnaround sheet: made for a character, then shown with Remake sheet', async ({ page }) => {
  const st = {};
  await open(page, { assets: charityAssets(), st });
  await page.click('.lb-tile__main[data-id="a2"]');
  await expect(page.locator('.lb-sheet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Turnaround sheet' }).click();
  await expect.poll(() => st.views).toEqual(['a2']);
  await expect(page.locator('.lb-sheet')).toContainText('Single turnaround');
  await expect(page.locator('.lb-sheet img')).toHaveAttribute('src', url('sheet'));
  await expect(page.getByRole('button', { name: 'Remake sheet' })).toBeVisible();
});

test('Change type is a real select a keyboard can reach, and Rename and Delete work from the panel', async ({ page }) => {
  const calls = await open(page, { assets: charityAssets() });
  await page.click('.lb-tile__main[data-id="a6"]');
  const sel = page.locator('#lb-panel [data-asset-kind="a6"]');
  await expect(sel).toHaveAttribute('aria-label', 'Change type of Winter appeal look');
  await expect(sel).toHaveValue('style');
  await sel.selectOption('scene');
  await expect.poll(() => calls.some((c) => c.method === 'PATCH' && c.path === '/api/assets/a6' && /"kind":"scene"/.test(c.body))).toBeTruthy();
  await expect(page.locator('.lb-tile[data-id="a6"] .lb-kind')).toHaveText('Scene');

  page.once('dialog', (d) => { expect(d.defaultValue()).toBe('Winter appeal look'); d.accept('Winter look'); });
  await page.click('#lb-panel [data-asset-rename="a6"]');
  await expect(page.locator('.lb-tile[data-id="a6"] .lb-name')).toHaveText('Winter look');

  page.once('dialog', (d) => d.dismiss());
  await page.click('#lb-panel [data-asset-delete="a6"]');
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  page.once('dialog', (d) => d.accept());
  await page.click('#lb-panel [data-asset-delete="a6"]');
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.path === '/api/assets/a6')).toBeTruthy();
  await expect(page.locator('.lb-tile[data-id="a6"]')).toHaveCount(0);
  // the panel moves to a neighbour rather than going blank
  await expect(page.locator('#lb-panel')).toBeVisible();
});

test('empty Library: says so, and offers upload and import', async ({ page }) => {
  await open(page, { assets: [], st: {} });
  await expect(page.locator('.lb-empty')).toContainText('Your Library is empty');
  await expect(page.locator('.lb-empty')).toContainText('pictures of your people, places and events');
  await expect(page.locator('#lb-aside')).toBeEmpty();
  await expect(page.locator('#lb-side [data-view="all"] .lb-n')).toHaveText('0');
  await page.locator('.lb-empty').getByRole('button', { name: 'Upload files' }).click();
  await expect(page.locator('#lb-up')).toBeVisible();
});

test('error: the message shows with Try again, and Try again loads the page', async ({ page }) => {
  const st = { failFirstGet: true };
  await open(page, { assets: charityAssets(), st });
  await expect(page.locator('.lb-banner')).toContainText('The Library could not be reached.');
  await expect(page.locator('.lb-banner')).toHaveAttribute('role', 'alert');
  await page.click('.lb-banner [data-a="reload"]');
  await expect(tiles(page)).toHaveCount(11);
  await expect(page.locator('.lb-banner')).toHaveCount(0);
});

test('day mode: the page follows the new look tokens in Day and in Dark', async ({ page }) => {
  await open(page, { assets: charityAssets(), theme: 'day' });
  await page.click('.lb-tile__main[data-id="a1"]');
  const panel = page.locator('#lb-panel');
  await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.lb-h1')).toHaveCSS('color', 'rgb(27, 26, 23)');
  await expect(page.locator('.lb-btn--signal').first()).toHaveCSS('background-color', 'rgb(91, 71, 214)');
  await expect(page.locator('.lb-tile[data-id="a1"]')).toHaveCSS('border-top-color', 'rgb(91, 71, 214)');
  // the brand colors are not repainted by the look mapper
  await expect(page.locator('.lb-sw__c').first()).toHaveCSS('background-color', 'rgb(224, 69, 123)');
  await expect(page.locator('.lb-tile[data-id="k2"] .lb-thumb')).toHaveCSS('background-color', 'rgb(43, 45, 110)');
});

test('dark mode keeps the brand colors too', async ({ page }) => {
  await open(page, { assets: charityAssets(), theme: 'dark' });
  await expect(page.locator('#lb-brand')).toHaveCSS('background-color', 'rgb(16, 18, 22)');
  await expect(page.locator('.lb-sw__c').nth(1)).toHaveCSS('background-color', 'rgb(43, 45, 110)');
  await expect(page.locator('.lb-tile[data-id="k1"] .lb-thumb')).toHaveCSS('background-color', 'rgb(224, 69, 123)');
});

test('the old look still renders the page, with its own dark colors', async ({ page }) => {
  await open(page, { assets: charityAssets(), look: 'old' });
  await expect(tiles(page)).toHaveCount(11);
  await expect(page.locator('.lb-btn--signal').first()).toHaveCSS('background-color', 'rgb(167, 139, 250)');
});

test('keyboard: Tab reaches a tile, Enter picks it, arrows move between tiles, Escape clears ticks', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  const first = page.locator('.lb-tile__main').first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lb-tile__main').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  const id = await page.locator('.lb-tile__main').nth(1).getAttribute('data-id');
  await expect(page.locator('#lb-panel')).toHaveAttribute('aria-label', /Details for /);
  await expect(page.locator(`.lb-tile__main[data-id="${id}"]`)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator(`.lb-tile__main[data-id="${id}"]`)).toBeFocused();
  // the tick box is a real checkbox with a name
  const box = page.locator('.lb-tile .lb-chk input').first();
  await expect(box).toHaveAttribute('aria-label', /^Select /);
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(box).not.toBeChecked();
});

test('the side bar names are buttons with a current page, and the status line announces results', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await expect(page.locator('#lb-side')).toHaveAttribute('aria-label', 'Browse the Library');
  await expect(page.locator('#lb-live')).toHaveAttribute('aria-live', 'polite');
  await page.click('#lb-side [data-view="g:music"]');
  await expect(page.locator('#lb-live')).toHaveText('Music. 1 of 11 items. Newest first.');
});

test('names and links from the server are never run as markup', async ({ page }) => {
  const errors = watchErrors(page);
  const evil = [
    { id: 'x1', kind: 'scene', name: '<img src=x onerror="window.__xss=1">', url: 'javascript:alert(1)', ...lab('<b>bold</b> <script>window.__xss=2</script>', ['<i>t</i>'], ['<u>a</u>'], 'C"><svg onload=1>') },
    { id: 'x2', kind: 'color', name: 'bad', hex: 'url(javascript:alert(1))' },
    { id: 'x3', kind: 'character', name: 'Safe', url: url('x3'), sheet_url: 'javascript:alert(2)', multiview_kind: 'sheet' },
  ];
  await open(page, { assets: evil });
  await page.click('.lb-tile__main[data-id="x1"]');
  await page.click('.lb-tile__main[data-id="x3"]');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#brand-library img[src^="javascript"]')).toHaveCount(0);
  await expect(page.locator('#brand-library a[href^="javascript"]')).toHaveCount(0);
  await expect(page.locator('.lb-tile[data-id="x1"] .lb-name')).toHaveText('<img src=x onerror="window.__xss=1">');
  // a color with no valid code is not painted from the server's text
  expect(await page.locator('#brand-library').innerHTML()).not.toContain('url(javascript');
  await expect(page.locator('.lb-sw')).toHaveCount(0);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('phone: no sideways scroll, the panel opens on a tap and Back to the grid closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { assets: charityAssets() });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(page.locator('#lb-aside')).toBeHidden();
  // two tiles to a row
  const xs = await page.locator('.lb-tile').evaluateAll((els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(xs[0]).toBe(xs[1]);
  await page.locator('.lb-tile__main').nth(2).click();
  await expect(page.locator('#lb-aside')).toBeVisible();
  await expect(page.locator('#lb-panel')).toBeInViewport();
  await expect(page.locator('#lb-panel .lb-back')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.click('#lb-panel .lb-back');
  await expect(page.locator('#lb-aside')).toBeHidden();
  // ticking two shows the selection bar, and it opens the actions
  // the item just shown counts, so one more tick makes two
  await page.locator('.lb-tile .lb-chk input').nth(0).check();
  await expect(page.locator('#lb-selbar')).toBeVisible();
  await expect(page.locator('#lb-selbar')).toContainText('2 items selected');
  await page.click('#lb-selbar [data-a="open-panel"]');
  await expect(page.locator('#lb-panel .lb-h2')).toHaveText('2 selected');
  await expect(page.locator('#lb-panel')).toBeInViewport();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('the shown item is highlighted on a wide screen, with no tick', async ({ page }) => {
  await open(page, { assets: charityAssets() });
  await expect(page.locator('.lb-tile[data-sel="1"]')).toHaveCount(1);
  await expect(page.locator('#lb-panel')).toBeVisible();
  await expect(page.locator('.lb-chk input:checked')).toHaveCount(0);
});

test('a second visit starts clean and does not stack handlers', async ({ page }) => {
  const calls = await open(page, { assets: charityAssets() });
  await page.click('.dash-nav-item[data-nav="content"]');
  await page.click('.dash-nav-item[data-nav="library"]');
  await expect(tiles(page)).toHaveCount(11);
  await page.click('.lb-tile__main[data-id="a2"]');
  page.once('dialog', (d) => d.accept());
  await page.click('#lb-panel [data-asset-delete="a2"]');
  await expect.poll(() => calls.filter((c) => c.method === 'DELETE').length).toBe(1);
  await page.waitForTimeout(300);
  expect(calls.filter((c) => c.method === 'DELETE').length).toBe(1);
});
