// Intel: the competitor watchlist. Hermetic: the /api/intel routes are mocked from the agreed contract.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors, CHARITY_CAPS, COMMERCE_CAPS } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const HOUR = 3600e3;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

function comp(id, over = {}) {
  return { id: String(id), name: `Rival ${id}`, domain: `rival-${id}.example`, url: `https://rival-${id}.example/`, status: 'ok', error: null, last_checked_at: iso(-2 * HOUR), next_check_allowed_at: null, finding_count: 0, ...over };
}

const FINDINGS = [
  { id: 'f1', kind: 'new_page', tone: 'ok', label: 'New', title: 'Winter Warmth Appeal went live', body: 'A new appeal page with three gift amounts.', source: 'rival.example/appeals/winter', source_url: 'https://rival.example/appeals/winter', seen_at: iso(-30 * HOUR), action: { label: 'Plan our own appeal', target: 'campaign', brief: 'Plan an appeal' } },
  { id: 'f2', kind: 'giving_page', tone: 'warn', label: 'Changed', title: 'Default monthly gift moved to 15', body: 'The donate page now opens on a monthly gift.', source: 'rival.example/donate', source_url: 'javascript:alert(1)', seen_at: iso(-31 * HOUR), action: { label: 'Check our giving page', target: 'calendar', brief: 'x' } },
  { id: 'f3', kind: 'social', tone: 'sig', label: 'Right now', title: '6 posts in 7 days <img src=x onerror="window.__xss=1">', body: 'Counted from their last 12 Instagram posts.', source: 'Instagram, last 12 posts', source_url: null, seen_at: iso(-5 * HOUR), action: { label: 'Make our version', target: 'create', brief: 'Make a story post about a person we helped.' } },
  { id: 'f4', kind: 'homepage', tone: 'neu', label: 'Changed', title: 'Homepage headline changed', body: 'It went from one line to another.', source: 'rival.example/', source_url: 'https://rival.example/', seen_at: iso(-50 * HOUR), action: null },
];

function rhythm() {
  const you = Array(28).fill(0); const them = Array(28).fill(1);
  for (let i = 0; i < 10; i += 1) them[i] = null; // we can see the last 18 days only
  you[27] = 2; you[20] = 1;
  return { you, them, you_known_from: 0, them_known_from: 10, source: 'instagram' };
}

function detailFor(c, over = {}) {
  return {
    competitor: c, page_checks: true, first_check: false,
    findings: FINDINGS,
    compare: {
      you_label: 'Owner Co', them_label: c.name, as_of: iso(-HOUR),
      rows: [
        { key: 'ig', label: 'Instagram followers', you: '2,140', them: '18.2k', standing: 'behind' },
        { key: 'tt', label: 'TikTok followers', you: 'Not found', them: '4,310', standing: null },
        { key: 'posts', label: 'Posts, last 30 days', you: '24', them: '9', standing: 'lead' },
        { key: 'ways', label: 'Ways to give listed', you: '3', them: '3', standing: 'even' },
      ],
      standing: { lead: 1, behind: 1, even: 1, unknown: 1 },
    },
    rhythm: rhythm(),
    moves: [
      { title: 'Lead with a monthly gift', body: 'Their donate page opens on a monthly gift.', basis: '1 finding, giving page', primary: { label: 'Draft a monthly giving post', target: 'create', brief: 'Draft a post about monthly giving.' }, secondary: null },
      { title: 'Plan your appeal around theirs', body: 'Pick dates that do not overlap.', basis: '1 finding, appeal page', primary: { label: 'Open campaign planner', target: 'campaign', brief: '' }, secondary: { label: 'Dismiss' } },
    ],
    ...over,
  };
}

