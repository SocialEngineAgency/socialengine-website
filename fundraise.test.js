// Pure helpers of fundraise.js: status chips and their thresholds, totals, key dates, pace, the builder plan, drafts and moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./fundraise.js');

const NOW = new Date(2026, 9, 24, 12, 0); // Sat 24 Oct 2026, local noon
const day = (n) => h.addDays('2026-10-24', n);

const page = (over) => Object.assign({ key: 'jg:1', source: 'justgiving', id: '1', shortName: 'p1', title: 'Mia\'s Winter Walk', owner: 'Mia Okafor', raised: 0, withGiftAid: null, goal: 1000, currency: 'GBP', url: 'https://www.justgiving.com/page/p1', imageUrl: 'https://img.test/a.jpg', createdAt: day(-12), endsAt: day(30), lastGiftAt: null, supporters: null, numbersKnown: true, active: true }, over);

test('thresholds are written down once', () => {
  assert.equal(h.NEAR_TARGET_PCT, 80);
  assert.equal(h.ENDS_SOON_DAYS, 7);
  assert.equal(h.ENDS_SOON_BELOW_PCT, 60);
  assert.equal(h.GONE_QUIET_DAYS, 14);
  assert.equal(h.CAMPAIGN_MAX_DAYS, 14);
});

test('Near target starts at 80 percent and stops at the goal', () => {
  assert.equal(h.deriveStatus(page({ raised: 799 }), NOW).flags.nearTarget, false);
  assert.equal(h.deriveStatus(page({ raised: 800 }), NOW).flags.nearTarget, true);
  assert.equal(h.deriveStatus(page({ raised: 800 }), NOW).label, 'Near target');
  const done = h.deriveStatus(page({ raised: 1000 }), NOW);
  assert.equal(done.flags.nearTarget, false);
  assert.equal(done.flags.reached, true);
  assert.equal(done.label, 'Goal reached');
});

test('Ends soon needs 7 days or fewer left and under 60 percent', () => {
  const s = (over) => h.deriveStatus(page(over), NOW);
  assert.equal(s({ raised: 590, endsAt: day(7) }).flags.endsSoon, true);
  assert.equal(s({ raised: 590, endsAt: day(7) }).label, 'Ends soon');
  assert.equal(s({ raised: 590, endsAt: day(8) }).flags.endsSoon, false);
  assert.equal(s({ raised: 600, endsAt: day(3) }).flags.endsSoon, false);
  assert.equal(s({ raised: 100, endsAt: day(0) }).flags.endsSoon, true); // ends today
  assert.equal(s({ raised: 100, endsAt: day(-1) }).flags.endsSoon, false); // already over
  assert.equal(s({ raised: 100, endsAt: null }).flags.endsSoon, false);
  assert.equal(s({ raised: 100, endsAt: day(3), goal: 0 }).flags.endsSoon, false); // no goal, no share of it
});

test('Gone quiet is 14 days without a gift, and only when a last gift date exists', () => {
  const s = (over) => h.deriveStatus(page(over), NOW);
  assert.equal(s({ raised: 100, lastGiftAt: day(-13) }).flags.goneQuiet, false);
  assert.equal(s({ raised: 100, lastGiftAt: day(-14) }).flags.goneQuiet, true);
  assert.equal(s({ raised: 100, lastGiftAt: day(-14) }).label, 'Gone quiet');
  assert.equal(s({ raised: 100, lastGiftAt: day(-14) }).quietDays, 14);
  assert.equal(s({ raised: 100, lastGiftAt: null }).flags.goneQuiet, false);
  assert.equal(s({ raised: 1000, lastGiftAt: day(-30) }).flags.goneQuiet, false); // goal reached, nothing to restart
});

