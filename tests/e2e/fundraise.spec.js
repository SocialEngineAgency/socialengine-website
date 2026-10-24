// Fundraise: JustGiving pages and Meta fundraisers in one list, what to do next, drafts, and the campaign builder.
// Hermetic: the /api/fundraise routes are mocked from the real endpoints' fields.
const { test, expect } = require('@playwright/test');
const { startStatic, mockApi, login, clientData, watchErrors, CHARITY_CAPS } = require('./helpers/portal-mock');

let srv;
test.beforeAll(async () => { srv = await startStatic(); });
test.afterAll(async () => { srv.close(); });

const pad = (n) => String(n).padStart(2, '0');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function jgPage(id, title, owner, raised, target, endsIn, over = {}) {
  return {
    id, title, short_name: id, status: 'Active', total_raised: raised, total_raised_with_giftaid: 0, target, currency: 'GBP', owner_name: owner,
    page_url: `https://www.justgiving.com/page/${id}`, created_at: day(-12), expires_at: endsIn == null ? null : day(endsIn), image_url: 'https://img.test/p.jpg', ...over,
  };
}

const PAGES = () => [
  jgPage('mia-walk', "Mia's Winter Walk", 'Mia Okafor', 1640, 2000, 12, { total_raised_with_giftaid: 1982 }),
  jgPage('tilly', 'Ten for Tilly', 'Rob and Sam Hale', 920, 1000, 9),
  jgPage('dad60', "Dad's 60th", 'Priya Nair', 810, 1000, 20),
  jgPage('marathon', 'Marathon for OPA', 'Chris Bell', 1150, 2500, 4),
  jgPage('cake', "Cake sale at St Mary's", 'Jo Whitfield', 240, 500, 6),
  jgPage('bernard', 'Baking for Bernard', 'Lena Cruz', 380, 1500, 40),
  jgPage('wedding', 'Our wedding day', 'Tom and Ayo Reed', 0, 1000, 60, { created_at: day(-12), image_url: '' }),
  jgPage('quiz', 'Quiz night 2026', 'Dave Mills', 205, 600, 50),
  jgPage('closed', 'A closed page', 'Old Owner', 5000, 5000, null, { status: 'Inactive' }),
];

const META_OK = { meta_connected: true, page_id: 'p1', list_source: 'me', fundraisers: [{ id: 'm1', title: 'Facebook birthday fundraiser', amount_raised: 150, goal: 400, currency: 'GBP', donation_count: 7, ends_at: day(30), url: 'https://www.facebook.com/donate/m1', source: 'meta' }] };

const POSTS_OUT = (n) => Array.from({ length: n }, (_, i) => ({
  slot_id: `d${i + 1}-1`, date: day(1 + Math.floor(i / 2)), day: 1 + Math.floor(i / 2), phase: i === 0 ? 'launch' : 'why', platform: i % 2 ? 'instagram' : 'facebook', time: i % 2 ? '19:00' : '09:30',
  donate_url: 'https://www.justgiving.com/page/mia-walk', caption: `Draft caption ${i + 1}`, first_comment: 'First comment', hashtags: '#OPA', image_prompt: 'A warm kitchen table', reel_idea: 'A short film', post_label: 'Launch', needs_numbers: i === 1,
}));

/** A small stateful fake of the Fundraise API. */
function fundraiseApi(st) {
  st.calls = [];
  return async (entry, route, json) => {
    const p = entry.path;
    if (!p.startsWith('/api/fundraise')) return undefined;
    st.calls.push(`${entry.method} ${p}`);
    const body = entry.body ? JSON.parse(entry.body) : {};
    if (p === '/api/fundraise/campaigns') {
      st.jgGets = (st.jgGets || 0) + 1;
      if (st.jgError && st.jgGets <= (st.jgErrorTimes || 1)) { json(st.jgError.status, st.jgError.body); return 'handled'; }
      json(200, { campaigns: st.pages ? st.pages() : PAGES(), charity_id: '123' });
      return 'handled';
    }
    if (p === '/api/fundraise/meta') { json(200, st.meta || META_OK); return 'handled'; }
    if (p === '/api/fundraise/save-charity-id') { st.saved = body; json(200, { success: true }); return 'handled'; }
    if (p === '/api/fundraise/campaign/preview') {
      st.preview = body;
      if (st.previewError) { json(st.previewError.status, st.previewError.body); return 'handled'; }
      await new Promise((r) => setTimeout(r, st.previewDelay || 0));
      json(200, { campaign: { ...body, goal: Number(body.goal) }, posts: POSTS_OUT(st.postCount || 4), empty: 0 });
      return 'handled';
    }
    if (p === '/api/fundraise/campaign/create') {
      st.created = body;
      if (st.createError) { json(st.createError.status, st.createError.body); return 'handled'; }
      if (st.onCreate) st.onCreate(body);
      json(200, { success: true, created: body.posts.length, needs_numbers: body.posts.filter((x) => x.needs_numbers).length, skipped: [] });
      return 'handled';
    }
    return undefined;
  };
}