/** A small stateful fake of the Intel API. */
function intelApi(st) {
  st.calls = [];
  st.limit = st.limit || 5;
  st.page_checks = st.page_checks !== false;
  return async (entry, route, json) => {
    const p = entry.path;
    if (!p.startsWith('/api/intel')) return undefined;
    st.calls.push(`${entry.method} ${p}`);
    const body = entry.body ? JSON.parse(entry.body) : {};
    if (p === '/api/intel' && entry.method === 'GET') { json(200, { limit: st.limit, page_checks: st.page_checks, competitors: st.competitors }); return 'handled'; }
    if (p === '/api/intel/competitors' && entry.method === 'POST') {
      st.posted = (st.posted || []).concat(body);
      if (st.addError) { const e = st.addError; st.addError = null; json(e.status, e.body); return 'handled'; }
      const c = comp(`n${st.competitors.length + 1}`, { name: 'New Charity', domain: 'newcharity.example', url: body.url, status: 'checking', last_checked_at: null });
      st.competitors.push(c);
      json(201, { competitor: c });
      return 'handled';
    }
    const m = p.match(/^\/api\/intel\/competitors\/([^/]+)(\/check|\/report)?$/);
    if (m) {
      const id = m[1]; const c = st.competitors.find((x) => x.id === id);
      if (!c) { json(404, { error: 'Not found' }); return 'handled'; }
      if (m[2] === '/report' && entry.method === 'POST') {
        st.report = { id, body };
        if (st.reportError) { json(st.reportError.status, st.reportError.body); return 'handled'; }
        json(200, { competitor_name: 'Rival 1', analysis_type: 'charity', overall_summary: 'They lead with stories about people.', strengths: [{ text: 'Strong storytelling', sources: [{ n: 1, label: 'Giving page', url: 'https://rival-1.example/donate' }] }], weaknesses: [{ text: 'Few ways to give', sources: [] }], opportunities: [{ text: 'Monthly giving', sources: [] }], threats: [{ text: '<b>Bigger</b> reach', sources: [{ n: 2, label: 'Bad', url: 'javascript:alert(1)' }] }], messaging_analysis: 'Warm and direct.', messaging_sources: [], cause_differentiation: [{ text: 'Local focus', sources: [] }], content_ideas: [{ format: 'Reel', platform: 'Instagram', concept: 'A day with a nurse', hook: 'Meet Sam', description: 'Short film.', sources: [] }], based_on: { checked_at: '2026-10-20T18:00:00Z', observations: 14 } });
        return 'handled';
      }
      if (m[2] && entry.method === 'POST') {
        st.checks = (st.checks || 0) + 1;
        if (st.tooSoon) { json(429, { error: 'That was checked a moment ago.', retry_at: st.tooSoon }); return 'handled'; }
        c.status = 'checking';
        json(202, { competitor: c });
        return 'handled';
      }
      if (entry.method === 'DELETE') { st.competitors = st.competitors.filter((x) => x.id !== id); st.deleted = (st.deleted || 0) + 1; json(200, { ok: true }); return 'handled'; }
      if (entry.method === 'GET') {
        st.gets = (st.gets || 0) + 1;
        if (st.onGet) st.onGet(c, st.gets);
        json(200, st.detail ? st.detail(c) : detailFor(c, { findings: c.status === 'checking' && !c.finding_count ? [] : FINDINGS }));
        return 'handled';
      }
    }
    return undefined;
  };
}

async function open(page, st, { caps, client, look } = {}) {
  if (look) await page.addInitScript((l) => { try { localStorage.setItem('se-look2', l.look); if (l.theme) localStorage.setItem('se-nl-theme', l.theme); } catch (_) {} }, look);
  await mockApi(page, srv.base, { data: clientData({ capabilities: caps || CHARITY_CAPS, client }), onRequest: intelApi(st) });
  await login(page, srv.base);
  // On a phone the menu is off screen; the app's own switchNav opens the same page.
  if ((page.viewportSize() || {}).width < 900) await page.evaluate(() => window.switchNav('competitor-intel'));
  else await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await expect(page.locator('#intel-root')).toBeVisible();
}

test('empty watchlist explains itself; adding shows inline errors, then the first check runs', async ({ page }) => {
  const errors = watchErrors(page);
  const st = { competitors: [] };
  await open(page, st);
  await expect(page.locator('.in-sub')).toContainText('Charities you watch');
  await expect(page.locator('#in-count')).toHaveText('0 of 5');
  await expect(page.locator('.in-title__r')).toContainText('Checked when you ask');
  await expect(page.locator('.in-title__r')).not.toContainText('Monday');
  await expect(page.locator('.in-empty')).toContainText('You are not watching any charities yet');
  await expect(page.locator('#in-url')).toHaveAttribute('placeholder', 'https://similar-charity.org');

  await page.click('#in-add');
  await expect(page.locator('#in-add-err')).toContainText('Enter the website address');

  st.addError = { status: 400, body: { error: 'That address is not allowed.' } };
  await page.fill('#in-url', 'badsite.example');
  await page.click('#in-add');
  await expect(page.locator('#in-add-err')).toHaveText('That address is not allowed.');
  expect(st.posted[0]).toEqual({ url: 'https://badsite.example' });

  st.addError = { status: 409, body: { error: 'You are already watching that site.', code: 'duplicate' } };
  await page.click('#in-add');
  await expect(page.locator('#in-add-err')).toHaveText('You are already watching that site.');

  await page.fill('#in-url', 'https://newcharity.example');
  await page.click('#in-add');
  await expect(page.locator('#in-count')).toHaveText('1 of 5');
  await expect(page.locator('.in-wc')).toHaveCount(1);
  await expect(page.locator('.in-banner')).toContainText('Checking now, this takes up to a minute.');
  await expect(page.locator('#in-url')).toHaveValue('');
  await expect(page.locator('#in-add-err')).toHaveText('');
  expect(errors).toEqual([]);
});

