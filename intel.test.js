// Pure helpers of intel.js: summary text, rhythm layout, finding groups, links, cooldown, actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./intel.js');

test('standingSummary uses only the numbers it is given', () => {
  assert.equal(h.standingSummary({ lead: 2, behind: 3, even: 1, unknown: 2 }), 'You are ahead on 2, behind on 3, level on 1. 2 could not be found.');
  assert.equal(h.standingSummary({ lead: 0, behind: 3, even: 0, unknown: 0 }), 'You are behind on 3.');
  assert.equal(h.standingSummary({ lead: 1, behind: 0, even: 0, unknown: 1 }), 'You are ahead on 1. 1 could not be found.');
  assert.equal(h.standingSummary({ lead: 0, behind: 0, even: 0, unknown: 4 }), 'Nothing to compare yet. 4 could not be found.');
  assert.equal(h.standingSummary({ lead: 0, behind: 0, even: 0, unknown: 0 }), '');
  assert.equal(h.standingSummary(null), '');
  assert.equal(h.standingSummary({ lead: 'x', behind: -2, even: 1.9, unknown: undefined }), 'You are level on 1.');
});

test('rhythmLayout: 4 rows of 7, first column is the weekday of the first day, dates end today', () => {
  const series = Array.from({ length: 28 }, (_, i) => i % 3); // 0,1,2,...
  const today = new Date(2026, 9, 23, 15, 0); // Fri 23 Oct 2026
  const lay = h.rhythmLayout(series, today);
  assert.equal(lay.rows.length, 4);
  assert.ok(lay.rows.every((r) => r.length === 7));
  assert.equal(lay.cells[27].date, '2026-10-23');
  assert.equal(lay.cells[0].date, '2026-09-26'); // 27 days earlier, a Saturday
  assert.equal(lay.firstDow, 6);
  assert.deepEqual(lay.weekdays, [6, 0, 1, 2, 3, 4, 5]);
  // every column is one weekday
  for (const row of lay.rows) assert.deepEqual(row.map((c) => c.dow), lay.weekdays);
  assert.equal(lay.hidden, false);
  assert.equal(lay.knownFrom, 0);
  assert.equal(lay.visibleDays, 28);
  assert.equal(lay.activeDays, series.filter((v) => v > 0).length);
});

test('rhythmLayout: null days are kept as null and shorten what we can see', () => {
  const series = Array(28).fill(1);
  for (let i = 0; i < 10; i += 1) series[i] = null;
  const lay = h.rhythmLayout(series, new Date(2026, 9, 23));
  assert.equal(lay.cells.filter((c) => c.value === null).length, 10);
  assert.equal(lay.knownFrom, 10);
  assert.equal(lay.visibleDays, 18);
  assert.equal(lay.activeDays, 18);
});

test('rhythmLayout: nothing visible, short or odd input', () => {
  assert.equal(h.rhythmLayout(Array(28).fill(null), new Date()).hidden, true);
  assert.equal(h.rhythmLayout(Array(28).fill(null), new Date()).knownFrom, null);
  const short = h.rhythmLayout([1, 2], new Date(2026, 9, 23));
  assert.equal(short.cells.length, 28);
  assert.equal(short.cells[0].value, 1);
  assert.equal(short.cells[2].value, null);
  const odd = h.rhythmLayout(['a', 7, -1, 0], new Date(2026, 9, 23));
  assert.deepEqual(odd.cells.slice(0, 4).map((c) => c.value), [null, null, null, 0]);
  assert.equal(h.rhythmLayout(undefined, undefined).cells.length, 28);
});

test('rhythmLayout: dates stay right across a clock change', () => {
  const lay = h.rhythmLayout(Array(28).fill(0), new Date(2026, 10, 3)); // spans the end of US daylight time
  const days = lay.cells.map((c) => c.date);
  assert.equal(new Set(days).size, 28);
  assert.equal(days[0], '2026-10-07');
});

test('cellTitle words', () => {
  const c = { date: '2026-10-23', value: null };
  assert.match(h.cellTitle(c, 'en-GB'), /Not visible to us/);
  assert.match(h.cellTitle({ ...c, value: 0 }, 'en-GB'), /No posts/);
  assert.match(h.cellTitle({ ...c, value: 1 }, 'en-GB'), /1 post$/);
  assert.match(h.cellTitle({ ...c, value: 2 }, 'en-GB'), /2 or more posts/);
});

test('groupFindings: All, then only the groups that are present, named for the kind of business', () => {
  const f = (kind) => ({ id: kind, kind });
  assert.deepEqual(h.groupFindings([], 'charity'), []);
  const tabs = h.groupFindings([f('new_page'), f('collection'), f('giving_page'), f('social'), f('homepage'), f('whatever')], 'charity');
  assert.deepEqual(tabs.map((t) => [t.id, t.label, t.count]), [['all', 'All', 6], ['pages', 'Pages', 2], ['give', 'Giving page', 1], ['social', 'Social', 1], ['site', 'Website', 1]]);
  assert.equal(h.groupFindings([f('price')], 'store')[1].label, 'Prices');
  assert.equal(h.groupFindings([f('price')], 'brand')[1].label, 'Giving or prices');
  assert.deepEqual(h.groupFindings([f('followers')], 'store').map((t) => t.id), ['all', 'social']);
});