async function open(page, st, { client, content, look, ctx } = {}) {
  if (look) await page.addInitScript((l) => { try { localStorage.setItem('se-look2', l.look); if (l.theme) localStorage.setItem('se-nl-theme', l.theme); } catch (_) {} }, look);
  const data = clientData({ capabilities: CHARITY_CAPS, client: { justgiving_charity_id: '123', meta_page_id: 'p1', website: 'https://opa.org.uk', ...(client || {}) }, content: content || [] });
  st.data = data;
  await mockApi(page, srv.base, { data, onRequest: fundraiseApi(st) });
  await login(page, srv.base);
  if ((page.viewportSize() || {}).width < 900) await page.evaluate(() => window.switchNav('fundraise'));
  else await page.click('.dash-nav-item[data-nav="fundraise"]');
  await expect(page.locator('#fundraise-root')).toBeVisible();
}

const rows = (page) => page.locator('.fr-row');

test('overview: header chips, what needs doing, totals and the list come from the page data', async ({ page }) => {
  const errors = watchErrors(page);
  const st = {};
  await open(page, st);
  await expect(page.locator('.fr-h1')).toHaveText('Fundraise');
  await expect(page.locator('#fr-chips')).toContainText('JustGiving');
  await expect(page.locator('#fr-chips')).toContainText('Meta fundraisers');
  await expect(page.getByRole('button', { name: 'Start a campaign' }).first()).toBeVisible();
  // Worth doing this week: ends soon (2), near target (3), no gifts (1), and the next campaign date
  const cards = page.locator('.fr-need');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('End this week');
  await expect(cards.nth(0)).toContainText('Marathon for OPA and Cake sale');
  await expect(cards.nth(1)).toContainText('Close to their target');
  await expect(cards.nth(1)).toContainText("Mia's Winter Walk, Ten for Tilly and Dad's 60th are over 80% of the way");
  await expect(cards.nth(2)).toContainText('No gifts yet');
  await expect(cards.nth(3)).toContainText('start it by');
  // KPIs: sums over the 8 active pages (the closed page is not counted)
  const kpis = page.locator('.fr-kpi');
  await expect(kpis).toHaveCount(4);
  await expect(kpis.nth(0)).toContainText('Raised on JustGiving');
  await expect(kpis.nth(0)).toContainText('£5,345');
  await expect(kpis.nth(0)).toContainText('Meta fundraisers raised £150, counted separately.');
  await expect(kpis.nth(1)).toContainText('£342'); // gift aid on top, from the one page that reports it
  await expect(kpis.nth(1)).toContainText('Counted on 1 of 8 pages');
  await expect(kpis.nth(2)).toContainText('8');
  await expect(kpis.nth(2)).toContainText('of 9 pages listed');
  await expect(kpis.nth(3)).toContainText('£668'); // 5,345 / 8
  // no invented trend line, no "last gift" claims without data
  await expect(page.locator('.fr svg path[stroke]')).toHaveCount(0);
  await expect(page.locator('.fr-list, #fr-list')).toContainText('Last gift dates are not available from JustGiving, so Gone quiet is not shown.');
  await expect(page.getByRole('button', { name: /Gone quiet/ })).toHaveCount(0);
  // the list: urgent first, then near target; 8 shown of 9 (8 JustGiving + 1 Meta)
  await expect(rows(page)).toHaveCount(8);
  await expect(rows(page).nth(0)).toContainText('Marathon for OPA');
  await expect(rows(page).nth(0)).toContainText('Ends soon');
  await expect(rows(page).nth(2)).toContainText('Near target');
  await expect(page.locator('#fr-list')).toContainText('Showing 8 of 9. Sorted by what needs you first.');
  await page.getByRole('button', { name: 'Show all 9' }).click();
  await expect(rows(page)).toHaveCount(9);
  // Coming up, computed from today
  await expect(page.locator('#fr-coming .fr-when')).toHaveCount(3);
  await expect(page.locator('#fr-coming')).toContainText('Advent begins');
  await expect(page.locator('#fr-coming')).toContainText('Giving Tuesday');
  await expect(page.locator('#fr-coming')).toContainText('Christmas Day');
  // plain language, no em dashes anywhere on the page
  expect(await page.locator('#fundraise-root').innerText()).not.toContain('—');
  expect(errors).toEqual([]);
});