test('five on the list: the add box is switched off and says why', async ({ page }) => {
  const st = { competitors: [1, 2, 3, 4, 5].map((i) => comp(i)) };
  await open(page, st);
  await expect(page.locator('#in-count')).toHaveText('5 of 5');
  await expect(page.locator('#in-url')).toBeDisabled();
  await expect(page.locator('#in-add')).toBeDisabled();
  await expect(page.locator('#in-add-hint')).toContainText('Your watchlist is full');
  await expect(page.locator('.in-wc')).toHaveCount(5);
});

test('a running check shows progress and is polled every 4 seconds until it is done', async ({ page }) => {
  const st = { competitors: [comp(1, { status: 'checking', last_checked_at: null })] };
  st.onGet = (c, n) => { if (n >= 4) { c.status = 'ok'; c.finding_count = 4; c.last_checked_at = iso(0); } };
  await open(page, st);
  await page.clock.install();
  await page.click('.in-wc__main'); // reselect: loads the detail and starts polling afresh
  await expect(page.locator('.in-banner').first()).toContainText('Checking now, this takes up to a minute.');
  await expect(page.locator('.in-chip').first()).toContainText('Checking');
  await expect(page.locator('#in-live')).toBeAttached();
  const before = st.gets;
  await page.clock.runFor(4100);
  await expect.poll(() => st.gets).toBeGreaterThan(before);
  for (let i = 0; i < 5 && st.competitors[0].status === 'checking'; i += 1) {
    const n = st.gets;
    await page.clock.runFor(4100);
    await expect.poll(() => st.gets).toBeGreaterThan(n);
  }
  await expect(page.locator('.in-chip').first()).toContainText('4 changes');
  await expect(page.locator('.in-find')).toHaveCount(4);
  await expect(page.locator('#in-live')).toContainText('is done');
  const settled = st.gets;
  await page.clock.runFor(20000);
  expect(st.gets).toBe(settled); // polling stopped
});

test('a check that never finishes is given up on after 3 minutes with a message', async ({ page }) => {
  const st = { competitors: [comp(1, { status: 'checking', last_checked_at: null })] };
  await open(page, st);
  await page.clock.install();
  await page.click('.in-wc__main');
  await expect(page.locator('.in-banner').first()).toContainText('Checking now');
  await page.clock.fastForward(200000);
  await expect(page.locator('.in-banner--warn')).toContainText('taking longer than usual');
  const n = st.gets;
  await page.clock.runFor(30000);
  expect(st.gets).toBe(n);
  await page.getByRole('button', { name: 'Look again' }).click();
  await expect(page.locator('.in-banner').first()).toContainText('Checking now');
});

test('a failed check shows the reason and Retry starts another', async ({ page }) => {
  const st = { competitors: [comp(1, { status: 'failed', error: 'We could not reach that website.' })] };
  st.detail = (c) => detailFor(c, { findings: [], compare: null, rhythm: null, moves: [] });
  await open(page, st);
  const banner = page.locator('.in-banner--warn[role="alert"]');
  await expect(banner).toContainText('The last check did not work. We could not reach that website.');
  await expect(page.locator('.in-chip').first()).toContainText('Check failed');
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => st.checks).toBe(1);
  await expect(page.locator('.in-banner').first()).toContainText('Checking now');
});

