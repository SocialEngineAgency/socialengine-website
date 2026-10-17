// New look (graphite redesign): on by default, ?look=old switches a browser back; the rail keeps every
// page reachable, the ⌘K bar jumps between pages, Day/Dark sticks, inline navy and purple
// map to the new palette, and ?look=old switches it off again. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const rgb = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

test('the new look is the default; ?look=old switches it off and sticks, ?look=new brings it back', async ({ page }) => {
  await mockApi(page, srv.base, { data: clientData() });
  // No stored choice at all, like a first visit.
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('nl-first')) { sessionStorage.setItem('nl-first', '1'); localStorage.removeItem('se-look2'); } } catch (_) {} });
  await login(page, srv.base);
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  await page.goto(`${srv.base}/portal.html?look=old`);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  await page.goto(`${srv.base}/portal.html`); // remembered, and the session signs back in
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  await expect(page.locator('.nl-cmd')).toBeHidden();
  await expect(page.locator('.nl-theme-btn')).toHaveCount(0);
  expect(await rgb(page, '.dash-sidebar', 'width')).not.toBe('68px');
  await page.goto(`${srv.base}/portal.html?look=new`);
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
});

test('?look=new: icon rail, jump bar, Day/Dark that sticks, palette mapped, ?look=old turns it off', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { data: clientData() });
  await page.goto(`${srv.base}/portal.html?look=new`);
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  await login(page, srv.base); // a plain reload: the look is remembered
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  await expect(page.locator('html')).toHaveAttribute('data-nl-theme', 'dark');

  // Labelled sidebar on Home, every page still there with its name as the label; Review is renamed.
  expect(await rgb(page, '.dash-sidebar', 'width')).toBe('220px');
  await expect(page.locator('.dash-nav-item[data-nav="content"] .nl-lbl')).toHaveText('Review');
  await expect(page.locator('.dash-nav-item[data-nl-brand]')).toBeVisible();
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveAttribute('data-nl-label', 'Calendar');
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveAttribute('aria-label', 'Calendar');
  expect(await rgb(page, 'body', 'backgroundColor')).toBe('rgb(13, 14, 17)');

  // Jump bar: Ctrl+K, type, Enter.
  await page.keyboard.press('Control+k');
  await expect(page.locator('#nl-cmd-input')).toBeFocused();
  await page.keyboard.type('calen');
  await expect(page.locator('#nl-cmd-list')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveClass(/active/);
  // Work screens collapse to the rail; the toggle opens it again and is remembered.
  await expect.poll(() => rgb(page, '.dash-sidebar', 'width')).toBe('68px');
  await page.click('.nl-railtog');
  await expect.poll(() => rgb(page, '.dash-sidebar', 'width')).toBe('220px');
  await page.click('.nl-railtog');
  await expect.poll(() => rgb(page, '.dash-sidebar', 'width')).toBe('68px');

  // Inline colours follow the palette, including ones added later.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'nl-probe';
    d.style.cssText = 'background:#0A1628;color:rgba(255,255,255,0.6);border:1px solid rgba(124,58,237,0.25)';
    d.innerHTML = '<span id="nl-btn" style="background:#7C3AED;color:#fff">Go</span>';
    document.body.appendChild(d);
  });
  await expect.poll(() => rgb(page, '#nl-probe', 'backgroundColor')).not.toBe('rgb(10, 22, 40)');
  const probeBg = await rgb(page, '#nl-probe', 'backgroundColor');
  const [r, g, b] = probeBg.match(/\d+/g).map(Number);
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10); // graphite, not navy
  expect(await rgb(page, '#nl-btn', 'backgroundColor')).toBe('rgb(157, 140, 255)');

  // Day: paper surfaces, ink text, a button label on violet stays light. Remembered.
  await page.click('.nl-theme-btn');
  await expect(page.locator('html')).toHaveAttribute('data-nl-theme', 'day');
  expect(await rgb(page, 'body', 'backgroundColor')).toBe('rgb(244, 243, 239)');
  const dayBg = (await rgb(page, '#nl-probe', 'backgroundColor')).match(/\d+/g).map(Number);
  expect(Math.min(...dayBg.slice(0, 3))).toBeGreaterThan(230);
  const dayText = (await rgb(page, '#nl-probe', 'color')).match(/\d+/g).map(Number);
  expect(Math.max(...dayText.slice(0, 3))).toBeLessThan(60);
  expect(await rgb(page, '#nl-btn', 'backgroundColor')).toBe('rgb(91, 71, 214)');
  expect(await rgb(page, '#nl-btn', 'color')).toBe('rgb(255, 255, 255)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-nl-theme', 'day');

  // Back to Dark maps from the originals, not from the Day colours.
  await page.evaluate(() => window.seNewLook.theme('dark'));
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'nl-probe2';
    d.style.cssText = 'color:#94A3B8';
    document.body.appendChild(d);
  });
  await expect.poll(() => rgb(page, '#nl-probe2', 'color')).not.toBe('rgb(148, 163, 184)');
  const [r2, , b2] = (await rgb(page, '#nl-probe2', 'color')).match(/\d+/g).map(Number);
  expect(r2).toBeGreaterThan(150); // light grey, as in Dark
  expect(r2).toBeGreaterThan(b2); // warm, not slate

  await page.goto(`${srv.base}/portal.html?look=old`);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  await page.goto(`${srv.base}/portal.html`);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  expect(errors).toEqual([]);
});