test('Not started means nothing raised, and never for totals that were not loaded', () => {
  assert.equal(h.deriveStatus(page({ raised: 0 }), NOW).label, 'Not started');
  const unknown = h.deriveStatus(page({ raised: 0, numbersKnown: false }), NOW);
  assert.equal(unknown.flags.notStarted, false);
  assert.equal(unknown.key, 'unknown');
  assert.equal(unknown.label, 'Totals not loaded');
});

test('the chip shown is the most urgent one, the filters still see every state', () => {
  const s = h.deriveStatus(page({ raised: 0, endsAt: day(3) }), NOW);
  assert.equal(s.key, 'ends-soon');
  assert.equal(s.flags.notStarted, true);
  const q = h.deriveStatus(page({ raised: 850, lastGiftAt: day(-20) }), NOW);
  assert.equal(q.key, 'near-target');
  assert.equal(q.flags.goneQuiet, true);
});

test('normalizeJustGiving: gift aid only when it is a real total, 25 pages get totals, old date format works', () => {
  const raw = Array.from({ length: 30 }, (_, i) => ({ id: String(i), short_name: `s${i}`, title: `P${i}`, status: 'Active', total_raised: i === 27 ? 40 : 0, total_raised_with_giftaid: 0, target: 100, currency: 'GBP', page_url: `https://www.justgiving.com/page/s${i}` }));
  raw[0].total_raised = 100; raw[0].total_raised_with_giftaid = 125; raw[1].total_raised = 100; raw[1].total_raised_with_giftaid = 50;
  const list = h.normalizeJustGiving(raw, NOW);
  assert.equal(list[0].withGiftAid, 125);
  assert.equal(list[1].withGiftAid, null); // lower than the amount raised, so not a Gift Aid total
  assert.equal(list[24].numbersKnown, true);
  assert.equal(list[25].numbersKnown, false); // past the 25 the server filled in, with nothing raised in the search result
  assert.equal(list[27].numbersKnown, true); // but a search result that shows money is real
  const dated = h.normalizeJustGiving([{ id: 'a', short_name: 'a', status: 'Active', expires_at: '/Date(1793000000000+0000)/', created_at: '2026-10-12T09:00:00Z' }], NOW)[0];
  assert.match(dated.endsAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(h.normalizeJustGiving([{ id: 'b', short_name: 'b', status: 'Active', expires_at: '2026-10-01T00:00:00Z' }], NOW)[0].active, false);
  assert.equal(h.normalizeJustGiving([{ id: 'c', short_name: 'c', status: 'Closed' }], NOW)[0].active, false);
  assert.equal(h.normalizeJustGiving([{ id: 'd', short_name: 'd', title: 'D', last_donation_at: '2026-10-20T10:00:00Z' }], NOW)[0].lastGiftAt, '2026-10-20');
  assert.deepEqual(h.normalizeJustGiving(null, NOW), []);
  assert.equal(h.normalizeJustGiving([{ id: 'e', page_url: 'javascript:alert(1)' }], NOW)[0].url, '');
});

test('summarize: totals, gift aid shown separately, average and median from real pages', () => {
  const list = [
    page({ key: 'a', raised: 1000, withGiftAid: 1250 }),
    page({ key: 'b', raised: 200, withGiftAid: null }),
    page({ key: 'c', raised: 600, withGiftAid: 750 }),
    page({ key: 'd', raised: 0, numbersKnown: false }),
    page({ key: 'e', raised: 50, active: false }),
    page({ key: 'f', raised: 900, currency: 'USD' }),
  ];
  const s = h.summarize(list, NOW);
  assert.equal(s.currency, 'GBP');
  assert.equal(s.listed, 6);
  assert.equal(s.active, 5);
  assert.equal(s.known, 3);
  assert.equal(s.unknown, 1);
  assert.equal(s.otherCurrency, 1);
  assert.equal(s.raised, 1800);
  assert.equal(s.giftAid, 400);
  assert.equal(s.giftAidPages, 2);
  assert.equal(s.average, 600);
  assert.equal(s.median, 600);
  assert.deepEqual(s.top, { title: page().title, raised: 1000 });
  const none = h.summarize([], NOW);
  assert.equal(none.average, null);
  assert.equal(none.top, null);
});

test('filters: counts, no Gone quiet chip without last gift dates, most urgent first', () => {
  const list = [
    page({ key: 'a', title: 'A', raised: 850 }),
    page({ key: 'b', title: 'B', raised: 100, endsAt: day(2) }),
    page({ key: 'c', title: 'C', raised: 0 }),
    page({ key: 'd', title: 'D', raised: 300 }),
    { ...page({ key: 'm', source: 'meta', title: 'M', raised: 10 }) },
  ];
  const c = h.filterCounts(list, NOW);
  assert.deepEqual(c.map((x) => x.id), ['all', 'near', 'ending', 'new', 'meta']);
  assert.deepEqual(c.map((x) => x.count), [5, 1, 1, 1, 1]);
  assert.equal(h.applyFilter(list, 'all', NOW)[0].key, 'b'); // ends soon first
  assert.equal(h.applyFilter(list, 'all', NOW)[1].key, 'a'); // then near target
  const withQuiet = h.filterCounts(list.concat(page({ key: 'q', raised: 50, lastGiftAt: day(-20) })), NOW);
  assert.ok(withQuiet.some((x) => x.id === 'quiet' && x.count === 1));
  const before = list.map((f) => f.key).join();
  h.sortFundraisers(list, NOW);
  assert.equal(list.map((f) => f.key).join(), before); // the list is not changed
});

test('whenText says what is known and nothing else', () => {
  const w = (over) => { const f = page(over); return h.whenText(f, h.deriveStatus(f, NOW), NOW); };
  assert.equal(w({ raised: 500, endsAt: day(12) }), 'Ends in 12 days');
  assert.equal(w({ raised: 500, endsAt: day(1) }), 'Ends in 1 day');
  assert.equal(w({ raised: 500, endsAt: day(0) }), 'Ends today');
  assert.equal(w({ raised: 100, lastGiftAt: day(-19), endsAt: null }), 'Last gift 19 days ago');
  assert.equal(w({ raised: 0, endsAt: null, createdAt: day(-12) }), 'Made 12 days ago');
  assert.equal(w({ raised: 0, endsAt: null, createdAt: null }), 'No gifts yet');
  assert.equal(w({ raised: 500, endsAt: null }), '');
});

test('Giving Tuesday is the Tuesday after US Thanksgiving, Advent Sunday is four Sundays before Christmas', () => {
  assert.equal(h.givingTuesday(2026), '2026-12-01');
  assert.equal(h.givingTuesday(2025), '2025-12-02');
  assert.equal(h.givingTuesday(2027), '2027-11-30');
  assert.equal(h.givingTuesday(2024), '2024-12-03');
  assert.equal(h.adventSunday(2026), '2026-11-29');
  assert.equal(h.adventSunday(2025), '2025-11-30');
  assert.equal(h.adventSunday(2022), '2022-11-27'); // Christmas on a Sunday
  assert.equal(h.adventSunday(2027), '2027-11-28');
});

test('keyDates: the next three that have not gone by, computed from today', () => {
  const k = h.keyDates(NOW);
  assert.deepEqual(k.map((x) => x.id), ['advent', 'giving-tuesday', 'christmas']);
  assert.deepEqual(k.map((x) => x.days), [36, 38, 62]);
  assert.equal(k[0].when, 'Sunday 29 November, in 36 days');
  assert.equal(k[1].when, 'Tuesday 1 December, in 38 days');
  assert.equal(k[2].when, 'Friday 25 December, in 62 days');
  const mid = h.keyDates(new Date(2026, 11, 2)); // after Giving Tuesday: it is skipped
  assert.deepEqual(mid.map((x) => x.id), ['christmas', 'advent', 'giving-tuesday']);
  assert.equal(mid[1].date, '2027-11-28');
  const onTheDay = h.keyDates(new Date(2026, 11, 1));
  assert.equal(onTheDay[0].id, 'giving-tuesday');
  assert.equal(onTheDay[0].when, 'Tuesday 1 December, today');
  assert.equal(h.keyDates(new Date(2026, 11, 24))[0].when, 'Friday 25 December, tomorrow');
});

test('planDates: a campaign that ends on the date, starting no earlier than tomorrow', () => {
  const gt = h.keyDates(NOW)[1];
  assert.deepEqual(gt.plan, { name: 'Giving Tuesday appeal', start: '2026-11-18', end: '2026-12-01' });
  const near = h.planDates({ id: 'giving-tuesday', date: '2026-12-01' }, '2026-11-25');
  assert.deepEqual(near, { start: '2026-11-26', end: '2026-12-01' });
  assert.deepEqual(h.planDates({ id: 'giving-tuesday', date: '2026-12-01' }, '2026-12-01'), { start: '2026-12-01', end: '2026-12-01' });
  assert.equal(h.planDates({ id: 'giving-tuesday', date: '2026-12-01' }, '2026-12-02'), null);
  assert.deepEqual(h.planDates({ id: 'christmas', date: '2026-12-25' }, '2026-10-24'), { start: '2026-12-11', end: '2026-12-24' });
  assert.deepEqual(h.planDates({ id: 'advent', date: '2026-11-29' }, '2026-10-24'), { start: '2026-11-29', end: '2026-12-12' });
  assert.ok(h.CAMPAIGN_MAX_DAYS >= h.diffDays('2026-11-18', '2026-12-01') + 1);
});

test('needsThisWeek builds a card only from what is true, each page in one card', () => {
  const list = [
    page({ key: 'a', title: 'Mia\'s Winter Walk', raised: 850 }),
    page({ key: 'b', title: 'Ten for Tilly', raised: 920, goal: 1000 }),
    page({ key: 'c', title: 'Marathon', raised: 100, endsAt: day(4) }),
    page({ key: 'd', title: 'Wedding', raised: 0, createdAt: day(-3) }),
    page({ key: 'e', title: 'Meta thing', source: 'meta', raised: 900 }),
    page({ key: 'f', title: 'Old', raised: 900, active: false }),
  ];
  const cards = h.needsThisWeek(list, h.keyDates(NOW), NOW);
  assert.deepEqual(cards.map((c) => c.id), ['ends-soon', 'near-target', 'not-started', 'key-date']);
  const near = cards.find((c) => c.id === 'near-target');
  assert.equal(near.chip, '2 pages');
  assert.equal(near.cta, 'Draft two thank-yous');
  assert.match(near.body, /Mia's Winter Walk and Ten for Tilly are over 80% of the way/);
  assert.deepEqual(near.keys, ['a', 'b']);
  assert.equal(cards.find((c) => c.id === 'ends-soon').cta, 'Make a share post');
  const key = cards.find((c) => c.id === 'key-date');
  assert.equal(key.title, 'Giving Tuesday is 1 December');
  assert.equal(key.chip, '38 days');
  assert.match(key.body, /start it by 18 November/);
  assert.equal(h.needsThisWeek([], [], NOW).length, 0);
  // no last gift date anywhere means there is never a Gone quiet card
  assert.ok(!cards.some((c) => c.id === 'gone-quiet'));
  const quiet = h.needsThisWeek([page({ raised: 50, lastGiftAt: day(-15) })], [], NOW);
  assert.equal(quiet[0].id, 'gone-quiet');
});

test('paceFor: an even pace is the share of the days gone, the claim needs a goal and the real dates', () => {
  const p = h.paceFor({ start: '2026-10-20', end: '2026-11-09', today: '2026-10-28', raised: 1420, goal: 2000 });
  assert.equal(p.dayNo, 9); assert.equal(p.total, 21); assert.equal(p.expected, 43); assert.equal(p.pct, 71);
  assert.equal(p.state, 'ahead'); assert.equal(p.label, 'Ahead of an even pace (43%)');
  assert.equal(h.paceFor({ start: '2026-10-20', end: '2026-11-09', today: '2026-10-28', raised: 860, goal: 2000 }).state, 'level');
  assert.equal(h.paceFor({ start: '2026-10-20', end: '2026-11-09', today: '2026-10-28', raised: 400, goal: 2000 }).label, 'Behind an even pace (43%)');
  assert.equal(h.paceFor({ start: '2026-10-20', end: '2026-11-09', today: '2026-10-28', raised: 400, goal: 0 }).label, '');
  assert.equal(h.paceFor({ start: '2026-10-20', end: '2026-11-09', today: '2026-10-28', raised: 400, goal: 0 }).state, 'unknown');
  const up = h.paceFor({ start: '2026-10-30', end: '2026-11-05', today: '2026-10-28', raised: 0, goal: 100 });
  assert.equal(up.state, 'upcoming'); assert.equal(up.daysToStart, 2);
  const over = h.paceFor({ start: '2026-10-01', end: '2026-10-07', today: '2026-10-10', raised: 100, goal: 100 });
  assert.equal(over.over, true); assert.equal(over.expected, 100);
});

test('campaignsFromPosts finds the campaign from its posts and counts them honestly', () => {
  const post = (n, phase, date, time, status, over) => Object.assign({ id: `r${n}`, theme: 'Fundraising campaign', post_label: `Three Weeks Appeal · Day ${n} · ${phase}`, scheduled_date: date, scheduled_time: time, status, platform: 'Instagram', cta: 'https://www.justgiving.com/page/opa-three-weeks' }, over);
  const rows = [
    post(1, 'Launch', '2026-10-22', '19:00', 'Published'),
    post(2, 'Why it matters', '2026-10-25', '09:30', 'Ready for Review', { platform: 'Facebook' }),
    post(3, 'Final push', '2026-10-27', '19:00', 'Draft', { post_label: 'FILL NUMBERS · Three Weeks Appeal · Day 3 · Final push' }),
    post(4, 'Thank you', '2026-10-28', '09:30', 'Ready for Review'),
    { id: 'x', theme: 'Evergreen', post_label: 'Other · Day 1 · Launch', scheduled_date: '2026-10-25' },
    post(9, 'Launch', '2026-10-25', '09:30', 'Archived', { post_label: 'Old · Day 1 · Launch' }),
    { fields: post(5, 'Why it matters', '2026-10-26', '09:30', 'Ready for Review') },
  ];
  const list = h.campaignsFromPosts(rows, NOW, '12:00');
  assert.equal(list.length, 1);
  const c = list[0];
  assert.equal(c.name, 'Three Weeks Appeal');
  assert.equal(c.start, '2026-10-22'); assert.equal(c.end, '2026-10-27'); assert.equal(c.thanksOn, '2026-10-28');
  assert.equal(c.total, 5); assert.equal(c.published, 1); assert.equal(c.draft, 1);
  assert.deepEqual(c.next, { date: '2026-10-25', time: '09:30', platform: 'Facebook' });
  assert.deepEqual(c.links, ['https://www.justgiving.com/page/opa-three-weeks']);
  assert.equal(h.campaignsFromPosts(rows, new Date(2026, 10, 2), '12:00').length, 0); // finished
  assert.deepEqual(h.campaignsFromPosts(null, NOW), []);
  // the page the posts link to supplies the numbers
  const jg = page({ url: 'https://www.justgiving.com/page/opa-three-weeks/', raised: 1420, goal: 2000 });
  assert.equal(h.linkCampaign(c, [jg]).raised, 1420);
  assert.equal(h.linkCampaign(c, [page({ url: 'https://www.justgiving.com/page/other' })]), null);
});

test('campaignArc matches the campaign writer, timelinePlan counts the posts it will write', () => {
  assert.deepEqual(h.campaignArc(1), ['launch']);
  assert.deepEqual(h.campaignArc(2), ['launch', 'final']);
  assert.deepEqual(h.campaignArc(5), ['launch', 'why', 'impact', 'momentum', 'final']);
  assert.deepEqual(h.campaignArc(8), ['launch', 'why', 'impact', 'momentum', 'share', 'why', 'impact', 'final']);
  assert.equal(h.campaignArc(0).length, 0);
  const plan = h.timelinePlan({ start: '2026-10-25', end: '2026-11-07', perDay: '2', thanks: true });
  assert.equal(plan.runDays, 14); assert.equal(plan.dayCount, 15); assert.equal(plan.posts, 29);
  assert.equal(plan.days[14].phase, 'thanks'); assert.equal(plan.days[14].date, '2026-11-08');
  assert.equal(plan.legend[0].name, 'Launch'); assert.equal(plan.legend[0].when, 'Day 1'); assert.equal(plan.legend[0].posts, 2);
  assert.equal(plan.legend.reduce((s, l) => s + l.posts, 0), 29);
  assert.equal(h.timelinePlan({ start: '2026-10-25', end: '2026-11-07', perDay: 1, thanks: false }).posts, 14);
  assert.equal(h.timelinePlan({ start: '2026-10-25', end: '2026-11-09', perDay: 2, thanks: true }), null); // over 14 days
  assert.equal(h.timelinePlan({ start: '2026-10-25', end: '2026-10-20', perDay: 2, thanks: true }), null);
  assert.equal(h.timelinePlan({ start: '', end: '', perDay: 2 }), null);
  assert.equal(h.formatDayList([1, 2]), 'Days 1 to 2');
  assert.equal(h.formatDayList([22]), 'Day 22');
  assert.equal(h.formatDayList([2, 6]), 'Days 2 and 6');
  assert.equal(h.formatDayList([2, 3, 6, 7, 10]), 'Days 2 to 3, 6 to 7 and 10');
});

test('builder checks: basics, story, gift lines and the payload', () => {
  const base = { name: 'Winter', goal: '2000', currency: 'GBP', start: '2026-10-25', end: '2026-11-01', perDay: '2' };
  assert.equal(h.basicsError(base, '2026-10-24'), null);
  assert.equal(h.basicsError({ ...base, name: ' ' }, '2026-10-24'), 'Give the campaign a name.');
  assert.equal(h.basicsError({ ...base, goal: '0' }, '2026-10-24'), 'Set a fundraising goal above zero.');
  assert.equal(h.basicsError({ ...base, start: '' }, '2026-10-24'), 'Pick a start and end date.');
  assert.equal(h.basicsError({ ...base, end: '2026-10-20' }, '2026-10-24'), 'The end date must be on or after the start date.');
  assert.equal(h.basicsError({ ...base, end: '2026-11-08' }, '2026-10-24'), 'Campaigns can run for up to 14 days.');
  assert.equal(h.basicsError({ ...base, start: '2026-10-23' }, '2026-10-24'), 'The start date has already passed. Pick a start date from today onward.');
  const story = { justgivingUrl: 'https://www.justgiving.com/page/x', metaUrl: '', siteUrl: '', story: 'A story.', gifts: [], currency: 'GBP', facebook: true, instagram: false };
  assert.equal(h.storyError(story, {}), null);
  assert.match(h.storyError({ ...story, justgivingUrl: '' }, {}), /at least one place/);
  assert.match(h.storyError({ ...story, justgivingUrl: 'https://evil.example/justgiving.com' }, {}), /justgiving\.com/);
  assert.match(h.storyError({ ...story, metaUrl: 'http://www.facebook.com/donate/1' }, {}), /facebook\.com/);
  assert.match(h.storyError({ ...story, siteUrl: 'https://opa.org.uk/donate' }, {}), /Add your website in Settings/);
  assert.equal(h.storyError({ ...story, siteUrl: 'https://opa.org.uk/donate' }, { website: 'https://www.opa.org.uk' }), null);
  assert.match(h.storyError({ ...story, siteUrl: 'https://other.org/donate' }, { website: 'opa.org.uk' }), /on opa\.org\.uk/);
  assert.match(h.storyError({ ...story, facebook: false }, {}), /at least one platform/);
  assert.match(h.storyError({ ...story, gifts: [{ amount: '£10', what: '' }] }, {}), /Say what the £10 gift does/);
  assert.deepEqual(h.impactLines([{ amount: '10', what: 'funds one call' }, { amount: '£25', what: 'funds a shift' }, { amount: '', what: '' }], 'GBP'), { error: null, lines: ['£10 funds one call', '£25 funds a shift'] });
  const body = h.campaignPayload({ ...base, ...story, perDay: '2', thanks: true, gifts: [{ amount: '10', what: 'funds one call' }] });
  assert.deepEqual(body.platforms, ['facebook']);
  assert.deepEqual(body.impact_points, ['£10 funds one call']);
  assert.equal(body.justgiving_url, 'https://www.justgiving.com/page/x');
  assert.equal(body.start_date, '2026-10-25'); assert.equal(body.include_thank_you, true);
});

test('drafts use only real facts, read as plain British English and never use dashes as punctuation', () => {
  const f = page({ raised: 1640, goal: 2000, endsAt: day(12), withGiftAid: 1982 });
  const thanks = h.thankYouDraft(f, 'OPA Cancer Charity', NOW);
  assert.match(thanks, /^Hi Mia,/);
  assert.match(thanks, /"Mia's Winter Walk" has raised £1,640 so far, which is 82% of the £2,000 goal\./);
  assert.match(thanks, /You are £360 away\./);
  assert.match(thanks, /There are 12 days left\./);
  assert.match(thanks, /OPA Cancer Charity$/);
  const nudge = h.nudgeDraft(page({ raised: 0 }), 'OPA Cancer Charity', NOW);
  assert.match(nudge, /has not had its first gift yet/);
  assert.match(nudge, /Your page: https:\/\/www\.justgiving\.com\/page\/p1/);
  const quiet = h.nudgeDraft(page({ raised: 380, lastGiftAt: day(-19) }), 'OPA', NOW);
  assert.match(quiet, /last gift came in on 5 Oct, 19 days ago/);
  const share = h.shareDraft(page({ raised: 920, goal: 1000, endsAt: day(9) }), 'OPA', NOW);
  assert.match(share, /£920 raised so far towards £1,000, with 9 days to go\./);
  assert.match(h.shareDraft(page({ raised: 0, endsAt: null }), 'OPA', NOW), /Be the first to give\./);
  assert.match(h.photoDraft(page({ owner: 'Rob and Sam Hale' }), 'OPA'), /^Hi Rob and Sam,/);
  assert.match(h.thankYouDraft(page({ owner: '' }), 'OPA', NOW), /^Hi there,/);
  const camp = { name: 'Three Weeks Appeal', end: day(13) };
  assert.match(h.progressDraft(camp, page({ raised: 1420, goal: 2000 }), 'OPA', NOW), /^Three Weeks Appeal: £1,420 raised so far towards our £2,000 goal\./);
  for (const text of [thanks, nudge, quiet, share, h.photoDraft(f, 'OPA'), h.progressDraft(camp, f, 'OPA', NOW)]) {
    assert.ok(!/—|–| -- /.test(text), 'no dashes used as punctuation');
    assert.ok(!/tend to|more likely|guarantee|\d+x\b|% more/i.test(text), 'no promised results');
  }
});

test('movesFor: each move shows the facts it rests on', () => {
  const f = page({ raised: 1640, goal: 2000, endsAt: day(12) });
  const m = h.movesFor(f, NOW, []);
  assert.deepEqual(m.map((x) => x.id), ['thank', 'share']);
  assert.equal(m[0].title, 'Thank Mia');
  assert.equal(m[0].basis, '82% of target, ends in 12 days');
  assert.match(m[0].body, /£360 to go for the £2,000 goal, with 12 days left\./);
  assert.equal(m[1].basis, 'no post in your calendar links to this page');
  const linked = h.movesFor(f, NOW, [{ cta: 'https://www.justgiving.com/page/p1', status: 'Ready for Review' }, { caption: 'see justgiving.com/page/p1', status: 'Archived' }]);
  assert.equal(linked[1].basis, '1 post in your calendar links to this page');
  assert.equal(h.movesFor(f, NOW, null)[1].basis, 'the page is live and its link is public');
  const nophoto = h.movesFor(page({ raised: 0, imageUrl: '' }), NOW, []);
  assert.deepEqual(nophoto.map((x) => x.id), ['nudge', 'share', 'photo']);
  assert.equal(nophoto[2].basis, 'JustGiving sent no picture for this page');
  assert.match(nophoto[0].basis, /^£0 raised, made 12 days ago/);
  const ending = h.movesFor(page({ raised: 100, endsAt: day(4) }), NOW, []);
  assert.equal(ending.find((x) => x.id === 'share').title, 'Share before it ends');
  assert.equal(h.movesFor(page({ raised: 0, numbersKnown: false }), NOW, []).length, 0);
  const quietMoves = h.movesFor(page({ raised: 380, lastGiftAt: day(-19) }), NOW, []);
  assert.equal(quietMoves[0].id, 'nudge');
  assert.equal(h.linkedPostCount(f, undefined), null);
});

test('small formatters', () => {
  assert.equal(h.formatMoney(1640, 'GBP'), '£1,640');
  assert.equal(h.formatMoney(25.5, 'GBP'), '£25.50');
  assert.equal(h.formatMoney(1640.4, 'GBP'), '£1,640');
  assert.equal(h.formatMoney(0, 'GBP'), '£0');
  assert.match(h.formatMoney(10, 'USD'), /US\$10|\$10/);
  assert.equal(h.formatMoney(5, 'zz'), '£5');
  assert.equal(h.listNames(['A']), 'A');
  assert.equal(h.listNames(['A', 'B']), 'A and B');
  assert.equal(h.listNames(['A', 'B', 'C']), 'A, B and C');
  assert.equal(h.listNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more');
  assert.equal(h.formatClock('18:00'), '6:00 pm');
  assert.equal(h.formatClock('00:30'), '12:30 am');
  assert.equal(h.formatClock('bad'), '');
  assert.equal(h.formatDate('2026-10-20'), 'Tue 20 Oct');
  assert.equal(h.formatDate('2026-11-29', { long: true }), 'Sunday 29 November');
  assert.equal(h.formatDate('2026-11-29', { long: true, weekday: false }), '29 November');
  assert.equal(h.firstNames('Mia Okafor'), 'Mia');
  assert.equal(h.firstNames('Madonna'), 'Madonna');
  assert.equal(h.firstNames('Tom & Ayo Reed'), 'Tom & Ayo');
  assert.equal(h.firstNames(''), '');
  assert.equal(h.safeUrl('javascript:alert(1)'), '');
  assert.equal(h.safeUrl('https://x.test/a b'), 'https://x.test/a%20b');
  assert.equal(h.urlKey('https://WWW.JustGiving.com/page/Abc/?x=1'), 'justgiving.com/page/abc');
  assert.equal(h.initials("Mia's Winter Walk"), 'MW');
  assert.equal(h.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('the module copy has no em dashes', () => {
  const src = fs.readFileSync(require.resolve('./fundraise.js'), 'utf8');
  assert.ok(!src.includes('—'), 'no em dash in fundraise.js');
});