test('findings: tabs only for kinds that are present, filtering, saving, links and actions', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st);
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['All', 'Pages', 'Giving page', 'Social', 'Website']);
  await expect(page.locator('.in-find')).toHaveCount(4);
  await tabs.nth(3).click();
  await expect(page.locator('.in-find')).toHaveCount(1);
  await expect(page.locator('.in-find')).toContainText('6 posts in 7 days');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined(); // API text is escaped
  await expect(page.locator('.in-find img')).toHaveCount(0);
  // arrow keys move between tabs
  await page.getByRole('tab', { name: 'Social' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Website' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.in-find')).toContainText('Homepage headline changed');
  await expect(page.locator('.in-find .in-btn--soft')).toHaveCount(0); // no action on this one
  await page.getByRole('tab', { name: 'All' }).click();

  // links: http(s) only, safe rel; a javascript: url is shown as text
  const link = page.locator('a.in-src[href="https://rival.example/appeals/winter"]');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.locator('a.in-src[href^="javascript"]')).toHaveCount(0);
  await expect(page.locator('.in-find').nth(1).locator('.in-src')).toContainText('rival.example/donate');

  // Save is a remembered toggle
  const save = page.locator('.in-find').first().getByRole('button', { name: 'Save' });
  await save.click();
  await expect(page.locator('.in-find').first().getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('se_intel_saved'))).toContain('f1');
  await page.reload();
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
});

test('finding actions hand the brief to Create and open Calendar and the campaign planner', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st);
  await page.getByRole('button', { name: 'Check our giving page' }).click();
  await expect(page.locator('.dash-nav-item[data-nav="schedule"]')).toHaveClass(/active/);
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await page.getByRole('button', { name: 'Plan our own appeal' }).click();
  await expect(page.locator('.dash-nav-item[data-nav="fundraise"]')).toHaveClass(/active/);
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await page.getByRole('button', { name: 'Make our version' }).click();
  const session = await page.evaluate(() => window.__SE_COACH_CREATE_SESSION);
  expect(session).toMatchObject({ destination: 'design', mode: 'image', prompt: 'Make a story post about a person we helped.' });
  await expect(page.locator('#cs-brief')).toHaveValue(/story post about a person we helped/, { timeout: 10000 });
});

test('comparison: summary from the data, standing marks, Not found muted, no scores', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st);
  const aside = page.locator('.in-aside');
  await expect(aside.locator('.in-sum')).toHaveText('You are ahead on 1, behind on 1, level on 1. 1 could not be found.');
  await expect(aside.locator('.in-mark--lead')).toHaveCount(1);
  await expect(aside.locator('.in-mark--behind')).toHaveCount(1);
  await expect(aside.locator('.in-cmp--r')).toHaveCount(4);
  await expect(aside.locator('.in-miss')).toHaveText('Not found');
  await expect(aside.locator('.in-cmp--h')).toContainText('Owner Co');
  await expect(aside).toContainText('There is no overall score.');
  await expect(page.locator('#intel-root')).not.toContainText(/\b\d+\s*\/\s*100\b/);
});

test('posting rhythm: 4 rows of 7 from the first weekday, unseen days hatched, short history noted', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st);
  const grids = page.locator('.in-grid');
  await expect(grids).toHaveCount(2);
  await expect(page.locator('#in-rh-h')).toHaveText('Posting, last 4 weeks');
  await expect(page.locator('.in-aside')).toContainText('Instagram posts, last 4 weeks');
  await expect(grids.first().locator('.in-sq')).toHaveCount(28);
  await expect(grids.nth(1).locator('.in-sq--n')).toHaveCount(10);
  await expect(grids.nth(1).locator('.in-sq--n').first()).toHaveAttribute('title', /Not visible to us/);
  await expect(page.locator('.in-rhy__s').nth(1)).toContainText('We can see the last 18 days only');
  await expect(page.locator('.in-rhy__s').first()).not.toContainText('We can see the last');
  const firstDow = await grids.first().locator('.in-dow').first().textContent();
  const expected = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 27); return d.toLocaleDateString(undefined, { weekday: 'narrow' }); });
  expect(firstDow).toBe(expected);
});

test('posting rhythm: a side we cannot see at all says Not visible', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  st.detail = (c) => detailFor(c, { rhythm: { you: Array(28).fill(0), them: Array(28).fill(null), source: 'instagram' } });
  await open(page, st);
  await expect(page.locator('.in-hide')).toHaveText('Not visible');
  await expect(page.locator('.in-grid')).toHaveCount(1);
});

