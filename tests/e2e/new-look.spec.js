// New look (graphite redesign): off unless switched on with ?look=new; the rail keeps every
// page reachable, the ⌘K bar jumps between pages, Day/Dark sticks, inline navy and purple
// map to the new palette, and ?look=old switches it off again. Hermetic.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const rgb = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

test('old look stays the default; nothing from the new look shows', async ({ page }) => {
  await mockApi(page, srv.base, { data: clientData() });
  await login(page, srv.base);
  await expect(page.locator('html')).not.toHaveClass(/\bnl\b/);
  await expect(page.locator('.nl-cmd')).toBeHidden();
  await expect(page.locator('.nl-theme-btn')).toHaveCount(0);
  expect(await rgb(page, '.dash-sidebar', 'width')).not.toBe('68px');
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
  await page.addInitScript(() => { try { localStorage.setItem('se-look', 'new'); } catch (_) {} });
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

test('new look Post: options out of drawers, size control drives the size, caption has its own card, handlers still work', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, srv.base, { data: clientData() });
  await page.addInitScript(() => { try { localStorage.setItem('se-look', 'new'); } catch (_) {} });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="create"]');
  await page.click('.create-seg[data-segment="design-studio"]');
  await expect(page.locator('.nl-post')).toBeVisible();
  await expect(page.locator('.nl-post__opts #cs-style')).toBeVisible();
  await expect(page.locator('.nl-post__opts #cs-engine')).toBeVisible();
  await page.click('.nl-seg--fill button[data-aspect="1:1"]');
  await expect(page.locator('#cs-aspect')).toHaveValue('1:1');
  await expect(page.locator('.nl-seg--fill button[data-aspect="1:1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { document.getElementById('cs-aspect').value = '4:5'; });
  await expect(page.locator('.nl-seg--fill button[data-aspect="4:5"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.nl-caption #cs-caption')).toHaveText('Get caption');
  await expect(page.locator('.nl-caption #cs-caption-box')).toBeVisible();
  await expect(page.locator('.atelier-essentials #cs-generate')).toBeInViewport();
  // A handler bound before the move still fires.
  await page.click('#cs-new-post');
  await expect(page.locator('#cs-brief')).toHaveValue('');
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
  await page.addInitScript(() => { try { localStorage.setItem('se-look', 'new'); } catch (_) {} });
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
    { id: 'recS', status: 'Scheduled', caption: 'Last call for sign-ups', platform: 'Facebook', content_type: 'reel', scheduled_date: `${ymd}T18:00:00.000Z` },
  ];
  await mockApi(page, srv.base, {
    data: clientData({ content, posts: content, client: { tier: 'growth', social_connected_platforms: ['instagram'] } }),
    onRequest: async (entry, route, json) => {
      if (entry.path === '/api/meta-planner') { json(200, { slots: [{ date: '2999-01-01', format: 'reel', story_type: 'pov', story_type_label: 'POV', status: 'open' }] }); return 'handled'; }
      return undefined;
    },
  });
  await page.addInitScript(() => { try { localStorage.setItem('se-look', 'new'); } catch (_) {} });
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
  await page.addInitScript(() => { try { localStorage.setItem('se-look', 'new'); } catch (_) {} });
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