test('filterFindings keeps unknown kinds in All only', () => {
  const list = [{ kind: 'new_page' }, { kind: 'price' }, { kind: 'mystery' }];
  assert.equal(h.filterFindings(list, 'all').length, 3);
  assert.equal(h.filterFindings(list, 'pages').length, 1);
  assert.equal(h.filterFindings(list, 'give').length, 1);
  assert.equal(h.filterFindings(list, 'social').length, 0);
  assert.deepEqual(h.filterFindings(null, 'all'), []);
});

test('safeUrl only lets http and https through', () => {
  assert.equal(h.safeUrl('https://example.org/a?b=1'), 'https://example.org/a?b=1');
  assert.equal(h.safeUrl('http://example.org'), 'http://example.org/');
  assert.equal(h.safeUrl('javascript:alert(1)'), '');
  assert.equal(h.safeUrl('data:text/html,hi'), '');
  assert.equal(h.safeUrl('//evil.example'), '');
  assert.equal(h.safeUrl(' JAVASCRIPT:x'), '');
  assert.equal(h.safeUrl(null), '');
  assert.equal(h.safeUrl('https://'), '');
});

test('esc escapes markup and quotes', () => {
  assert.equal(h.esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(h.esc(null), '');
});

test('cooldown: only waits after a good check, never after a failed one', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  assert.equal(h.cooldownMs({ status: 'ok', next_check_allowed_at: '2026-10-23T14:00:00Z' }, now), 2 * 3600e3);
  assert.equal(h.cooldownMs({ status: 'ok', next_check_allowed_at: '2026-10-23T11:00:00Z' }, now), 0);
  assert.equal(h.cooldownMs({ status: 'ok', next_check_allowed_at: null }, now), 0);
  assert.equal(h.cooldownMs({ status: 'ok', next_check_allowed_at: 'nonsense' }, now), 0);
  assert.equal(h.cooldownMs({ status: 'failed', next_check_allowed_at: '2026-10-23T14:00:00Z' }, now), 0);
});

test('availableLabel: time only today, date and time on another day', () => {
  const opts = { locale: 'en-GB', timeZone: 'UTC' };
  const now = new Date('2026-10-23T09:00:00Z');
  assert.equal(h.availableLabel('2026-10-23T21:30:00Z', now, opts), '21:30');
  assert.match(h.availableLabel('2026-10-24T01:30:00Z', now, opts), /24 Oct.*0?1:30/);
  assert.equal(h.availableLabel('bad', now, opts), '');
});

test('dates use the given locale and zone', () => {
  assert.equal(h.formatDay('2026-10-21T10:00:00Z', { locale: 'en-GB', timeZone: 'UTC' }), '21 Oct');
  assert.equal(h.formatDay('2026-10-21T10:00:00Z', { locale: 'en-US', timeZone: 'UTC' }), 'Oct 21');
  assert.equal(h.formatDay(null), '');
});

test('chipFor and initials', () => {
  assert.deepEqual(h.chipFor({ status: 'checking' }), { text: 'Checking', tone: 'sig' });
  assert.deepEqual(h.chipFor({ status: 'failed' }), { text: 'Check failed', tone: 'warn' });
  assert.deepEqual(h.chipFor({ status: 'ok', finding_count: 0 }), { text: 'No changes', tone: 'neu' });
  assert.equal(h.chipFor({ status: 'ok', finding_count: 1 }).text, '1 change');
  assert.equal(h.chipFor({ status: 'ok', finding_count: 4 }).text, '4 changes');
  assert.equal(h.initials('Hope Ribbon Trust'), 'HR');
  assert.equal(h.initials('northwind'), 'NO');
  assert.equal(h.initials(''), '?');
});

test('actionPlan: create hands the brief over, calendar and campaign just open, anything else does nothing', () => {
  assert.deepEqual(h.actionPlan({ label: 'Make it', target: 'create', brief: 'A brief' }), { target: 'create', nav: 'design-studio', session: { destination: 'design', mode: 'image', aspect_ratio: '4:5', prompt: 'A brief' } });
  assert.equal(h.actionPlan({ target: 'calendar' }).nav, 'schedule');
  assert.equal(h.actionPlan({ target: 'campaign' }).nav, 'fundraise');
  assert.equal(h.actionPlan({ target: null, label: 'x' }), null);
  assert.equal(h.actionPlan({ target: 'elsewhere' }), null);
  assert.equal(h.actionPlan(null), null);
});

test('isDismiss: a secondary with no target, or called Dismiss, hides the move', () => {
  assert.equal(h.isDismiss({ label: 'Dismiss' }), true);
  assert.equal(h.isDismiss({ label: 'Add to Calendar', target: 'calendar' }), false);
  assert.equal(h.isDismiss(null), false);
});