test('Check now: starts a check, and a cooldown shows a disabled button with the time it is available', async ({ page }) => {
  const st = { competitors: [comp(1, { next_check_allowed_at: iso(5 * HOUR) })] };
  await open(page, st);
  const disabled = page.locator('.in-acts .in-btn');
  await expect(disabled).toBeDisabled();
  await expect(disabled).toContainText('Available again');
  await expect(page.locator('.in-meta').first()).toContainText('Last checked');

  // a different competitor that can be checked, and one the server says is too soon
  st.competitors.push(comp(2, { next_check_allowed_at: null }));
  await page.reload();
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await page.locator('.in-wc__main').nth(1).click();
  st.tooSoon = iso(2 * HOUR);
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('.in-banner--warn')).toContainText('That was checked a moment ago.');
  await expect(page.locator('.in-acts .in-btn')).toContainText('Available again');
  expect(st.checks).toBe(1);

  st.tooSoon = null;
  st.competitors[1].next_check_allowed_at = null;
  await page.locator('.in-wc__main').nth(0).click();
  await page.locator('.in-wc__main').nth(1).click();
  await page.reload();
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await page.locator('.in-wc__main').nth(1).click();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect.poll(() => st.checks).toBe(2);
  await expect(page.locator('.in-banner').first()).toContainText('Checking now');
});

test('removing asks first, then takes the competitor off the list', async ({ page }) => {
  const st = { competitors: [comp(1), comp(2)] };
  await open(page, st);
  const msgs = [];
  page.on('dialog', async (d) => { msgs.push(d.message()); if (msgs.length === 1) await d.dismiss(); else await d.accept(); });
  await page.getByRole('button', { name: 'Remove Rival 1 from your watchlist' }).click();
  await expect.poll(() => msgs.length).toBe(1);
  expect(st.deleted).toBeUndefined();
  await expect(page.locator('.in-wc')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove Rival 1 from your watchlist' }).click();
  await expect.poll(() => st.deleted).toBe(1);
  expect(msgs[1]).toContain('Rival 1');
  await expect(page.locator('.in-wc')).toHaveCount(1);
  await expect(page.locator('#in-count')).toHaveText('1 of 5');
  await expect(page.locator('.in-h2').first()).toContainText('Rival 2');
});

test('no findings: first check and later checks say different things; page checks off shows a note', async ({ page }) => {
  const st = { competitors: [comp(1)], page_checks: false };
  st.detail = (c) => detailFor(c, { findings: [], first_check: st.first, page_checks: false });
  st.first = true;
  await open(page, st);
  await expect(page.locator('.in-note').first()).toContainText('Page checks are not switched on yet. Social and catalog numbers still work.');
  await expect(page.locator('.in-main')).toContainText('First look. Changes show up from the next check.');
  st.first = false;
  await page.reload();
  await expect(page.locator('#dashboard-view')).toHaveClass(/active/, { timeout: 15000 });
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await expect(page.locator('.in-main')).toContainText('Nothing changed since the last check.');
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('first check with baseline findings is labelled as a first look', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  st.detail = (c) => detailFor(c, { first_check: true });
  await open(page, st);
  await expect(page.locator('.in-main .in-note')).toHaveText('First look. Changes show up from the next check.');
  await expect(page.locator('.in-find')).toHaveCount(4);
});

test('moves: actions go where they say, Dismiss hides and is remembered', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st);
  const moves = page.locator('.in-move');
  await expect(moves).toHaveCount(2);
  await expect(moves.first()).toContainText('Based on: 1 finding, giving page');
  await moves.nth(1).getByRole('button', { name: 'Dismiss' }).click();
  await expect(moves).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('se_intel_dismissed'))).toContain('Plan your appeal around theirs');
  await page.getByRole('button', { name: 'Show 1 dismissed' }).click();
  await expect(moves).toHaveCount(2);
  await moves.nth(1).getByRole('button', { name: 'Show again' }).click();
  await expect(moves.nth(1).getByRole('button', { name: 'Dismiss' })).toBeVisible();
  await expect(moves.first().getByRole('button')).toHaveCount(1); // no secondary button when there is none
  await moves.nth(1).getByRole('button', { name: 'Open campaign planner' }).click();
  await expect(page.locator('.dash-nav-item[data-nav="fundraise"]')).toHaveClass(/active/);
});