test('new look Calendar: platform tabs and filter, live ring, counts, key dates and unscheduled in the aside', async ({ page }) => {
  const errors = watchErrors(page);
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const content = [
    { id: 'rec1', status: 'Scheduled', caption: 'Walk on Sunday', platform: 'Instagram', scheduled_date: `${ym}-10T09:00:00.000Z` },
    { id: 'rec2', status: 'Ready for Review', caption: 'Nurse spotlight', platform: 'TikTok', scheduled_date: `${ym}-11` },
    { id: 'rec3', status: 'Approved', caption: 'Five questions for your GP', platform: 'Facebook' },
  ];
  await mockApi(page, srv.base, {
    data: clientData({ content, posts: content }),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/calendar-history') { json(200, { posts: [{ id: 'ig_9', platform: 'instagram', timestamp: `${ym}-12T12:00:00.000Z`, caption: 'Thank you all', status: 'Published' }] }); return 'handled'; }
      if (entry.path === '/api/marketing/key-dates' && entry.method === 'GET') { json(200, { country: 'GB', country_known: true, countries: [{ code: 'GB', name: 'United Kingdom' }], dates: [{ date: `${ym}-20`, name: 'Kindness Day', type: 'awareness' }] }); return 'handled'; }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="schedule"]');
  await expect(page.locator('.nl-cal h1')).toHaveText('Calendar');
  await expect(page.locator('#nl-cal-sub')).toContainText('1 scheduled · 1 needs review');

  const ig = page.locator(`[data-bq-drop-day="${ym}-10"] .nl-ev`);
  await expect(ig).toHaveClass(/nl-ev--instagram/);
  await expect(ig.locator('.nl-dot')).toHaveClass(/nl-dot--scheduled/);
  await expect(page.locator(`[data-bq-drop-day="${ym}-11"] .nl-ev .nl-dot`)).toHaveClass(/nl-dot--review/);
  await expect(page.locator(`[data-bq-drop-day="${ym}-12"] .nl-ev .nl-dot`)).toHaveClass(/nl-dot--live/);

  await page.click('[data-nl-plat="tiktok"]');
  await expect(page.locator('[data-nl-plat="tiktok"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-bq-drop-day="${ym}-10"] .nl-ev`)).toHaveCount(0);
  await expect(page.locator(`[data-bq-drop-day="${ym}-11"] .nl-ev`)).toHaveCount(1);
  await page.click('[data-nl-plat="all"]');
  await expect(page.locator(`[data-bq-drop-day="${ym}-10"] .nl-ev`)).toHaveCount(1);

  await expect(page.locator('.nl-cal__aside #key-dates-strip .kd-tile').first()).toContainText('20');
  await expect(page.locator(`[data-bq-drop-day="${ym}-20"] .kd-badge`)).toBeVisible();
  await expect(page.locator('#nl-unsched')).toContainText('Five questions for your GP');

  await page.click(`[data-bq-drop-day="${ym}-10"] .nl-ev`);
  await expect(page.locator('#schedule-date-panel')).toHaveCSS('right', '0px');
  expect(errors).toEqual([]);
});

test('new look Post: one canvas and the Coach; start from a line, quick starts, size, style; the post sits beside its caption; platforms, queue, drafts and edit still work', async ({ page }) => {
  const errors = watchErrors(page);
  const sent = { generate: [], queue: [], upload: 0, coach: [] };
  const poster = 'https://store.test/poster.png';
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/studio/design-generate') {
        sent.generate.push(JSON.parse(entry.body || '{}'));
        json(200, { ok: true, image_url: poster, spec: { ratio: '1:1', w: 1080, h: 1080 } });
        return 'handled';
      }
      if (entry.path === '/api/studio/design-queue') {
        sent.queue.push(JSON.parse(entry.body || '{}'));
        json(200, { ok: true });
        return 'handled';
      }
      if (entry.path === '/api/chat/v2') {
        sent.coach.push(JSON.parse(entry.body || '{}'));
        json(200, { reply: 'Sure. Tell me which line to make bigger.', coach_actions: [] });
        return 'handled';
      }
      if (entry.path === '/api/studio/upload-image') {
        sent.upload += 1;
        json(200, { ok: true, url: 'https://store.test/finished.png' });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.route('https://store.test/*.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex') }));
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="design-studio"]');
  const shell = page.locator('.nl-p2');
  await expect(shell).toHaveClass(/nl-p2--compose/);
  await expect(page.locator('.atelier-essentials')).toBeHidden();
  await expect(page.locator('.nl-p2-compose h2')).toHaveText('What are we posting?');
  await expect(page.locator('.nl-p2-compose #cs-brief')).toBeVisible();
  await expect(page.locator('.nl-p2-result')).toBeHidden();

  // Quick start leads the line; size and style feed the generate request.
  await page.locator('.nl-p2-quick button', { hasText: 'Quick tip' }).click();
  await expect(page.locator('#cs-brief')).toHaveValue('A quick tip: ');
  await page.locator('#cs-brief').fill('A quick tip: wash linen cold');
  await page.click('.nl-p2-size button[data-aspect="1:1"]');
  await expect(page.locator('#cs-aspect')).toHaveValue('1:1');
  await expect(page.locator('.nl-p2-size button[data-aspect="1:1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.nl-p2-stylewrap > .nl-p2-menu > .nl-p2-chip').click();
  await page.locator('#nl-p2-style button', { hasText: 'Clean editorial' }).click();
  await expect(page.locator('#cs-style')).toHaveValue('Clean editorial');
  await page.keyboard.press('Escape');
  await expect(page.locator('.nl-p2-stylewrap .nl-p2-chip > span')).toHaveText('Style: Clean editorial');
  await page.click('#cs-generate');
  await expect(shell).toHaveClass(/nl-p2--result/);
  expect(sent.generate[0]).toMatchObject({ brief: 'A quick tip: wash linen cold', aspect_ratio: '1:1', style_hint: 'Clean editorial' });
  await expect(page.locator('.nl-p2-title')).toHaveText('A quick tip: wash linen cold');
  await expect(page.locator('.nl-p2-compose')).toBeHidden();
  // Only what applies is shown; one-tap changes go to the Coach.
  await expect(page.locator('#cs-export')).toBeVisible();
  await expect(page.locator('#cs-regen')).toBeVisible();
  await expect(page.locator('#cs-restore-prev')).toBeHidden();
  await expect(page.locator('.nl-p2-sugs')).toBeVisible();
  await page.locator('.nl-p2-sugs button', { hasText: 'Bigger headline' }).click();
  await expect.poll(() => sent.coach.length).toBe(1);
  expect(sent.coach[0].message).toBe('Bigger headline');
  await expect(page.locator('#cs-coach-log .cs-cb--me').last()).toHaveText('Bigger headline');
  await expect(page.locator('#cs-coach-input')).toHaveAttribute('placeholder', 'Ask for a change…');

  // The post beside its caption: counts, platforms, queue.
  await expect(page.locator('.nl-p2-side #cs-caption-box')).toBeVisible();
  await page.locator('#cs-caption-box').fill('Cold wash keeps linen soft. #linen #laundry');
  await expect(page.locator('.nl-p2-count')).toHaveText('43 / 2,200');
  await expect(page.locator('.nl-p2-tags')).toHaveText('2 hashtags');
  await expect(page.locator('.nl-p2-plat[data-plat="Instagram"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('.nl-p2-plat[data-plat="Facebook"]');
  await expect(page.locator('.nl-p2-plat[data-plat="Facebook"]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('.nl-p2-plat[data-plat="Instagram"]');
  await expect(page.locator('.nl-p2-plat[data-plat="Instagram"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 });
  await expect(page.locator('#cs-queue')).toHaveText('Add to Queue');
  await page.click('#cs-queue');
  await expect.poll(() => sent.queue.length).toBe(1);
  expect(sent.queue[0]).toMatchObject({ image_url: poster, caption: 'Cold wash keeps linen soft. #linen #laundry', platform: 'Instagram' });
  // Queuing opens Review, as before; back in Post, the design is where it was left.
  await expect(page.locator('.dash-nav-item[data-nav="content"]')).toHaveClass(/active/);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="design-studio"]');
  await expect(shell).toHaveClass(/nl-p2--result/);

  // Edit the prompt from the menu; Cancel returns to the post.
  await page.locator('.nl-p2-bar .nl-p2-menu').last().locator('> .nl-p2-chip').click();
  await page.click('#nl-p2-edit');
  await expect(shell).toHaveClass(/nl-p2--editing/);
  await expect(page.locator('#nl-p2-ask')).toHaveText('Change the prompt');
  await page.click('#nl-p2-cancel');
  await expect(shell).not.toHaveClass(/nl-p2--editing/);

  // Drafts → New post starts over.
  await page.locator('.nl-p2-bar .nl-p2-menu').first().locator('> .nl-p2-chip').click();
  await page.click('#cs-new-post');
  await expect(shell).toHaveClass(/nl-p2--compose/);
  await expect(page.locator('#cs-brief')).toHaveValue('');

  // A finished graphic goes straight to the post view.
  await page.setInputFiles('#nl-p2-file', { name: 'ready.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await expect(shell).toHaveClass(/nl-p2--result/);
  await expect(page.locator('.nl-p2-title')).toHaveText('Finished graphic');
  expect(sent.upload).toBe(1);
  await expect(page.locator('#cs-queue')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('new look Animate: the board layout (brief, tall shots with a shot bar, ask bar, timeline, sound and finish) and its controls still work', async ({ page }) => {
  const errors = watchErrors(page);
  const scene = (i, extra = {}) => ({ id: 's' + i, order: i, status: 'ready', duration_target: 5, video_url: `https://store.test/s${i}.mp4`, keyframe_url: `https://store.test/k${i}.png`, prompt: `Shot ${i} prompt`, ...extra });
  const project = {
    id: 'proj_nl', status: 'ready', mode: 'video', look: 'stylized', agent_brief: { title: 'Walk day' },
    character_pack: { locked: true, cast: [{ name: 'Fiona' }], views: [{ label: 'Front', url: 'https://store.test/front.png' }] },
    references: [{ url: 'https://store.test/fiona.png', role: 'character', title: 'Fiona' }],
    vo_script: 'Every step counts. Walk with us on Sunday.',
    pipeline: { assemble: { vo: true, captions: true, music: true, outro: false } },
    final_url: 'https://store.test/final.mp4', final_source_urls: ['https://store.test/s1.mp4', 'https://store.test/s2.mp4'],
    scenes: [scene(1), scene(2, { duration_target: 6 }), scene(3, { status: 'generating', video_url: null })],
  };
  let regen = null;
  const calls = await mockApi(page, srv.base, {
    data: clientData(),
    animProjects: [project],
    onRequest: async (entry, route, json) => {
      if (/\/scenes\/s2\/regenerate$/.test(entry.path)) {
        regen = JSON.parse(entry.body || '{}');
        json(200, { project, started: true });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="animation-studio"]');
  await expect(page.locator('.anim-canvas-header .nl-steps')).toHaveCount(0);
  // Home: the board is single column; the composer sits in the ask bar, the old chat column is gone.
  await expect(page.locator('.nl-anim.is-home')).toBeVisible();
  await expect(page.locator('.anim-chat')).toBeHidden();
  await expect(page.locator('.nl-aask #anim-prompt')).toBeVisible();
  await expect(page.locator('.nl-abrief #anim-entry-mode')).toBeVisible();
  await expect(page.locator('.nl-ahome [data-open-project="proj_nl"]')).toBeVisible();

  await page.click('[data-open-project="proj_nl"]');
  const steps = page.locator('.anim-canvas-header .nl-step');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(2)).toHaveClass(/nl-step--now/);
  await expect(page.locator('.nl-aproj')).toContainText('Walk day');
  await expect(page.locator('.nl-acast__lock')).toContainText('Fiona locked across every shot');
  await expect(page.locator('.nl-acast .anim-ref-name')).toHaveText('Fiona');

  // Tall shot cards, numbered with their length and state.
  const cards = page.locator('.nl-ashots__grid .anim-shot[data-scene]');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).locator('.nl-shot__num')).toHaveText('2 · 6 s');
  await expect(cards.nth(2).locator('.nl-shot__st')).toHaveText('Rendering');
  await expect(page.locator('[data-slot="shots-meta"]')).toHaveText('3 shots · 16 s');
  const box = await cards.nth(0).boundingBox();
  expect(box.height).toBeGreaterThan(box.width * 1.5);

  // The first shot is selected; picking shot 2 moves its controls into the shot bar.
  await expect(page.locator('.nl-shotbar .anim-shot__prompt-edit')).toHaveValue('Shot 1 prompt');
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveClass(/is-sel/);
  await expect(page.locator('.nl-shotbar__h')).toHaveText('Shot 2 · What happens');
  const ta = page.locator('.nl-shotbar .anim-shot__prompt-edit');
  await expect(ta).toHaveValue('Shot 2 prompt');
  await ta.fill('Close up of the purple ribbon');
  await expect(cards.nth(1).locator('.nl-shot__what')).toHaveText('Close up of the purple ribbon');
  await page.locator('.nl-shotbar .anim-shot-i2v').selectOption('kling');
  await page.click('.nl-shotbar .anim-regen');
  await expect.poll(() => regen && regen.action).toBe('Close up of the purple ribbon');
  expect(regen.i2v_model).toBe('kling');

  // Timeline tracks follow the project.
  await expect(page.locator('.nl-atl .nl-atl__b--shot')).toHaveCount(3);
  await expect(page.locator('.nl-atl .nl-atl__b--vo')).toHaveCount(1);
  await expect(page.locator('.nl-atl .nl-atl__b--gen')).toContainText('rendering');

  // Sound and finish: one card per layer; Edit opens the real editor; the switch is the include flag.
  const lanes = page.locator('.nl-alanes .nl-lane');
  await expect(lanes).toHaveCount(4);
  const vo = page.locator('.nl-lane[aria-label="Voiceover"]');
  await expect(vo.locator('.nl-lane__sum')).toContainText('Every step counts');
  await expect(page.locator('#anim-vo-script')).toBeHidden();
  await vo.locator('.nl-lane__edit').click();
  await expect(page.locator('#anim-vo-script')).toBeVisible();
  await expect(page.locator('#anim-vo-script')).toHaveValue('Every step counts. Walk with us on Sunday.');
  const music = page.locator('.nl-lane[aria-label="Music"]');
  await music.locator('input[type="checkbox"]').click();
  await expect(music).toHaveClass(/is-off/);
  await expect(page.locator('#anim-flag-music')).not.toBeChecked();
  await expect(page.locator('.nl-lane[aria-label="End card"]')).toHaveClass(/is-off/);
  await expect(page.locator('.nl-afinal .nl-afinal__seg')).toHaveCount(3);
  await expect(page.locator('.nl-afinal .nl-afinal__count')).toHaveText('2 of 3 shots ready');
  await expect(page.locator('.nl-afinal #anim-rebuild-final')).toBeVisible();

  // The project pill goes back to the project list.
  await page.click('.nl-aproj');
  await expect(page.locator('.anim-canvas-header .nl-steps')).toHaveCount(0);
  await expect(page.locator('.nl-anim.is-home')).toBeVisible();
  expect(calls.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('new look Home: greeting, approvals with Approve/Reject, goes live today, coach move, month in numbers; account menu signs out', async ({ page }) => {
  const errors = watchErrors(page);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const content = [
    { id: 'recR', status: 'Ready for Review', caption: 'Walk on Sunday, bring a friend', platform: 'Instagram', content_type: 'image', scheduled_date: `${ymd}T17:00:00.000Z` },
    // Later today, whatever time the test runs (a fixed hour has already passed in the evening).
    { id: 'recS', status: 'Scheduled', caption: 'Last call for sign-ups', platform: 'Facebook', content_type: 'reel', scheduled_date: new Date(Math.min(Date.now() + 3600e3, new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 58).getTime())).toISOString() },
  ];
  await mockApi(page, srv.base, {
    data: clientData({ content, posts: content, client: { tier: 'growth', social_connected_platforms: ['instagram'] } }),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/meta-planner') { json(200, { slots: [{ date: '2999-01-01', format: 'reel', story_type: 'pov', story_type_label: 'POV', status: 'open' }] }); return 'handled'; }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await expect(page.locator('.nl-page h1')).toContainText(/^Good (morning|afternoon|evening), Owner\.$/);
  const row = page.locator('.nl-qrow').first();
  await expect(row).toContainText('Walk on Sunday');
  await expect(row.locator('button', { hasText: 'Approve' })).toBeVisible();
  await expect(row.locator('button', { hasText: 'Reject' })).toBeVisible();
  await expect(page.locator('.nl-lrow')).toContainText('Last call for sign-ups');
  await expect(page.locator('#nl-home-coach')).toContainText('open Reel');
  await expect(page.locator('.nl-conn')).toHaveText('Connected');
  await expect(page.locator('.nl-plan')).toContainText('Growth plan');
  await page.click('.dash-sidebar__user');
  await expect(page.locator('.nl-acctmenu')).toBeVisible();
  await page.click('.nl-acctmenu [data-a="out"]');
  await expect(page.locator('#dashboard-view')).not.toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('new look Review: filter bar, cards with Approve/Reject, the post opens inline under the grid; Home still opens it on top', async ({ page }) => {
  const errors = watchErrors(page);
  const posts = [
    { id: 'recP1', status: 'Ready for Review', platform: 'instagram', content_type: 'carousel', full_post_text: 'Five ways to join the walk #walk', image_url: 'https://store.test/a.png' },
    { id: 'recP2', status: 'Ready for Review', platform: 'tiktok', content_type: 'reel', full_post_text: 'Meet the nurses', image_url: 'https://store.test/b.png' },
    { id: 'recLive', status: 'Published', platform: 'facebook', full_post_text: 'Thank you all', image_url: 'https://store.test/c.png' },
    { id: 'recArch', status: 'Archived', archived_from: 'Ready for Review', platform: 'instagram', full_post_text: 'Old draft' },
  ];
  const calls = await mockApi(page, srv.base, { data: clientData({ content: posts.map((p) => ({ ...p })) }) });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="content"]');
  await expect(page.locator('.nl-rv-head h1')).toHaveText('Review');
  await expect(page.locator('.nl-rv-sub')).toHaveText('3 posts in the pipeline. 2 need your approval.');
  await expect(page.locator('#bulk-approve-btn')).toHaveText('Approve all 2');
  const seg = page.locator('#studio-filters .studio-filter');
  await expect(seg.nth(0)).toContainText('Needs review');
  await expect(seg.nth(1)).toContainText('Scheduled');
  await expect(seg.nth(2)).toContainText('Live');
  await expect(seg.nth(3)).toContainText('All');
  await expect(page.locator('.studio-platform-filter').first()).toBeHidden();

  const cards = page.locator('.nl-rv-card');
  await expect(cards).toHaveCount(3);
  const c1 = page.locator('.nl-rv-card[data-post-id="recP1"]');
  await expect(c1.locator('.nl-rv-card__badge')).toHaveText('Carousel');
  await expect(c1.locator('.nl-rv-pill')).toHaveText('Needs review');
  await expect(c1.locator('.nl-rv-card__cap')).toHaveText('Five ways to join the walk');
  await expect(page.locator('.nl-rv-card[data-post-id="recLive"] .nl-rv-pill')).toHaveText('Live');

  // Status filter and the platform select drive the same filters as before.
  await seg.nth(0).click();
  await expect(cards).toHaveCount(2);
  await page.locator('.nl-rv-bar select[aria-label="Platform"]').selectOption('tiktok');
  await expect(cards).toHaveCount(1);
  await expect(page.locator('.nl-rv-card[data-post-id="recP2"]')).toBeVisible();
  await page.locator('.nl-rv-bar select[aria-label="Platform"]').selectOption('');
  await expect(cards).toHaveCount(2);
  await expect(seg.nth(0)).toHaveClass(/active/);
  await seg.nth(3).click();
  await expect(cards).toHaveCount(3);

  // Open a post: the studio modal shows inline under the grid, not as an overlay.
  await c1.locator('.nl-rv-card__media').click();
  const modal = page.locator('#nl-rv-detail #studio-modal.active');
  await expect(modal).toBeVisible();
  expect(await modal.evaluate((el) => getComputedStyle(el).position)).toBe('static');
  await expect(c1).toHaveClass(/is-sel/);
  await expect(modal.locator('.post-caption-edit')).toHaveValue(/Five ways to join the walk/);
  await modal.locator('.studio-modal__close').click();
  await expect(page.locator('#studio-modal')).toBeHidden();

  // Approve from the card goes through the same approve call.
  await c1.locator('button', { hasText: 'Approve' }).click();
  await expect.poll(() => calls.some((c) => c.path === '/api/approve-post' && /recP1/.test(c.body || ''))).toBe(true);
  // Review refreshes itself after an approve; wait for that before leaving.
  await expect(page.locator('.nl-rv-card[data-post-id="recP1"] .nl-rv-pill')).toHaveText('Approved');

  // Home opens a post on top of the page, as before.
  await page.click('.dash-nav-item[data-nav="dashboard"]');
  await page.locator('.nl-qrow__main').first().click();
  const overlay = page.locator('body > #studio-modal.active');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  await page.keyboard.press('Escape');
  await expect(page.locator('#studio-modal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('new look Inbox, Analytics, Coach, Settings and Brand: redesign layouts with their controls wired', async ({ page }) => {
  const errors = watchErrors(page);
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  let saved = null;
  const rows = [
    { title: 'Walk day reel', intent: 'grow', views: 41200, eng_rate: 9.1, permalink: 'https://instagram.com/p/1', taxonomy_status: 'proven' },
    { title: 'Shop restock', intent: 'sell', views: 4000, eng_rate: 1.6, permalink: '', taxonomy_status: 'unknown' },
  ];
  await mockApi(page, srv.base, {
    data: clientData(),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/inbox' && entry.method === 'GET') {
        json(200, { connected: true, total: 1, unreplied: 1, counts: { all: 1, needs_reply: 1, done: 0, dm: 0, comment: 1, mention: 0 }, items: [
          { id: 'c1', type: 'comment', platform: 'instagram', username: 'maya.k', text: 'Is the walk ok for kids?', timestamp: ago(0.01), last_inbound_at: ago(0.01), needs_reply: true, unread: true, status: 'open', thread: [{ id: 'm1', text: 'Is the walk ok for kids?', timestamp: ago(0.01), from_us: false, username: 'maya.k' }] },
        ], has_more: false, source: 'meta', sync: { quick_at: ago(0), deep_at: ago(0), deep_running: false }, auto_reply_enabled: false, auto_reply_mode: 'draft' });
        return 'handled';
      }
      if (entry.path === '/api/inbox/settings') { saved = JSON.parse(entry.body || '{}'); json(200, { ok: true }); return 'handled'; }
      if (entry.path === '/api/analytics/scorecard') {
        json(200, { clientType: 'charity', verdict: 'Reels are carrying the account.', kpis: { views: 184000, followers: 12480, eng_rate: 6.8, untagged: 2 },
          moves: { scale: [rows[0]], test: [], kill: [rows[1]] }, ranked: rows, rows, sources: [{ id: 'instagram', status: 'connected' }],
          charts: { labels: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4'], keys: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
            reach: { instagram: [400, 1200, 300, 500], facebook: [100, 300, 100, 100] }, interactions: { instagram: [10, 40, 8, 12], facebook: null },
            posts: [{ count: 0, items: [] }, { count: 1, items: [{ title: 'Walk day reel', platform: 'instagram', format: 'Reel' }] }, { count: 0, items: [] }, { count: 1, items: [{ title: 'Thank you post', platform: 'facebook', format: 'Photo' }] }],
            totals: { reach: { value: 3000, prev: 2500, delta_pct: 20 }, interactions: { value: 70, prev: 80, delta_pct: -12.5 } } } });
        return 'handled';
      }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
  await login(page, srv.base);

  // Inbox: AI replies Off / Draft / Auto saves the same settings call.
  await page.click('.dash-nav-item[data-nav="inbox"]');
  const ai = page.locator('.nl-ibx-ai');
  await expect(ai.locator('button[data-v="off"]')).toHaveAttribute('aria-pressed', 'true');
  await ai.locator('button[data-v="auto"]').click();
  await expect.poll(() => saved && `${saved.auto_reply_enabled}/${saved.auto_reply_mode}`).toBe('true/auto');
  await expect(ai.locator('button[data-v="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#inbox-settings-btn')).toBeHidden();
  await page.locator('.ibx-row').first().click();
  await expect(page.locator('#inbox-thread-pane .inbox-reply-text')).toBeVisible();

  // Analytics: header, lens tabs, KPI cards, bars, moves and the ranked table.
  await page.click('.dash-nav-item[data-nav="analytics"]');
  await expect(page.locator('.nl-an-head h1')).toHaveText('Analytics');
  await expect(page.locator('#nl-an-sub')).toHaveText('Last 30 days, Instagram.');
  await expect(page.locator('.nl-an-kpi')).toHaveCount(4);
  // Daily chart: real numbers and what they mean, not just bars.
  const daily = page.locator('#nl-daily');
  await expect(daily.locator('.nl-dc__title')).toHaveText('Daily reach, by platform');
  await expect(daily.locator('.nl-dc__col')).toHaveCount(4);
  await expect(daily.locator('.nl-dc__stats')).toContainText('3,000');
  await expect(daily.locator('.nl-dc__stats')).toContainText('+20% vs previous 30 days');
  await expect(daily.locator('.nl-dc__stats')).toContainText('Oct 2');
  await expect(daily.locator('.nl-dc__y span').first()).toHaveText('0');
  await expect(daily.locator('.nl-dc__legend')).toContainText('Instagram 2,400 80%');
  await expect(daily.locator('.nl-dc__finds')).toContainText('Best day was Fri, Oct 2: 1,500 reach, 2.0× your daily average. That was the day "Walk day reel" went out.');
  await expect(daily.locator('.nl-dc__finds')).toContainText('Instagram brought 80% of reach.');
  await expect(daily.locator('.nl-dc__mk i')).toHaveCount(2);
  await daily.locator('.nl-dc__col').nth(1).focus();
  const tip = daily.locator('.nl-dc__tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Friday, Oct 2');
  await expect(tip).toContainText('1,200Instagram');
  await expect(tip).toContainText('100% above your daily average');
  await expect(tip).toContainText('Walk day reel · Reel · Instagram');
  await daily.locator('summary', { hasText: 'Show the numbers' }).click();
  await expect(daily.locator('tbody tr')).toHaveCount(4);
  await daily.locator('[data-nl-metric="interactions"]').click();
  await expect(daily.locator('.nl-dc__title')).toHaveText('Daily interactions on Instagram');
  await expect(daily.locator('.nl-dc__stats')).toContainText('-12.5% vs previous 30 days');
  await expect(page.locator('#analytics-row-0 .nl-an-call')).toHaveText('Scale');
  await expect(page.locator('#analytics-row-1 .nl-an-call')).toHaveText('Kill');
  await page.locator('#analytics-period-pills [data-period="7d"]').click();
  await expect(page.locator('#analytics-period-pills [data-period="7d"]')).toHaveClass(/active/);
  await expect(page.locator('#nl-an-sub')).toHaveText('Last 7 days, Instagram.');
  await page.click('#analytics-charts-toggle');
  await expect(page.locator('#analytics-chart-format')).toBeVisible();

  // Coach: one card; Past conversations opens the projects list.
  await page.click('.dash-nav-item[data-nav="ai-coach"]');
  await expect(page.locator('.nl-cp-head h1')).toHaveText('Coach');
  await expect(page.locator('#chat-workspace-rail')).toBeHidden();
  await page.click('.nl-cp-past');
  await expect(page.locator('#chat-workspace-rail')).toBeVisible();
  await page.locator('.nl-cp-head h1').click();
  await expect(page.locator('#chat-workspace-rail')).toBeHidden();
  await expect(page.locator('.chat-container > #chat-suggestions')).toBeVisible();
  await expect(page.locator('.chat-input-bar #chat-attach-toolbar')).toBeVisible();

  // Settings opens on Account; Brand is its own page from the sidebar.
  await page.click('.dash-nav-item[data-nav="settings"]');
  await expect(page.locator('.nl-set-h1')).toHaveText('Settings');
  await expect(page.locator('.settings-tab[data-settings-tab="account"]')).toHaveClass(/active/);
  await expect(page.locator('.settings-tab[data-settings-tab="brand"]')).toBeHidden();
  await page.click('.settings-tab[data-settings-tab="connections"]');
  const ig = page.locator('.nl-conn-card').filter({ hasText: 'Instagram' }).first();
  await expect(ig.locator('.nl-conn-card__go')).toBeVisible();
  await ig.locator('.nl-conn-card__go').click();
  await expect(ig).toHaveClass(/is-open/);
  await page.click('.dash-nav-item[data-nl-brand]');
  await expect(page.locator('.nl-set-h1')).toHaveText(/Brand|Voice/);
  await expect(page.locator('.dash-nav-item[data-nl-brand]')).toHaveClass(/active/);
  await expect(page.locator('.settings-tabs')).toBeHidden();
  await page.click('.dash-nav-item[data-nav="settings"]');
  await expect(page.locator('.nl-set-h1')).toHaveText('Settings');
  await expect(page.locator('.settings-tab[data-settings-tab="account"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`new look: every sidebar item and Create mode renders without runtime errors at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    await mockApi(page, srv.base);
    await page.addInitScript(() => { try { localStorage.setItem('se-look2', 'new'); } catch (_) {} });
    await login(page, srv.base);
    const navs = await page.locator('#dash-sidebar .dash-nav-item[data-nav]').evaluateAll((els) => els.map((e) => e.dataset.nav));
    expect(navs.length).toBeGreaterThan(8);
    for (const nav of navs) {
      await page.locator(`.dash-nav-item[data-nav="${nav}"]`).evaluate((el) => el.click());
      await page.waitForTimeout(250);
      expect((await page.locator('#dash-content').innerText()).trim().length, nav).toBeGreaterThan(0);
      if (nav === 'create') {
        for (const seg of ['creation-studio', 'design-studio', 'brand-design', 'animation-studio']) {
          await page.locator(`.create-seg[data-segment="${seg}"]`).evaluate((el) => el.click());
          await page.waitForTimeout(300);
          expect((await page.locator('#dash-content').innerText()).trim().length, seg).toBeGreaterThan(0);
        }
      }
    }
    await page.locator('.dash-nav-item[data-nl-brand]').evaluate((el) => el.click());
    await expect(page.locator('.nl-set-h1')).toHaveText(/Brand|Voice/);
    expect(errors).toEqual([]);
  });
}