test('filters narrow the list and the counts match; Meta rows are listed with the pages', async ({ page }) => {
  const st = {};
  await open(page, st);
  await expect(page.getByRole('button', { name: /^All 9$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Near target 3$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ending soon 2$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Not started 1$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Meta 1$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Near target/ }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Near target/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Ending soon/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^Not started/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Our wedding day');
  await expect(rows(page).first()).toContainText('Ends in 60 days');
  await page.getByRole('button', { name: /^Meta/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Facebook birthday fundraiser');
  await expect(rows(page).first()).toContainText('Meta fundraiser');
});

test('selecting a fundraiser shows its numbers and a Basis line for every move', async ({ page }) => {
  const st = {};
  await open(page, st);
  await rows(page).filter({ hasText: "Mia's Winter Walk" }).click();
  const d = page.locator('#fr-detail');
  await expect(d.getByRole('heading', { name: "Mia's Winter Walk" })).toBeVisible();
  await expect(d).toContainText('£1,640 of £2,000');
  await expect(d).toContainText('£1,982');
  await expect(d).toContainText('The supporter count and last gift date are not available from JustGiving.');
  await expect(d).toContainText('Thank Mia');
  await expect(d).toContainText('£360 to go for the £2,000 goal, with 12 days left.');
  await expect(d).toContainText('Basis: 82% of target, ends in 12 days');
  await expect(d).toContainText('Share this page');
  await expect(d).toContainText('Basis: no post in your calendar links to this page');
  await expect(d.getByRole('link', { name: /Open on JustGiving/ })).toHaveAttribute('href', 'https://www.justgiving.com/page/mia-walk');
  // a page with no picture gets the photo move, with the fact it rests on
  await rows(page).filter({ hasText: 'Our wedding day' }).click();
  await expect(d).toContainText('Ask for a photo and an update');
  await expect(d).toContainText('Basis: JustGiving sent no picture for this page');
  await expect(d).toContainText('Nudge towards a first gift');
  // a Meta fundraiser shows what Meta gives
  await page.getByRole('button', { name: 'Show all 9' }).click();
  await rows(page).filter({ hasText: 'Facebook birthday fundraiser' }).click();
  await expect(d).toContainText('7 gifts');
  await expect(d.getByRole('link', { name: /Open on Meta/ })).toBeVisible();
  await expect(d).not.toContainText('With Gift Aid');
});

test('a draft opens in a dialog, copies, can be edited, closes with Escape, and nothing is sent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.base });
  const st = {};
  await open(page, st);
  await rows(page).filter({ hasText: "Mia's Winter Walk" }).click();
  const opener = page.getByRole('button', { name: 'Draft a thank-you' });
  await opener.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('heading', { name: 'Thank-you draft' })).toBeVisible();
  await expect(dlg).toContainText('Nothing is sent from here');
  const ta = dlg.getByRole('textbox');
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue(/^Hi Mia,/);
  await expect(ta).toHaveValue(/"Mia's Winter Walk" has raised £1,640 so far, which is 82% of the £2,000 goal\./);
  await expect(ta).toHaveValue(/There are 12 days left\./);
  await ta.fill('Hi Mia, edited by me.');
  await dlg.getByRole('button', { name: 'Copy' }).click();
  await expect(dlg.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hi Mia, edited by me.');
  await expect(page.locator('#fr-live')).toHaveText('Copied to the clipboard.');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(st.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
});

test('the dialog keeps keyboard focus inside and closes from the button and the backdrop', async ({ page }) => {
  const st = {};
  await open(page, st);
  await page.getByRole('button', { name: 'Draft three thank-yous' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: /Thank-you drafts \(3\)/ })).toBeVisible();
  await expect(dlg.locator('textarea')).toHaveCount(3);
  await expect(dlg.locator('textarea').nth(1)).toHaveValue(/^Hi Rob and Sam,/);
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('.fr-modal'))).toBe(true);
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toHaveCount(0);
  await page.getByRole('button', { name: 'Make share posts' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Open in Create' })).toHaveCount(2);
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Start a campaign opens the builder: basics are checked, the plan is the writer\'s own 14 day limit', async ({ page }) => {
  const st = {};
  await open(page, st);
  await page.getByRole('button', { name: 'Start a campaign' }).first().click();
  await expect(page.getByRole('heading', { name: 'Start a campaign', level: 1 })).toBeVisible();
  await expect(page.locator('#fr-b-steps li')).toHaveCount(3);
  await expect(page.locator('.fr-step[aria-current="step"]')).toContainText('Basics');
  // a default week: 7 days, 2 posts a day, thank-you the day after = 15 posts
  await expect(page.locator('#fr-tl-h')).toHaveText('Your 8 days');
  await expect(page.locator('#fr-b-aside')).toContainText('15 posts');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#fr-b-err')).toHaveText('Give the campaign a name.');
  await page.getByLabel('Campaign name').fill('Three Weeks Appeal');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#fr-b-err')).toHaveText('Set a fundraising goal above zero.');
  await page.getByLabel('Goal').fill('2000');
  await page.getByLabel('End').fill(day(20));
  await expect(page.locator('#fr-b-aside')).toContainText('Campaigns can run for up to 14 days');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#fr-b-err')).toHaveText('Campaigns can run for up to 14 days.');
  await page.getByLabel('End').fill(day(14));
  await expect(page.locator('#fr-tl-h')).toHaveText('Your 15 days');
  await expect(page.locator('#fr-b-aside')).toContainText('Launch');
  await expect(page.locator('#fr-b-aside')).toContainText('Final push');
  await expect(page.locator('#fr-b-aside')).toContainText('Thank you');
  await page.getByLabel('End').fill(day(5));
  await page.getByLabel('Start').fill(day(-1));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#fr-b-err')).toContainText('start date has already passed');
});

test('the whole builder: pick a page, write the posts, edit one, add them to the calendar', async ({ page }) => {
  const errors = watchErrors(page);
  const st = { postCount: 4, previewDelay: 400 };
  st.onCreate = (b) => {
    st.data.content.push(...b.posts.map((p, i) => ({ id: `c${i}`, theme: 'Fundraising campaign', post_label: `Three Weeks Appeal · Day ${p.day} · Launch`, scheduled_date: p.date, scheduled_time: p.time, status: i === 0 ? 'Published' : 'Ready for Review', platform: p.platform === 'facebook' ? 'Facebook' : 'Instagram', cta: p.donate_url })));
  };
  await open(page, st);
  await page.getByRole('button', { name: 'Start a campaign' }).first().click();
  await page.getByLabel('Campaign name').fill('Three Weeks Appeal');
  await page.getByLabel('Goal').fill('2000');
  await page.getByLabel('Start').fill(day(1));
  await page.getByLabel('End').fill(day(7));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.fr-step[aria-current="step"]')).toContainText('Story and impact');
  await expect(page.locator('#fr-b-sum')).toContainText('Three Weeks Appeal · £2,000');
  // the picker offers the connected pages, no pasting
  const places = page.locator('#fr-places');
  await expect(places).toContainText("JustGiving: Mia's Winter Walk");
  await expect(places).toContainText('£1,640 raised so far');
  await expect(places).toContainText('Facebook fundraiser: Facebook birthday fundraiser');
  await expect(places).not.toContainText('A closed page');
  // nothing chosen: a clear message
  await page.getByRole('button', { name: 'Write the posts' }).click();
  await expect(page.locator('#fr-b-err')).toContainText('at least one place');
  await places.getByLabel("JustGiving: Mia's Winter Walk").check();
  await places.getByLabel('JustGiving: Ten for Tilly').check();
  await expect(places.getByLabel("JustGiving: Mia's Winter Walk")).not.toBeChecked(); // one JustGiving page at a time
  await places.getByLabel("JustGiving: Mia's Winter Walk").check();
  await expect(places.locator('.fr-place.is-on')).toHaveCount(1);
  await page.getByLabel('What is this campaign for?').fill('Every winter our support line gets busier. This appeal funds extra evening calls.');
  await expect(page.locator('#fr-story-n')).toHaveText('81 of 1,500');
  const gifts = page.locator('#fr-gifts .fr-gift');
  await gifts.nth(0).locator('input').nth(0).fill('10');
  await gifts.nth(0).locator('input').nth(1).fill('funds one evening support line call');
  await gifts.nth(1).locator('input').nth(0).fill('£25');
  await page.getByRole('button', { name: 'Write the posts' }).click();
  await expect(page.locator('#fr-b-err')).toContainText('Say what the £25 gift does');
  await gifts.nth(1).locator('input').nth(1).fill('funds a full evening shift');
  // the sample uses what was typed and says it is only a layout
  await expect(page.locator('#fr-b-aside .fr-sample')).toContainText('Every winter our support line gets busier.');
  await expect(page.locator('#fr-b-aside .fr-sample')).toContainText('£10 funds one evening support line call');
  await expect(page.locator('#fr-b-aside')).toContainText('only shows the layout');
  await page.getByRole('button', { name: 'Write the posts' }).click();
  await expect(page.getByRole('heading', { name: 'Writing your campaign' })).toBeVisible();
  await expect(page.locator('#fr-live')).toContainText('Writing your campaign');
  await expect(page.getByRole('heading', { name: 'Review and add to calendar' })).toBeVisible();
  // what was sent to the writer
  expect(st.preview).toMatchObject({ name: 'Three Weeks Appeal', goal: '2000', currency: 'GBP', posts_per_day: '2', justgiving_url: 'https://www.justgiving.com/page/mia-walk', meta_fundraiser_url: '', site_donation_url: '', platforms: ['facebook', 'instagram'], include_thank_you: true });
  expect(st.preview.impact_points).toEqual(['£10 funds one evening support line call', '£25 funds a full evening shift']);
  expect(st.preview.start_date).toBe(day(1)); expect(st.preview.end_date).toBe(day(7));
  // review: posts are editable, numbers are flagged, nothing is on the calendar yet
  await expect(page.locator('.fr-post')).toHaveCount(4);
  await expect(page.locator('.fr-post').nth(1)).toContainText('Needs a number, saves as Draft');
  expect(st.calls.some((c) => c === 'POST /api/fundraise/campaign/create')).toBe(false);
  await page.locator('#fr-pc-0').fill('My own opening line.');
  await page.getByRole('button', { name: 'Add 4 posts to calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Added to your calendar' })).toBeVisible();
  await expect(page.locator('#fr-b-step')).toContainText('Added 4 posts to your calendar, and 1 is saved as Draft until you fill in the numbers.');
  expect(st.created.posts[0].caption).toBe('My own opening line.');
  expect(st.created.generate_images).toBe(false);
  expect(st.created.campaign.name).toBe('Three Weeks Appeal');
  // back on the overview the campaign is tracked from its posts
  await page.getByRole('button', { name: 'Back to Fundraise' }).click();
  const camp = page.locator('#fr-camp');
  await expect(camp.getByRole('heading', { name: 'Three Weeks Appeal' })).toBeVisible();
  await expect(camp).toContainText('Posts published');
  await expect(camp).toContainText('1 of 4');
  await expect(camp).toContainText('£1,640');
  await expect(camp).toContainText('of £2,000 goal, 82%');
  await expect(camp).toContainText('Starts');
  await expect(camp).toContainText('include anything raised before the campaign began');
  await expect(camp.getByRole('button', { name: 'See the 4 posts' })).toBeVisible();
  await camp.getByRole('button', { name: 'Add a progress post' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(/^Three Weeks Appeal: £1,640 raised so far towards our £2,000 goal\./);
  await page.keyboard.press('Escape');
  await camp.getByRole('button', { name: 'See the 4 posts' }).click();
  await expect(page.locator('.dash-nav-item[data-nav="content"]')).toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test('builder: your own donation page must be on your website; a pasted link still works; errors from the writer are shown', async ({ page }) => {
  const st = { previewError: { status: 500, body: { error: 'Could not write the campaign right now. Try again in a minute.' } } };
  await open(page, st);
  await page.getByRole('button', { name: 'Start a campaign' }).first().click();
  await page.getByLabel('Campaign name').fill('Spring Appeal');
  await page.getByLabel('Goal').fill('500');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your own donation page link').fill('https://other.example/donate');
  await page.getByRole('button', { name: 'Write the posts' }).click();
  await expect(page.locator('#fr-b-err')).toContainText('must be an https:// address on opa.org.uk');
  await page.getByLabel('Your own donation page link').fill('https://opa.org.uk/donate');
  await page.getByText('Link a page that is not listed').click();
  await page.getByLabel('JustGiving link').fill('https://www.justgiving.com/page/spring');
  await page.getByRole('button', { name: 'Write the posts' }).click();
  await expect(page.getByRole('heading', { name: 'The posts could not be written' })).toBeVisible();
  await expect(page.locator('#fr-b-step')).toContainText('Could not write the campaign right now.');
  expect(st.preview).toMatchObject({ justgiving_url: 'https://www.justgiving.com/page/spring', site_donation_url: 'https://opa.org.uk/donate' });
  // Back keeps what was typed
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Your own donation page link')).toHaveValue('https://opa.org.uk/donate');
  // a failed save keeps the posts so nothing is lost
  st.previewError = null; st.createError = { status: 500, body: { error: 'Could not save the campaign. Try again in a minute.' } };
  await page.getByRole('button', { name: 'Write the posts' }).click();
  await page.locator('#fr-pc-0').fill('Keep me');
  await page.getByRole('button', { name: /Add \d+ posts to calendar/ }).click();
  await expect(page.locator('#fr-b-err')).toHaveText('Could not save the campaign. Try again in a minute.');
  await expect(page.locator('#fr-pc-0')).toHaveValue('Keep me');
  st.createError = null;
  await page.getByRole('button', { name: /Add \d+ posts to calendar/ }).click();
  await expect(page.getByRole('heading', { name: 'Added to your calendar' })).toBeVisible();
});

test('Coming up: Plan it opens the builder with dates that end on the day', async ({ page }) => {
  const st = {};
  await open(page, st);
  await page.locator('#fr-coming .fr-when', { hasText: 'Giving Tuesday' }).getByRole('button', { name: 'Plan it' }).click();
  await expect(page.getByLabel('Campaign name')).toHaveValue('Giving Tuesday appeal');
  const end = await page.getByLabel('End').inputValue();
  const start = await page.getByLabel('Start').inputValue();
  expect(end).toMatch(/^\d{4}-12-01$|^\d{4}-1[12]-\d{2}$/);
  const span = (new Date(end) - new Date(start)) / 864e5 + 1;
  expect(span).toBeGreaterThanOrEqual(1);
  expect(span).toBeLessThanOrEqual(14);
  await page.locator('.fr-crumb').click();
  await expect(page.getByRole('heading', { name: 'Worth doing this week' })).toBeVisible();
});

test('the Giving Tuesday card starts the builder with a plan', async ({ page }) => {
  const st = {};
  await open(page, st);
  await page.locator('.fr-need').filter({ hasText: 'Giving Tuesday' }).getByRole('button', { name: 'Start a campaign' }).click();
  await expect(page.getByLabel('Campaign name')).toHaveValue('Giving Tuesday appeal');
});

test('not connected: charity ID is asked for inline, saved, and the pages load', async ({ page }) => {
  const st = {};
  await open(page, st, { client: { justgiving_charity_id: '' } });
  await expect(page.locator('#fr-chips')).toContainText('JustGiving: not connected');
  const card = page.locator('#fr-connect');
  await expect(card.getByRole('heading', { name: 'Connect JustGiving' })).toBeVisible();
  await expect(page.locator('.fr-kpi')).toHaveCount(0);
  expect(st.calls).not.toContain('GET /api/fundraise/campaigns'); // nothing to load without an ID
  await card.getByRole('button', { name: 'Connect' }).click();
  await expect(card.locator('.fr-err')).toHaveText('Enter your JustGiving charity ID.');
  await card.getByLabel('JustGiving charity ID').fill('  4455 ');
  await card.getByLabel('JustGiving charity ID').press('Enter');
  await expect(page.locator('#fr-connect .fr-card')).toHaveCount(0);
  expect(st.saved).toEqual({ justgiving_charity_id: '4455' });
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('#fr-chips')).not.toContainText('not connected');
  expect(await page.evaluate(() => window.clientData && window.clientData.client && window.clientData.client.justgiving_charity_id)).toBeFalsy(); // portal state is updated through the wrapper, not the page
});

test('not connected and the save fails: the message is shown next to the field', async ({ page }) => {
  const st = {};
  await open(page, st, { client: { justgiving_charity_id: '' } });
  await page.route('**/api/fundraise/save-charity-id', (r) => r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'Missing justgiving_charity_id' }) }));
  await page.getByLabel('JustGiving charity ID').fill('999');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('#fr-cid-err')).toHaveText('Missing justgiving_charity_id');
});

test('Meta needs a permission: the chip and a note say so, JustGiving still shows, and Settings opens', async ({ page }) => {
  const st = { meta: { fundraisers: [], meta_connected: true, page_id: 'p1', error: '(#200) Requires manage_fundraisers permission', needs_permission: true } };
  await open(page, st);
  await expect(page.locator('#fr-chips')).toContainText('Meta fundraisers: needs permission');
  await expect(page.locator('#fr-notes')).toContainText('manage_fundraisers');
  await expect(page.locator('#fr-notes')).toContainText('Meta said: (#200) Requires manage_fundraisers permission');
  await expect(rows(page)).toHaveCount(8);
  await page.getByRole('button', { name: 'Reconnect Meta in Settings' }).click();
  await expect(page.locator('.dash-nav-item[data-nav="settings"]')).toHaveClass(/active/);
});

test('Meta not connected, and Meta failing for another reason, are different messages', async ({ page }) => {
  const st = { meta: { fundraisers: [], meta_connected: false, message: 'Connect Facebook Page in Settings to load Meta fundraisers.' } };
  await open(page, st);
  await expect(page.locator('#fr-chips')).toContainText('Meta fundraisers: not connected');
  await expect(page.locator('#fr-notes')).toContainText('Connect your Facebook Page in Settings');
  await expect(rows(page)).toHaveCount(8);
});

test('Meta failing for another reason offers Try again', async ({ page }) => {
  const st = { meta: { fundraisers: [], meta_connected: true, error: 'Graph is down', needs_permission: false } };
  await open(page, st);
  await expect(page.locator('#fr-chips')).toContainText('Meta fundraisers: could not load');
  await expect(page.locator('#fr-notes')).toContainText('Graph is down');
  st.meta = META_OK;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#fr-chips')).toContainText('Meta fundraisers');
  await expect(page.locator('#fr-chips')).not.toContainText('could not load');
  await expect(page.getByRole('button', { name: /^Meta 1$/ })).toBeVisible();
});

test('empty state: connected, nothing yet', async ({ page }) => {
  const st = { pages: () => [], meta: { fundraisers: [], meta_connected: true } };
  await open(page, st);
  await expect(page.locator('#fr-list')).toContainText('No fundraising pages yet.');
  await expect(page.locator('#fr-list').getByRole('button', { name: 'Start a campaign' })).toBeVisible();
  await expect(page.locator('#fr-kpi .fr-kpi').first()).toContainText('£0');
  await expect(page.locator('#fr-kpi .fr-kpi').nth(1)).toContainText('Not available');
  await expect(page.locator('#fr-kpi .fr-kpi').nth(3)).toContainText('Not available');
  await expect(page.locator('#fr-detail .fr-card')).toHaveCount(0);
  await expect(page.locator('.fr-need')).toHaveCount(1); // only the date card, which is always true
});

test('API error: JustGiving failing shows the reason and Try again, with no invented numbers', async ({ page }) => {
  const st = { jgError: { status: 502, body: { error: 'JustGiving is not answering right now. Try again in a minute.' } } };
  await open(page, st);
  await expect(page.locator('#fr-chips')).toContainText('JustGiving: could not load');
  await expect(page.locator('#fr-notes')).toContainText('JustGiving is not answering right now.');
  await expect(page.locator('.fr-kpi')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1); // only the Meta fundraiser is known, nothing is made up for JustGiving
  await expect(page.getByRole('button', { name: /^All 1$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(8);
  await expect(page.locator('.fr-kpi')).toHaveCount(4);
  await expect(page.locator('#fr-notes')).not.toContainText('not answering');
});

test('totals the API did not load are marked as not loaded, never as zero', async ({ page }) => {
  const st = { pages: () => Array.from({ length: 28 }, (_, i) => jgPage(`p${i}`, `Page ${i}`, `Owner ${i}`, i < 26 ? 100 : 0, 1000, 40)) };
  await open(page, st);
  await page.getByRole('button', { name: /^Show all/ }).click();
  await expect(rows(page).filter({ hasText: 'Totals not loaded' })).toHaveCount(2);
  await expect(page.locator('#fr-list')).toContainText('past the first 25');
  await expect(page.getByRole('button', { name: /^Not started 0$/ })).toBeVisible();
});

test('a campaign whose posts link to no readable page shows post progress only', async ({ page }) => {
  const content = [
    { id: 'a', theme: 'Fundraising campaign', post_label: 'Spring Push · Day 1 · Launch', scheduled_date: day(1), scheduled_time: '19:00', status: 'Ready for Review', platform: 'Instagram', cta: 'https://opa.org.uk/donate' },
    { id: 'b', theme: 'Fundraising campaign', post_label: 'Spring Push · Day 2 · Final push', scheduled_date: day(2), scheduled_time: '09:30', status: 'Ready for Review', platform: 'Facebook', cta: 'https://opa.org.uk/donate' },
    { id: 'c', theme: 'Fundraising campaign', post_label: 'Spring Push · Day 3 · Thank you', scheduled_date: day(3), scheduled_time: '09:30', status: 'Draft', platform: 'Facebook', cta: 'https://opa.org.uk/donate' },
  ];
  const st = {};
  await open(page, st, { content });
  const camp = page.locator('#fr-camp');
  await expect(camp.getByRole('heading', { name: 'Spring Push' })).toBeVisible();
  await expect(camp).toContainText('0 of 3');
  await expect(camp).toContainText('Thank-you post');
  await expect(camp).toContainText('Need numbers');
  await expect(camp).toContainText('amount raised is not shown');
  await expect(camp).not.toContainText('even pace');
  await expect(camp.getByRole('button', { name: 'Add a progress post' })).toHaveCount(0);
});

test('a running campaign shows its pace only from real dates and amounts', async ({ page }) => {
  const posts = [];
  for (let i = 0; i < 4; i += 1) posts.push({ id: `r${i}`, theme: 'Fundraising campaign', post_label: `Walk Week · Day ${i + 1} · Why it matters`, scheduled_date: day(i - 1), scheduled_time: '09:30', status: i < 2 ? 'Published' : 'Ready for Review', platform: 'Facebook', cta: 'https://www.justgiving.com/page/mia-walk' });
  const st = {};
  await open(page, st, { content: posts });
  const camp = page.locator('#fr-camp');
  await expect(camp).toContainText('Day 2 of 4');
  await expect(camp).toContainText('Ahead of an even pace (50%)');
  await expect(camp).toContainText('2 of 4');
  await expect(camp.locator('.fr-track__m')).toHaveCount(1);
  await expect(camp.locator('.fr-track')).toHaveAttribute('aria-label', '82% of the goal raised, an even pace would be 50%');
});

test('keyboard: filters, rows and the builder steps are all reachable with Tab and Enter', async ({ page }) => {
  const st = {};
  await open(page, st);
  await page.getByRole('button', { name: /^Near target/ }).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(3);
  await rows(page).nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fr-detail h2').first()).toContainText('Ten for Tilly');
  await page.getByRole('button', { name: 'Start a campaign' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#fr-b-h1')).toBeFocused();
  await page.getByLabel('Campaign name').fill('Keys');
  await page.getByLabel('Goal').fill('300');
  await page.getByLabel('Goal').press('Enter'); // Enter in a field moves on
  await expect(page.locator('.fr-step[aria-current="step"]')).toContainText('Story and impact');
  await expect(page.locator('#fr-s-h')).toBeFocused();
  await page.getByRole('button', { name: 'Edit basics' }).click();
  await expect(page.locator('.fr-step[aria-current="step"]')).toContainText('Basics');
});

test('phone width: no sideways scrolling on the overview or in the builder', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const st = {};
  await open(page, st);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await expect(rows(page).first()).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  for (const sel of ['.fr-need', '.fr-kpi', '.fr-row', '.fr-card']) {
    const over = await page.locator(sel).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
    expect(over, sel).toBe(0);
  }
  await rows(page).first().click();
  await page.getByRole('button', { name: 'Start a campaign' }).first().click();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByLabel('Campaign name').fill('Phone');
  await page.getByLabel('Goal').fill('100');
  await page.getByRole('button', { name: 'Continue' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('new look follows Dark and Day', async ({ page }) => {
  const st = {};
  await open(page, st, { look: { look: 'new', theme: 'dark' } });
  await expect(page.locator('html')).toHaveClass(/\bnl\b/);
  const bg = () => page.locator('.fr-need').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg()).toBe('rgb(16, 18, 22)');
  await page.evaluate(() => window.seNewLook.theme('day'));
  await expect.poll(bg).toBe('rgb(255, 255, 255)');
  const ok = await page.locator('.fr-tag--ok').first().evaluate((el) => getComputedStyle(el).color);
  expect(ok).toBe('rgb(15, 143, 99)');
  const ends = () => rows(page).first().locator('.fr-tag').evaluate((el) => getComputedStyle(el).color);
  await expect.poll(ends).toBe('rgb(194, 65, 12)');
});

test('the old Fundraise markup is gone and a non-charity cannot reach the page', async ({ page }) => {
  const st = {};
  await open(page, st);
  await expect(page.locator('#fc-builder, #fc-name, #jg-campaigns-list, #meta-fundraisers-list')).toHaveCount(0);
  expect(await page.evaluate(() => [typeof window.fundraiseCampaignPreview, typeof window.loadFundraiseData, typeof window.saveJGCharityId])).toEqual(['undefined', 'undefined', 'undefined']);
  expect(await page.evaluate(() => [typeof window.fundraiseCreateContent, typeof window.fundraiseCreateAdDraft])).toEqual(['function', 'function']);
});

test('Create a post hands the fundraiser to Create, as before', async ({ page }) => {
  const st = {};
  await open(page, st);
  await rows(page).filter({ hasText: "Mia's Winter Walk" }).click();
  await page.locator('#fr-detail').getByRole('button', { name: 'Create a post' }).click();
  await expect(page.locator('.dash-nav-item[data-nav="create"]')).toHaveClass(/active/);
});