test('the full report is written from the checks, links its sources and shows no scores', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st);
  await page.getByRole('button', { name: 'Write the full report' }).click();
  await expect(page.locator('#in-report')).toContainText('They lead with stories about people.');
  expect(st.report.id).toBe('1');
  await expect(page.locator('.in-swot')).toContainText('Strong storytelling');
  await expect(page.locator('.in-swot a[href="https://rival-1.example/donate"]')).toHaveText('Giving page');
  await expect(page.locator('.in-swot a[href^="javascript"]')).toHaveCount(0); // unsafe links are not made clickable
  await expect(page.locator('.in-swot b')).toHaveCount(0); // text from the API is escaped
  await expect(page.locator('#in-report')).toContainText('14 observations');
  await expect(page.locator('#in-report')).not.toContainText(/score/i);
});

test('a store sees "stores" and its own labels', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st, { caps: COMMERCE_CAPS });
  await expect(page.locator('.in-sub')).toContainText('Stores you watch');
  await expect(page.locator('#in-url')).toHaveAttribute('placeholder', 'https://competitor-store.com');
  await expect(page.getByRole('tab')).toHaveText(['All', 'Pages', 'Prices', 'Social', 'Website']);
  await page.getByRole('button', { name: 'Write the full report' }).click();
  await expect(page.locator('#in-report')).toBeVisible();
});

test('if the report cannot be written the person sees the reason, not a dead button', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })], reportError: { status: 409, body: { error: 'Check this competitor first. The report is written from what the check finds.' } } };
  await open(page, st);
  await page.getByRole('button', { name: 'Write the full report' }).click();
  await expect(page.locator('.in-banner--warn')).toContainText('Check this competitor first');
  await expect(page.getByRole('button', { name: 'Write the full report' })).toBeEnabled();
});

test('the unpaid and preview tiers still see the upgrade prompt, not the tool', async ({ page }) => {
  const st = { competitors: [] };
  await mockApi(page, srv.base, { data: clientData({ client: { is_paid: false, tier: 'Starter' } }), onRequest: intelApi(st) });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await expect(page.locator('.upgrade-fullpage')).toBeVisible();
  await expect(page.locator('#intel-root')).toHaveCount(0);
  expect(st.calls).toEqual([]);
});

test('at 390px wide: no sideways scroll, everything reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const st = { competitors: [comp(1, { finding_count: 4 }), comp(2, { status: 'checking' })] };
  await open(page, st);
  await expect(page.locator('.in-find')).toHaveCount(4);
  const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, root: document.querySelector('#intel-root').scrollWidth - document.querySelector('#intel-root').clientWidth }));
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.root).toBeLessThanOrEqual(0);
  const box = await page.locator('.in-aside').boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#in-add')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write the full report' })).toBeVisible();
  for (const sel of ['.in-find', '.in-cmp--r', '.in-move', '.in-wc']) {
    const over = await page.locator(sel).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
    expect(over, sel).toBe(0);
  }
});

test('new look: follows Dark and Day', async ({ page }) => {
  const st = { competitors: [comp(1, { finding_count: 4 })] };
  await open(page, st, { look: { look: 'new', theme: 'dark' } });
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  const bg = () => page.locator('.in-find').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg()).toBe('rgb(16, 18, 22)');
  await page.evaluate(() => window.seNewLook.theme('day'));
  await expect.poll(bg).toBe('rgb(255, 255, 255)');
  const kind = await page.locator('.in-kind--ok').first().evaluate((el) => getComputedStyle(el).color);
  expect(kind).toBe('rgb(15, 143, 99)');
});

test('a failed check can be retried even with a cooldown date; cards show when each was checked', async ({ page }) => {
  const st = { competitors: [comp(1, { status: 'failed', error: 'We could not reach that website.', next_check_allowed_at: iso(5 * HOUR) }), comp(2, { last_checked_at: null })] };
  st.detail = (c) => detailFor(c, { findings: [], compare: null, rhythm: null, moves: [] });
  await open(page, st);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeEnabled();
  await expect(page.locator('.in-wc').nth(0)).toContainText('Checked ');
  await expect(page.locator('.in-wc').nth(1)).toContainText('Not checked yet');
  await expect(page.locator('.in-aside')).toHaveCount(0); // compare and rhythm can be null
});

test('a plan error from the API shows the upgrade prompt', async ({ page }) => {
  await mockApi(page, srv.base, { data: clientData({ capabilities: CHARITY_CAPS }), onRequest: async (entry, route, json) => {
    if (entry.path === '/api/intel') { json(402, { error: 'Upgrade to use Intel' }); return 'handled'; }
    return undefined;
  } });
  await login(page, srv.base);
  await page.click('.dash-nav-item[data-nav="competitor-intel"]');
  await expect(page.locator('.upgrade-fullpage')).toBeVisible();
});
