/* Fundraise: what your supporters have raised, who is raising it, and who to thank or nudge next.
 *
 * One page for JustGiving pages and Meta fundraisers, with a three step campaign builder.
 * Everything on the page is worked out from real fields. Where a field is missing the page says
 * so, it never fills the gap. Nothing is sent or posted for the user: thank-yous, nudges and share
 * posts are drafts that are copied and sent by the user.
 *
 * portal.html keeps a thin wrapper and calls:
 *   window.renderFundraisePage(contentEl, { api, apiFetch, toast, switchNav, clientName, website, brandHashtags,
 *     hasJustGiving, getPosts, postsOmitted, refreshPosts, onCharityIdSaved, createContent, createAdDraft, todayKey })
 *
 * API (all through apiFetch):
 *   GET  /api/fundraise/campaigns          JustGiving pages: total_raised, total_raised_with_giftaid, target, expires_at, image_url ...
 *   GET  /api/fundraise/meta               Meta fundraisers: amount_raised, goal, donation_count, ends_at ...
 *   POST /api/fundraise/save-charity-id    { justgiving_charity_id }
 *   POST /api/fundraise/campaign/preview   the campaign form -> { campaign, posts, empty }
 *   POST /api/fundraise/campaign/create    { campaign, posts, generate_images } -> { created, needs_numbers }
 *
 * The pure helpers are exported for node tests (fundraise.test.js).
 */
(function (global) {
  'use strict';

  /* ───────────────────────── thresholds ───────────────────────── */

  const NEAR_TARGET_PCT = 80;        // Near target: raised is at least this share of the goal (and under 100)
  const GOAL_REACHED_PCT = 100;      // Goal reached
  const ENDS_SOON_DAYS = 7;          // Ends soon: this many days left or fewer ...
  const ENDS_SOON_BELOW_PCT = 60;    // ... and still under this share of the goal
  const GONE_QUIET_DAYS = 14;        // Gone quiet: no gift for this many days or more (needs a last gift date)
  const ENRICHED_PAGES = 25;         // the API fetches full totals for the first 25 pages only
  const PACE_BAND_PCT = 5;           // within this many points of an even pace counts as level
  const CAMPAIGN_MAX_DAYS = 14;      // the campaign writer's limit
  const MAX_POSTS_PER_DAY = 3;
  const STORY_MAX = 1500;
  const IMPACT_MAX = 6;
  const ROWS_SHOWN = 8;
  const DRAFTS_SHOWN = 10;
  const CAMPAIGN_THEME = 'fundraising campaign';

  /* ───────────────────────── pure helpers ───────────────────────── */

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Only http(s) links are ever put in an href. Returns '' for anything else. */
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!/^https?:\/\//i.test(s)) return '';
    try { return new URL(s).href; } catch (_) { return ''; }
  }

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /** A real Date from a Date, a number, an ISO string or the old "/Date(123)/" form. Otherwise null. */
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
    const s = String(v).trim();
    const m = s.match(/^\/Date\((-?\d+)/);
    const d = m ? new Date(Number(m[1])) : new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const isoOfDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  /** Day number of a YYYY-MM-DD string (days since 1970, no time zones involved). */
  function dayNum(iso) {
    if (!ISO_RE.test(String(iso || ''))) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }
  const isoFromDayNum = (n) => { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
  const addDays = (iso, n) => { const x = dayNum(iso); return x == null ? null : isoFromDayNum(x + n); };
  /** Whole days from a to b (b minus a). */
  const diffDays = (a, b) => { const x = dayNum(a); const y = dayNum(b); return x == null || y == null ? null : y - x; };
  /** Today as YYYY-MM-DD in the viewer's own time zone. */
  const todayIso = (now) => isoOfDate(toDate(now) || new Date());
  /** The calendar day of a timestamp (or a plain date) as YYYY-MM-DD, or null. */
  function isoOfStamp(v) {
    if (typeof v === 'string' && ISO_RE.test(v.trim())) return dayNum(v.trim()) == null ? null : v.trim();
    const d = toDate(v);
    return d ? isoOfDate(d) : null;
  }

  /** "Tue 20 Oct" (default) or, with long, "Tuesday 20 October". */
  function formatDate(iso, opts) {
    const n = dayNum(iso);
    if (n == null) return '';
    const o = opts || {};
    const d = new Date(n * 86400000);
    const wd = WEEKDAYS[d.getUTCDay()];
    const mo = MONTHS[d.getUTCMonth()];
    const day = d.getUTCDate();
    const parts = [];
    if (o.weekday !== false) parts.push(o.long ? wd : wd.slice(0, 3));
    parts.push(String(day));
    parts.push(o.long ? mo : mo.slice(0, 3));
    if (o.year) parts.push(String(d.getUTCFullYear()));
    return parts.join(' ');
  }

  /** "18:00" -> "6:00 pm" */
  function formatClock(hhmm) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = Number(m[1]);
    if (h > 23) return '';
    return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
  }

  /** £1,640 for whole amounts, £25.50 for small amounts with pence. */
  function formatMoney(amount, currency) {
    const n = num(amount);
    const cur = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'GBP';
    const digits = !Number.isInteger(n) && Math.abs(n) < 100 ? 2 : 0;
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
    } catch (_) { return `${cur} ${Math.round(n)}`; }
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const numberWord = (n) => (n >= 0 && n <= 10 ? NUMBER_WORDS[n] : String(n));

  /** "A", "A and B", "A, B and C", "A, B, C and 2 more" */
  function listNames(names, max) {
    const list = (names || []).map((s) => String(s || '').trim()).filter(Boolean);
    const m = max || 3;
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    if (list.length <= m) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    const rest = list.length - m;
    return `${list.slice(0, m).join(', ')} and ${rest} more`;
  }

  /** "3 days", "1 day", "today" */
  const daysPhrase = (n) => (n === 0 ? 'today' : plural(n, 'day'));

  function initials(text) {
    const words = String(text || '').replace(/['\u2019]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function hashIndex(s, n) {
    let h = 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % n;
  }

  /** First name(s) for a greeting. "Mia Okafor" -> "Mia", "Rob and Sam Hale" -> "Rob and Sam", "" -> "". */
  function firstNames(owner) {
    const s = String(owner || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const words = s.split(' ');
    if (words.length === 1) return words[0];
    if (/(\band\b|&)/i.test(s)) return words.slice(0, -1).join(' ');
    return words[0];
  }

  /** host + path of a link without www, query or trailing slash, for matching a post to a page. */
  function urlKey(u) {
    const s = safeUrl(u);
    if (!s) return '';
    try {
      const x = new URL(s);
      return `${x.hostname.replace(/^www\./i, '').toLowerCase()}${x.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch (_) { return ''; }
  }

  /* ── fundraisers ── */

  /**
   * One shape for a JustGiving page and a Meta fundraiser.
   * numbersKnown is false when the API did not fetch full totals for the page (beyond the first 25 with a short
   * name) and the search result shows nothing raised, so "0" would be a guess.
   */
  function normalizeJustGiving(list, now) {
    const t = toDate(now) || new Date();
    let enriched = 0;
    return (Array.isArray(list) ? list : []).filter((c) => c && typeof c === 'object').map((c, i) => {
      const hasName = !!String(c.short_name || '').trim();
      const inEnriched = hasName && enriched < ENRICHED_PAGES;
      if (hasName) enriched += 1;
      const raised = num(c.total_raised);
      const withGiftAid = num(c.total_raised_with_giftaid);
      const endsIso = isoOfStamp(c.expires_at);
      const status = String(c.status || 'Active').trim().toLowerCase();
      const expired = endsIso != null && diffDays(isoOfDate(t), endsIso) < 0;
      const lastGift = c.last_donation_at || c.last_gift_at || c.last_donation_date || null;
      const supporters = c.donation_count != null ? num(c.donation_count) : (c.supporter_count != null ? num(c.supporter_count) : null);
      return {
        key: `jg:${c.id || c.short_name || i}`,
        source: 'justgiving',
        id: String(c.id || c.short_name || i),
        shortName: String(c.short_name || ''),
        title: String(c.title || 'Fundraising page'),
        owner: String(c.owner_name || ''),
        raised,
        withGiftAid: withGiftAid > 0 && withGiftAid >= raised ? withGiftAid : null,
        goal: num(c.target),
        currency: String(c.currency || 'GBP').toUpperCase(),
        url: safeUrl(c.page_url),
        imageUrl: safeUrl(c.image_url),
        createdAt: isoOfStamp(c.created_at),
        endsAt: endsIso,
        lastGiftAt: isoOfStamp(lastGift),
        supporters,
        numbersKnown: inEnriched || raised > 0,
        active: (status === 'active' || status === '') && !expired,
      };
    });
  }

  function normalizeMeta(list) {
    return (Array.isArray(list) ? list : []).filter((c) => c && typeof c === 'object').map((c, i) => ({
      key: `meta:${c.id || i}`,
      source: 'meta',
      id: String(c.id || i),
      shortName: '',
      title: String(c.title || 'Fundraiser'),
      owner: '',
      raised: num(c.amount_raised),
      withGiftAid: null,
      goal: num(c.goal),
      currency: String(c.currency || 'USD').toUpperCase(),
      url: safeUrl(c.url),
      imageUrl: '',
      createdAt: null,
      endsAt: isoOfStamp(c.ends_at),
      lastGiftAt: null,
      supporters: c.donation_count != null ? num(c.donation_count) : null,
      numbersKnown: true,
      active: true,
    }));
  }

  /** Percent of the goal, rounded, not capped. null when there is no goal. */
  function percentOf(raised, goal) {
    const g = num(goal);
    if (g <= 0) return null;
    return Math.round((num(raised) / g) * 100);
  }

  /**
   * Where a fundraiser stands. flags: every state that applies (used by the filter chips).
   * key / label / tone: the one chip shown on the row, most urgent first.
   *   Ends soon: 7 days left or fewer and under 60% of the goal
   *   Near target: 80% of the goal or more (and under 100%)
   *   Goal reached: 100% or more
   *   Gone quiet: no gift for 14 days or more, only when a last gift date is known
   *   Not started: nothing raised (only when the totals are known)
   */
  function deriveStatus(f, now) {
    const today = todayIso(now);
    const known = f.numbersKnown !== false;
    const pct = known ? percentOf(f.raised, f.goal) : null;
    // the thresholds use the exact share, so 799 of 1,000 is not "80%"
    const exact = known && num(f.goal) > 0 ? (num(f.raised) / num(f.goal)) * 100 : null;
    const left = f.endsAt ? diffDays(today, f.endsAt) : null;
    const quietDays = f.lastGiftAt ? diffDays(f.lastGiftAt, today) : null;
    const reached = exact != null && exact >= GOAL_REACHED_PCT;
    const flags = {
      endsSoon: known && left != null && left >= 0 && left <= ENDS_SOON_DAYS && exact != null && exact < ENDS_SOON_BELOW_PCT,
      nearTarget: exact != null && exact >= NEAR_TARGET_PCT && exact < GOAL_REACHED_PCT,
      reached,
      goneQuiet: known && quietDays != null && quietDays >= GONE_QUIET_DAYS && !reached,
      notStarted: known && num(f.raised) <= 0,
    };
    let key = 'none'; let label = 'Active'; let tone = 'mute';
    if (!known) { key = 'unknown'; label = 'Totals not loaded'; }
    else if (flags.endsSoon) { key = 'ends-soon'; label = 'Ends soon'; tone = 'bad'; }
    else if (flags.nearTarget) { key = 'near-target'; label = 'Near target'; tone = 'ok'; }
    else if (flags.goneQuiet) { key = 'gone-quiet'; label = 'Gone quiet'; tone = 'warn'; }
    else if (flags.notStarted) { key = 'not-started'; label = 'Not started'; }
    else if (flags.reached) { key = 'reached'; label = 'Goal reached'; tone = 'ok'; }
    return { key, label, tone, flags, pct, daysLeft: left, quietDays };
  }

  const RANK = { 'ends-soon': 0, 'near-target': 1, reached: 2, 'gone-quiet': 3, 'not-started': 4, none: 5, unknown: 6 };

  /** Most urgent first, then the most raised. Does not change the list it is given. */
  function sortFundraisers(list, now) {
    return (list || []).map((f) => ({ f, s: deriveStatus(f, now) }))
      .sort((a, b) => (RANK[a.s.key] - RANK[b.s.key]) || (num(b.f.raised) - num(a.f.raised)) || String(a.f.title).localeCompare(String(b.f.title)))
      .map((x) => x.f);
  }

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'near', label: 'Near target' },
    { id: 'ending', label: 'Ending soon' },
    { id: 'quiet', label: 'Gone quiet' },
    { id: 'new', label: 'Not started' },
    { id: 'meta', label: 'Meta' },
  ];

  function matchesFilter(f, s, id) {
    if (id === 'all') return true;
    if (id === 'near') return s.flags.nearTarget || s.flags.reached;
    if (id === 'ending') return s.flags.endsSoon;
    if (id === 'quiet') return s.flags.goneQuiet;
    if (id === 'new') return s.flags.notStarted;
    if (id === 'meta') return f.source === 'meta';
    return true;
  }

  /** Filter chips with counts. "Gone quiet" is left out when no page has a last gift date, since it could never be true. */
  function filterCounts(list, now) {
    const items = (list || []).map((f) => ({ f, s: deriveStatus(f, now) }));
    const lastGiftKnown = items.some((x) => x.f.lastGiftAt);
    return FILTERS.filter((x) => x.id !== 'quiet' || lastGiftKnown).map((x) => ({
      id: x.id, label: x.label, count: items.filter((i) => matchesFilter(i.f, i.s, x.id)).length,
    }));
  }

  function applyFilter(list, id, now) {
    return sortFundraisers(list, now).filter((f) => matchesFilter(f, deriveStatus(f, now), id));
  }

  /** "Ends in 12 days" / "Last gift 19 days ago" / "Made 12 days ago" / "No gifts yet" */
  function whenText(f, s, now) {
    const today = todayIso(now);
    if (s.key === 'unknown') return 'Totals not loaded';
    if (s.flags.goneQuiet && s.quietDays != null) return `Last gift ${s.quietDays === 0 ? 'today' : `${plural(s.quietDays, 'day')} ago`}`;
    if (s.daysLeft != null && s.daysLeft >= 0) return s.daysLeft === 0 ? 'Ends today' : `Ends in ${plural(s.daysLeft, 'day')}`;
    if (s.flags.notStarted && f.createdAt) {
      const made = diffDays(f.createdAt, today);
      if (made != null && made >= 0) return made === 0 ? 'Made today' : `Made ${plural(made, 'day')} ago`;
    }
    if (s.flags.notStarted) return 'No gifts yet';
    return '';
  }

  /* ── totals ── */

  /** The four numbers at the top. JustGiving pages only; Meta amounts can be in another currency. */
  function summarize(list, now) {
    const jg = (list || []).filter((f) => f.source === 'justgiving');
    const active = jg.filter((f) => f.active);
    const known = active.filter((f) => f.numbersKnown !== false);
    const counts = {};
    known.forEach((f) => { counts[f.currency] = (counts[f.currency] || 0) + 1; });
    const currency = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'GBP';
    const used = known.filter((f) => f.currency === currency);
    const raised = used.reduce((s, f) => s + f.raised, 0);
    const withGift = used.filter((f) => f.withGiftAid != null);
    const giftAid = withGift.reduce((s, f) => s + (f.withGiftAid - f.raised), 0);
    const sorted = used.map((f) => f.raised).sort((a, b) => a - b);
    const mid = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    const top = used.slice().sort((a, b) => b.raised - a.raised)[0] || null;
    const statuses = used.map((f) => deriveStatus(f, now));
    return {
      currency,
      listed: jg.length,
      active: active.length,
      known: used.length,
      unknown: active.length - known.length,
      otherCurrency: known.length - used.length,
      raised,
      giftAid,
      giftAidPages: withGift.length,
      withGiftAidTotal: withGift.reduce((s, f) => s + f.withGiftAid, 0),
      average: used.length ? raised / used.length : null,
      median: used.length ? mid : null,
      top: top && top.raised > 0 ? { title: top.title, raised: top.raised } : null,
      nearTarget: statuses.filter((s) => s.flags.nearTarget || s.flags.reached).length,
      endingSoon: statuses.filter((s) => s.flags.endsSoon).length,
      goneQuiet: statuses.filter((s) => s.flags.goneQuiet).length,
      notStarted: statuses.filter((s) => s.flags.notStarted).length,
    };
  }

  /* ── key dates ── */

  /** Thanksgiving: the fourth Thursday of November. Giving Tuesday is the Tuesday after. */
  function givingTuesday(year) {
    const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    const firstThu = 1 + ((4 - nov1 + 7) % 7);
    const thanksgiving = firstThu + 21;
    return isoFromDayNum(Math.round(Date.UTC(year, 10, thanksgiving) / 86400000) + 5);
  }

  /** Advent Sunday: three weeks before the Sunday that comes before Christmas Day. */
  function adventSunday(year) {
    const xmas = Math.round(Date.UTC(year, 11, 25) / 86400000);
    const dow = new Date(xmas * 86400000).getUTCDay();
    const lastSunday = xmas - (dow === 0 ? 7 : dow);
    return isoFromDayNum(lastSunday - 21);
  }

  const christmasDay = (year) => `${year}-12-25`;

  /** The window a campaign for this date can use, clamped so it starts from tomorrow (or today when it must). */
  function planDates(moment, today) {
    if (!moment || dayNum(moment.date) == null || dayNum(today) == null) return null;
    let want;
    if (moment.id === 'advent') want = { start: moment.date, end: addDays(moment.date, CAMPAIGN_MAX_DAYS - 1) };
    else if (moment.id === 'christmas') { const end = addDays(moment.date, -1); want = { start: addDays(end, -(CAMPAIGN_MAX_DAYS - 1)), end }; }
    else want = { start: addDays(moment.date, -(CAMPAIGN_MAX_DAYS - 1)), end: moment.date };
    const tomorrow = addDays(today, 1);
    let start = diffDays(want.start, tomorrow) > 0 ? tomorrow : want.start;
    if (diffDays(start, want.end) < 0) start = diffDays(want.start, today) > 0 ? today : want.start;
    if (diffDays(start, want.end) < 0) return null;
    return { start, end: want.end };
  }

  const MOMENTS = [
    { id: 'advent', name: 'Advent begins', plan: 'Advent appeal', campaign: false, date: adventSunday },
    { id: 'giving-tuesday', name: 'Giving Tuesday', plan: 'Giving Tuesday appeal', campaign: true, date: givingTuesday },
    { id: 'christmas', name: 'Christmas Day', plan: 'Christmas appeal', campaign: true, date: christmasDay },
  ];

  /** The next three of Advent Sunday, Giving Tuesday and Christmas Day that have not gone by. Today counts. */
  function keyDates(now) {
    const today = todayIso(now);
    const year = Number(today.slice(0, 4));
    const all = [];
    [year, year + 1].forEach((y) => MOMENTS.forEach((m) => all.push({ id: m.id, name: m.name, planName: m.plan, campaign: m.campaign, date: m.date(y) })));
    return all
      .map((m) => ({ ...m, days: diffDays(today, m.date) }))
      .filter((m) => m.days >= 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 3)
      .map((m) => {
        const when = m.days === 0 ? 'today' : m.days === 1 ? 'tomorrow' : `in ${m.days} days`;
        const plan = planDates(m, today);
        return { ...m, when: `${formatDate(m.date, { long: true })}, ${when}`, plan: plan ? { name: m.planName, start: plan.start, end: plan.end } : null };
      });
  }

  /* ── what needs doing ── */

  function pageWord(n) { return n === 1 ? 'page' : 'pages'; }

  /**
   * The cards under "Worth doing this week". Each page is in at most one card (its most urgent state).
   * A card is only made when it has something real to say.
   */
  function needsThisWeek(list, moments, now) {
    const today = todayIso(now);
    const jg = (list || []).filter((f) => f.source === 'justgiving' && f.active);
    const rows = jg.map((f) => ({ f, s: deriveStatus(f, now) }));
    const by = (...keys) => rows.filter((r) => keys.includes(r.s.key)).map((r) => r.f);
    const cards = [];
    const ends = by('ends-soon');
    if (ends.length) {
      const n = ends.length;
      cards.push({
        id: 'ends-soon', kind: 'share', tone: 'bad', chip: `${n} ${pageWord(n)}`, title: 'End this week', keys: ends.map((f) => f.key),
        body: `${listNames(ends.map((f) => f.title))} ${n === 1 ? 'ends' : 'end'} within ${ENDS_SOON_DAYS} days and ${n === 1 ? 'is' : 'are'} under ${ENDS_SOON_BELOW_PCT}% of target. Sharing ${n === 1 ? 'it' : 'them'} on Instagram and Facebook is the quickest help.`,
        cta: n === 1 ? 'Make a share post' : 'Make share posts',
      });
    }
    const near = by('near-target', 'reached');
    if (near.length) {
      const n = near.length;
      cards.push({
        id: 'near-target', kind: 'thank', tone: 'ok', chip: `${n} ${pageWord(n)}`, title: 'Close to their target', keys: near.map((f) => f.key),
        body: `${listNames(near.map((f) => f.title))} ${n === 1 ? 'is' : 'are'} over ${NEAR_TARGET_PCT}% of the way. A thank-you or a share now can help ${n === 1 ? 'it' : 'them'} finish.`,
        cta: n === 1 ? 'Draft a thank-you' : `Draft ${numberWord(n)} thank-yous`,
      });
    }
    const fresh = by('not-started');
    if (fresh.length) {
      const n = fresh.length;
      cards.push({
        id: 'not-started', kind: 'nudge', tone: 'mute', chip: `${n} ${pageWord(n)}`, title: 'No gifts yet', keys: fresh.map((f) => f.key),
        body: `${listNames(fresh.map((f) => f.title))} ${n === 1 ? 'has' : 'have'} not raised anything yet. A short nudge with a photo idea can help ${n === 1 ? 'it' : 'them'} start.`,
        cta: n === 1 ? 'Draft a nudge' : 'Draft nudges',
      });
    }
    const quiet = by('gone-quiet');
    if (quiet.length) {
      const n = quiet.length;
      cards.push({
        id: 'gone-quiet', kind: 'nudge', tone: 'warn', chip: `${n} ${pageWord(n)}`, title: 'Gone quiet', keys: quiet.map((f) => f.key),
        body: `No new gift for ${GONE_QUIET_DAYS} days or more on ${listNames(quiet.map((f) => f.title))}. A short nudge with a photo idea can restart ${n === 1 ? 'it' : 'them'}.`,
        cta: n === 1 ? 'Draft a nudge' : 'Draft nudges',
      });
    }
    const moment = (moments || []).find((m) => m.campaign && m.days >= 1 && m.plan);
    if (moment) {
      const startBy = addDays(moment.date, -(CAMPAIGN_MAX_DAYS - 1));
      const roomy = diffDays(today, startBy) > 0;
      cards.push({
        id: 'key-date', kind: 'plan', tone: 'sig', chip: plural(moment.days, 'day'), title: `${moment.name} is ${formatDate(moment.date, { long: true, weekday: false })}`, moment,
        body: roomy
          ? `A campaign can run for up to ${CAMPAIGN_MAX_DAYS} days. To use all of them, start it by ${formatDate(startBy, { long: true, weekday: false })}. We can write it with you.`
          : `There are ${plural(moment.days, 'day')} to go. A campaign can still run until then if you start now. We can write it with you.`,
        cta: 'Start a campaign',
      });
    }
    return cards;
  }

  /* ── campaigns the user created (read from their calendar) ── */

  const PUBLISHED = ['posted', 'published', 'live'];
  const stripFields = (r) => (r && r.fields && typeof r.fields === 'object' ? Object.assign({ id: r.id }, r.fields) : r) || {};
  const LABEL_RE = /^(?:FILL NUMBERS · )?(.+?) · Day (\d+) · (.+)$/;

  /**
   * Campaigns made with the builder, found from their posts: theme "Fundraising campaign" and a label
   * "Name · Day 3 · Phase". Returns campaigns that are running or still to start, soonest first.
   * Goal and raised are not stored with the posts, so they come from a page the posts link to (see linkCampaign).
   */
  function campaignsFromPosts(rows, now, nowClock) {
    const today = todayIso(now);
    const clock = nowClock || (() => { const d = toDate(now) || new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; })();
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).map(stripFields).forEach((p) => {
      if (String(p.theme || '').trim().toLowerCase() !== CAMPAIGN_THEME) return;
      if (/^archived$/i.test(String(p.status || ''))) return;
      const m = String(p.post_label || '').match(LABEL_RE);
      const date = isoOfStamp(p.scheduled_date);
      if (!m || !date) return;
      const name = m[1].trim();
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ p, date, time: String(p.scheduled_time || ''), phase: m[3].trim(), day: Number(m[2]) });
    });
    const out = [];
    groups.forEach((items, name) => {
      const body = items.filter((x) => x.phase.toLowerCase() !== 'thank you');
      const thanks = items.find((x) => x.phase.toLowerCase() === 'thank you');
      const dates = (body.length ? body : items).map((x) => x.date).sort();
      const start = dates[0];
      const end = dates[dates.length - 1];
      const last = thanks ? thanks.date : end;
      if (diffDays(today, last) < 0) return; // finished
      const isPub = (x) => PUBLISHED.includes(String(x.p.status || '').toLowerCase());
      const upcoming = items.filter((x) => !isPub(x) && (x.date > today || (x.date === today && x.time >= clock)))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null;
      const links = Array.from(new Set(items.map((x) => safeUrl(x.p.cta)).filter(Boolean)));
      out.push({
        name, start, end, thanksOn: thanks ? thanks.date : null,
        total: items.length,
        published: items.filter(isPub).length,
        draft: items.filter((x) => /^draft$/i.test(String(x.p.status || ''))).length,
        next: upcoming ? { date: upcoming.date, time: upcoming.time, platform: String(upcoming.p.platform || '') } : null,
        links,
      });
    });
    return out.sort((a, b) => {
      const ar = diffDays(a.start, today) >= 0 ? 0 : 1; const br = diffDays(b.start, today) >= 0 ? 0 : 1;
      return (ar - br) || a.start.localeCompare(b.start);
    });
  }

  /** The page one of the campaign's posts links to, if any: JustGiving first, then Meta. */
  function linkCampaign(camp, fundraisers) {
    const keys = (camp.links || []).map(urlKey).filter(Boolean);
    const list = (fundraisers || []).filter((f) => f.url);
    const hit = (src) => list.find((f) => f.source === src && keys.includes(urlKey(f.url)));
    return hit('justgiving') || hit('meta') || null;
  }

  /**
   * An even pace is the same share of the goal every day of the campaign. It is only a rule of thumb, and the page's
   * total also counts anything raised before the campaign began, so the page says that next to it.
   */
  function paceFor({ start, end, today, raised, goal }) {
    const total = diffDays(start, end) + 1;
    const since = diffDays(start, today);
    if (!(total > 0) || since == null) return null;
    if (since < 0) return { state: 'upcoming', daysToStart: -since, total };
    const dayNo = Math.min(total, since + 1);
    const expected = Math.round((dayNo / total) * 100);
    const pct = percentOf(raised, goal);
    let state = 'unknown';
    if (pct != null) state = pct >= expected + PACE_BAND_PCT ? 'ahead' : pct <= expected - PACE_BAND_PCT ? 'behind' : 'level';
    const label = state === 'unknown' ? '' : `${state === 'ahead' ? 'Ahead of' : state === 'behind' ? 'Behind' : 'On'} an even pace (${expected}%)`;
    return { state, dayNo, total, expected, pct, label, over: since + 1 > total };
  }

  /* ── the campaign builder ── */

  /** Which phase each day has. Mirrors the campaign writer on the server so the preview matches what is written. */
  function campaignArc(n) {
    if (n <= 0) return [];
    if (n === 1) return ['launch'];
    if (n === 2) return ['launch', 'final'];
    if (n === 3) return ['launch', 'impact', 'final'];
    if (n === 4) return ['launch', 'why', 'momentum', 'final'];
    if (n === 5) return ['launch', 'why', 'impact', 'momentum', 'final'];
    const middle = ['why', 'impact', 'momentum', 'share'];
    const arc = ['launch'];
    for (let i = 0; i < n - 2; i += 1) arc.push(middle[i % middle.length]);
    arc.push('final');
    return arc;
  }

  const PHASE_LABEL = { launch: 'Launch', why: 'Why it matters', impact: 'What your gift does', momentum: 'Momentum', share: 'Share the ask', final: 'Final push', thanks: 'Thank you' };
  const PHASE_ORDER = ['launch', 'why', 'impact', 'momentum', 'share', 'final', 'thanks'];

  /** "Day 1", "Days 1 to 2", "Days 2 and 6", "Days 2, 6 and 10" */
  function formatDayList(days) {
    const list = Array.from(new Set(days)).sort((a, b) => a - b);
    if (!list.length) return '';
    const runs = [];
    let from = list[0]; let prev = list[0];
    for (let i = 1; i <= list.length; i += 1) {
      if (list[i] === prev + 1) { prev = list[i]; continue; }
      runs.push(from === prev ? String(from) : `${from} to ${prev}`);
      from = list[i]; prev = list[i];
    }
    const text = runs.length === 1 ? runs[0] : `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}`;
    return `${list.length === 1 && runs[0] === String(list[0]) ? 'Day' : 'Days'} ${text}`;
  }

  /** The day by day plan for the preview: one cell per day, a legend per phase, and the post count. */
  function timelinePlan({ start, end, perDay, thanks }) {
    const span = diffDays(start, end);
    if (span == null) return null;
    const n = span + 1;
    if (!(n > 0) || n > CAMPAIGN_MAX_DAYS) return null;
    const per = Math.min(MAX_POSTS_PER_DAY, Math.max(1, Math.round(num(perDay)) || 2));
    const arc = campaignArc(n);
    const days = arc.map((phase, i) => ({ day: i + 1, date: addDays(start, i), phase, posts: per }));
    if (thanks) days.push({ day: n + 1, date: addDays(end, 1), phase: 'thanks', posts: 1 });
    const legend = PHASE_ORDER.map((phase) => {
      const mine = days.filter((d) => d.phase === phase);
      return mine.length ? { phase, name: PHASE_LABEL[phase], when: formatDayList(mine.map((d) => d.day)), posts: mine.reduce((s, d) => s + d.posts, 0), index: PHASE_ORDER.indexOf(phase) } : null;
    }).filter(Boolean);
    return { days, legend, dayCount: days.length, runDays: n, posts: days.reduce((s, d) => s + d.posts, 0) };
  }

  const SLOT_TIMES = { facebook: '09:30', instagram: '19:00' };

  function siteHost(website) {
    const raw = String(website || '').trim();
    if (!raw) return '';
    try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
  }

  function hostAllowed(u, hosts) {
    try {
      const x = new URL(u);
      if (x.protocol !== 'https:') return false;
      const h = x.hostname.toLowerCase();
      return hosts.some((d) => h === d || h.endsWith(`.${d}`));
    } catch (_) { return false; }
  }

  /** The gift lines the writer may use: "£10 funds one evening call". Rows with nothing in them are ignored. */
  function impactLines(rows, currency) {
    const out = [];
    for (const r of (rows || [])) {
      const amount = String(r && r.amount != null ? r.amount : '').trim();
      const what = String(r && r.what != null ? r.what : '').trim();
      if (!amount && !what) continue;
      if (!amount || !what) return { error: amount ? `Say what the ${amount} gift does, or clear that row.` : 'Add the amount for the gift that funds this, or clear that row.', lines: [] };
      const money = /^\d+(\.\d{1,2})?$/.test(amount) ? formatMoney(Number(amount), currency) : amount;
      out.push(`${money} ${what}`.slice(0, 200));
    }
    if (out.length > IMPACT_MAX) return { error: `Keep it to ${IMPACT_MAX} gift lines.`, lines: [] };
    return { error: null, lines: out };
  }

  /** Checks the first step. Same rules the campaign writer applies. null when it is fine. */
  function basicsError(f, today) {
    if (!String(f.name || '').trim()) return 'Give the campaign a name.';
    const goal = Number(f.goal);
    if (!Number.isFinite(goal) || goal <= 0) return 'Set a fundraising goal above zero.';
    if (goal > 10000000) return 'That goal looks too large. Check the amount.';
    if (!f.start || !f.end || dayNum(f.start) == null || dayNum(f.end) == null) return 'Pick a start and end date.';
    if (diffDays(f.start, f.end) < 0) return 'The end date must be on or after the start date.';
    if (diffDays(f.start, f.end) + 1 > CAMPAIGN_MAX_DAYS) return `Campaigns can run for up to ${CAMPAIGN_MAX_DAYS} days.`;
    if (diffDays(today, f.start) < 0) return 'The start date has already passed. Pick a start date from today onward.';
    return null;
  }

  /** Checks the second step: where people give, the story, the gift lines and the platforms. null when it is fine. */
  function storyError(f, ctx) {
    const jg = String(f.justgivingUrl || '').trim();
    const fb = String(f.metaUrl || '').trim();
    const own = String(f.siteUrl || '').trim();
    if (!jg && !fb && !own) return 'Add at least one place people can give: a JustGiving page, your own donation page or a Facebook fundraiser.';
    if (jg && !hostAllowed(jg, ['justgiving.com'])) return 'The JustGiving link must be an https://www.justgiving.com/... address.';
    if (fb && !hostAllowed(fb, ['facebook.com', 'fb.com', 'fb.me'])) return 'The Facebook fundraiser link must be an https://www.facebook.com/... address.';
    if (own) {
      try { if (new URL(own).protocol !== 'https:') throw new Error('x'); } catch (_) { return 'Your donation page link must start with https://'; }
      const host = siteHost(ctx && ctx.website);
      if (!host) return 'Add your website in Settings before using your own donation page link.';
      if (!hostAllowed(own, [host])) return `Your donation page link must be an https:// address on ${host}.`;
    }
    if (String(f.story || '').length > STORY_MAX) return `Keep the story to ${STORY_MAX} characters.`;
    const gifts = impactLines(f.gifts, f.currency);
    if (gifts.error) return gifts.error;
    if (!(f.facebook || f.instagram)) return 'Pick at least one platform.';
    return null;
  }

  /** The body for /api/fundraise/campaign/preview. */
  function campaignPayload(f) {
    const platforms = [];
    if (f.facebook) platforms.push('facebook');
    if (f.instagram) platforms.push('instagram');
    return {
      name: String(f.name || '').trim(), goal: f.goal, currency: f.currency || 'GBP',
      start_date: f.start, end_date: f.end, posts_per_day: f.perDay,
      justgiving_url: String(f.justgivingUrl || '').trim(), meta_fundraiser_url: String(f.metaUrl || '').trim(), site_donation_url: String(f.siteUrl || '').trim(),
      story: f.story || '', impact_points: impactLines(f.gifts, f.currency).lines,
      platforms, include_thank_you: !!f.thanks,
    };
  }

  /* ── drafts (text for the user to read, change and send themselves) ── */

  const lines = (...parts) => parts.filter((p) => p !== null && p !== undefined && p !== false).join('\n');

  function leftPhrase(s) {
    if (s.daysLeft == null || s.daysLeft < 0) return '';
    return s.daysLeft === 0 ? 'It ends today.' : `There ${s.daysLeft === 1 ? 'is' : 'are'} ${plural(s.daysLeft, 'day')} left.`;
  }

  /** A thank-you to the person raising money. Facts only: the amount so far, the goal and the days left. */
  function thankYouDraft(f, charity, now) {
    const s = deriveStatus(f, now);
    const who = firstNames(f.owner);
    const goalPart = f.goal > 0 ? `, which is ${s.pct}% of the ${formatMoney(f.goal, f.currency)} goal` : '';
    const togo = f.goal > 0 && f.raised < f.goal ? ` You are ${formatMoney(f.goal - f.raised, f.currency)} away.` : '';
    return lines(
      `Hi ${who || 'there'},`, '',
      `Thank you so much for fundraising for ${charity}. "${f.title}" has raised ${formatMoney(f.raised, f.currency)} so far${goalPart}.${togo}${leftPhrase(s) ? ' ' + leftPhrase(s) : ''}`, '',
      'If it would help, we would be glad to share your page on our Instagram and Facebook. A photo and a line or two about why you are fundraising would make that easy for us.', '',
      'Thank you again. Every gift makes a difference.', '',
      'Warm wishes,', charity,
    );
  }

  /** A short nudge for a page with no gifts yet, or none for a while. Only says what is known. */
  function nudgeDraft(f, charity, now) {
    const s = deriveStatus(f, now);
    const who = firstNames(f.owner);
    const state = s.flags.goneQuiet && f.raised > 0
      ? `Your page has raised ${formatMoney(f.raised, f.currency)} so far. The last gift came in on ${formatDate(f.lastGiftAt, { weekday: false })}, ${plural(s.quietDays, 'day')} ago, so a little push from you could help it along.`
      : 'It has not had its first gift yet, so a little push from you could make a real difference.';
    return lines(
      `Hi ${who || 'there'},`, '',
      `Thank you for setting up "${f.title}" for ${charity}. ${state}`, '',
      'A few ideas:',
      '- Add a photo and a few lines about why you are fundraising.',
      '- Send the link to a handful of people you know and ask them to give or share.',
      '- Post it once on your own social media with a sentence about what it means to you.',
      f.url ? '' : null, f.url ? `Your page: ${f.url}` : null, '',
      'If there is anything we can do to help, just reply to this message.', '',
      'Warm wishes,', charity,
    );
  }

  /** A post for the charity's own accounts that points to the page. */
  function shareDraft(f, charity, now) {
    const s = deriveStatus(f, now);
    const who = String(f.owner || '').trim();
    const raisedLine = f.raised > 0
      ? `${formatMoney(f.raised, f.currency)} raised so far${f.goal > 0 ? ` towards ${formatMoney(f.goal, f.currency)}` : ''}${s.daysLeft != null && s.daysLeft >= 0 ? `, with ${daysPhrase(s.daysLeft)} to go` : ''}.`
      : `${s.daysLeft != null && s.daysLeft >= 0 ? `${daysPhrase(s.daysLeft)} to go. ` : ''}Be the first to give.`;
    return lines(
      `${who || 'A supporter'} is fundraising for ${charity} with "${f.title}".`, '',
      raisedLine, '',
      f.url ? `If you can, please give or share their page: ${f.url}` : 'If you can, please give or share their page.', '',
      'Thank you for your support!',
    );
  }

  /** Asks the person raising money for a photo and a short update. */
  function photoDraft(f, charity) {
    const who = firstNames(f.owner);
    return lines(
      `Hi ${who || 'there'},`, '',
      `Thank you for fundraising for ${charity}. Would you be able to add a photo and a short update to "${f.title}"?`, '',
      'A picture of you, or of what you are doing, helps people see who they are supporting. A couple of lines about why you are doing it is just as good.', '',
      f.url ? `Your page: ${f.url}` : null, f.url ? '' : null,
      'Thank you!', '',
      'Warm wishes,', charity,
    );
  }

  /** A progress post for a campaign, from the page it links to. */
  function progressDraft(camp, page, charity, now) {
    const today = todayIso(now);
    const left = diffDays(today, camp.end);
    return lines(
      `${camp.name}: ${formatMoney(page.raised, page.currency)} raised so far${page.goal > 0 ? ` towards our ${formatMoney(page.goal, page.currency)} goal` : ''}.`, '',
      `Thank you to everyone who has given or shared for ${charity}.${left != null && left >= 0 ? ` There ${left === 1 ? 'is' : 'are'} ${plural(left, 'day')} left to join in.` : ''}`, '',
      page.url ? `Give here: ${page.url}` : null,
    );
  }

  /* ── what to do next on one fundraiser ── */

  /** How many posts in the calendar link to this page. null when the calendar posts are not available. */
  function linkedPostCount(f, rows) {
    if (!Array.isArray(rows)) return null;
    const key = urlKey(f.url);
    const short = String(f.shortName || '').toLowerCase();
    if (!key && !short) return null;
    return rows.map(stripFields).filter((p) => !/^archived$/i.test(String(p.status || ''))).filter((p) => {
      const hay = `${p.cta || ''} ${p.caption || ''} ${p.first_comment || ''}`.toLowerCase();
      return (key && hay.includes(key)) || (short && hay.includes(`/${short}`));
    }).length;
  }

  function basisText(f, s) {
    const bits = [];
    if (s.pct != null) bits.push(`${s.pct}% of target`);
    else if (f.raised > 0) bits.push(`${formatMoney(f.raised, f.currency)} raised, no goal set`);
    if (s.daysLeft != null) bits.push(s.daysLeft >= 0 ? `ends in ${plural(s.daysLeft, 'day')}` : 'end date has passed');
    if (s.quietDays != null) bits.push(`last gift ${s.quietDays === 0 ? 'today' : `${plural(s.quietDays, 'day')} ago`}`);
    return bits.join(', ');
  }

  /**
   * Up to three moves. Each has a one line basis made from the page's own facts.
   * Nothing here says what a move will achieve.
   */
  function movesFor(f, now, postRows) {
    const s = deriveStatus(f, now);
    const who = firstNames(f.owner);
    const moves = [];
    if (s.key === 'unknown') return moves;
    if (f.raised > 0 && !s.flags.goneQuiet) {
      const togo = f.goal > 0 && f.raised < f.goal ? `${formatMoney(f.goal - f.raised, f.currency)} to go for the ${formatMoney(f.goal, f.currency)} goal${s.daysLeft != null && s.daysLeft >= 0 ? `, with ${plural(s.daysLeft, 'day')} left` : ''}.` : (s.flags.reached ? 'The goal has been reached.' : `${formatMoney(f.raised, f.currency)} raised so far.`);
      moves.push({ id: 'thank', draft: 'thank', title: who ? `Thank ${who}` : 'Say thank you', body: `${togo} A short thank-you lets them know it has been noticed.`, basis: basisText(f, s), cta: 'Draft a thank-you', primary: true });
    } else if (s.flags.goneQuiet || s.flags.notStarted) {
      const quiet = s.flags.goneQuiet;
      const made = f.createdAt ? diffDays(f.createdAt, todayIso(now)) : null;
      moves.push({
        id: 'nudge', draft: 'nudge', title: quiet ? 'Send a nudge' : 'Nudge towards a first gift',
        body: quiet ? `No new gift for ${plural(s.quietDays, 'day')}. A short message with a photo idea can help it start again.` : 'Nothing has been raised yet. A short message with a photo idea can help it start.',
        basis: quiet ? basisText(f, s) : `${formatMoney(0, f.currency)} raised${made != null && made >= 0 ? `, made ${made === 0 ? 'today' : `${plural(made, 'day')} ago`}` : ''}${s.daysLeft != null && s.daysLeft >= 0 ? `, ends in ${plural(s.daysLeft, 'day')}` : ''}`,
        cta: 'Draft a nudge', primary: true,
      });
    }
    const linked = linkedPostCount(f, postRows);
    moves.push({
      id: 'share', draft: 'share', title: s.flags.endsSoon ? 'Share before it ends' : 'Share this page',
      body: s.flags.endsSoon
        ? `It ends in ${plural(s.daysLeft, 'day')} and is at ${s.pct}% of target. A post from your accounts can reach people who have not seen it.`
        : (linked === 0 ? 'Your calendar has no post that links to this page. We can write one.' : linked > 0 ? `${plural(linked, 'post')} in your calendar link${linked === 1 ? 's' : ''} to this page. Another share can keep it in view.` : 'We can write a post that links to this page.'),
      basis: linked == null ? (s.flags.endsSoon ? basisText(f, s) : 'the page is live and its link is public') : (linked === 0 ? 'no post in your calendar links to this page' : `${plural(linked, 'post')} in your calendar link${linked === 1 ? 's' : ''} to this page`),
      cta: 'Write the post', primary: moves.length === 0,
    });
    if (f.source === 'justgiving' && !f.imageUrl) {
      moves.push({ id: 'photo', draft: 'photo', title: 'Ask for a photo and an update', body: 'JustGiving sent no picture for this page. A photo helps supporters see who they are supporting.', basis: 'JustGiving sent no picture for this page', cta: 'Draft the ask', primary: false });
    }
    return moves.slice(0, 3);
  }

  const DRAFT_BUILDERS = { thank: thankYouDraft, nudge: nudgeDraft, share: shareDraft, photo: photoDraft };
  const DRAFT_TITLES = { thank: 'Thank-you draft', nudge: 'Nudge draft', share: 'Share post draft', photo: 'Photo and update draft', progress: 'Progress post draft' };

  const helpers = {
    NEAR_TARGET_PCT, GOAL_REACHED_PCT, ENDS_SOON_DAYS, ENDS_SOON_BELOW_PCT, GONE_QUIET_DAYS, ENRICHED_PAGES, PACE_BAND_PCT, CAMPAIGN_MAX_DAYS, STORY_MAX,
    esc, safeUrl, toDate, dayNum, addDays, diffDays, todayIso, isoOfStamp, formatDate, formatClock, formatMoney, plural, numberWord, listNames, initials, firstNames, urlKey,
    normalizeJustGiving, normalizeMeta, percentOf, deriveStatus, sortFundraisers, filterCounts, applyFilter, whenText, summarize,
    givingTuesday, adventSunday, planDates, keyDates, needsThisWeek,
    campaignsFromPosts, linkCampaign, paceFor,
    campaignArc, formatDayList, timelinePlan, impactLines, basicsError, storyError, campaignPayload, siteHost,
    thankYouDraft, nudgeDraft, shareDraft, photoDraft, progressDraft, linkedPostCount, movesFor,
  };

  /* ───────────────────────── styles ───────────────────────── */

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('fundraise-styles')) return;
    const st = document.createElement('style');
    st.id = 'fundraise-styles';
    // Colours come from --fr-* tokens. The old look gets its own dark values; the new look maps them to the
    // --nl-* tokens (so Day and Dark follow). Tints use color-mix so the look mapper leaves them alone.
    st.textContent = `
.fr { --fr-bg:#0b1020; --fr-surface:#111827; --fr-s2:#0f1a2e; --fr-s3:#162237; --fr-s4:#1e2a44; --fr-line:rgba(255,255,255,.07); --fr-line2:rgba(255,255,255,.14);
  --fr-fg:#f1f5f9; --fr-fg2:#cbd5e1; --fr-fg3:#94a3b8; --fr-fg4:#64748b; --fr-signal:#a78bfa; --fr-ink:#0b0820; --fr-ok:#34d399; --fr-warn:#fbbf24; --fr-bad:#ff8a5c; --fr-info:#8cb4f2;
  --fr-display:'Figtree','Plus Jakarta Sans',system-ui,sans-serif; --fr-body:'Instrument Sans','Inter',system-ui,sans-serif; --fr-mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
  --fr-c0:#9d8cff; --fr-c1:#2ee6a6; --fr-c2:#f2b84b; --fr-c3:#ff8a5c; --fr-c4:#8cb4f2; --fr-c5:#f0a487; --fr-c6:#a3a09a;
  --fr-a0:linear-gradient(145deg,#2a2547,#1d1a33); --fr-i0:#b9acff; --fr-a1:linear-gradient(145deg,#3a2620,#271813); --fr-i1:#f0a487; --fr-a2:linear-gradient(145deg,#173126,#10231b); --fr-i2:#6fe0b4;
  --fr-a3:linear-gradient(145deg,#1b2a42,#121c2d); --fr-i3:#8cb4f2; --fr-a4:linear-gradient(145deg,#3a3118,#272010); --fr-i4:#f2d27a; }
html.nl .fr { --fr-bg:var(--nl-bg); --fr-surface:var(--nl-surface); --fr-s2:var(--nl-s2); --fr-s3:var(--nl-s3); --fr-s4:var(--nl-s4); --fr-line:var(--nl-line); --fr-line2:var(--nl-line-strong);
  --fr-fg:var(--nl-fg); --fr-fg2:var(--nl-fg2); --fr-fg3:var(--nl-fg3); --fr-fg4:var(--nl-fg4); --fr-signal:var(--nl-signal); --fr-ink:var(--nl-signal-ink); --fr-ok:var(--nl-ok); --fr-warn:var(--nl-warn); --fr-info:var(--nl-info);
  --fr-display:var(--nl-display); --fr-body:var(--nl-body); --fr-mono:var(--nl-mono); }
html.nl[data-nl-theme="day"] .fr { /* hsl(): the look mapper rewrites hex and rgb in custom properties, not hsl */ --fr-bad:hsl(17.47 88.35% 40.39%); --fr-c0:hsl(248 64% 56%); --fr-c1:hsl(159 81% 31%); --fr-c2:hsl(36 71% 42%); --fr-c3:hsl(17.47 88.35% 40.39%); --fr-c4:hsl(200 49% 36%); --fr-c5:hsl(18 49% 36%); --fr-c6:hsl(44 5% 46%);
  --fr-a0:linear-gradient(145deg,hsl(262 58% 93%),hsl(255 54% 87%)); --fr-i0:hsl(249 37% 39%); --fr-a1:linear-gradient(145deg,hsl(21 62% 92%),hsl(20 58% 85%)); --fr-i1:hsl(18 49% 36%); --fr-a2:linear-gradient(145deg,hsl(152 37% 90%),hsl(150 34% 83%)); --fr-i2:hsl(152 39% 30%);
  --fr-a3:linear-gradient(145deg,hsl(215 52% 92%),hsl(216 52% 86%)); --fr-i3:hsl(216 45% 37%); --fr-a4:linear-gradient(145deg,hsl(47 65% 90%),hsl(47 63% 81%)); --fr-i4:hsl(45 58% 30%); }
.fr { --fr-signal-soft:color-mix(in srgb, var(--fr-signal) 14%, transparent); --fr-signal-mid:color-mix(in srgb, var(--fr-signal) 45%, transparent);
  --fr-ok-soft:color-mix(in srgb, var(--fr-ok) 13%, transparent); --fr-warn-soft:color-mix(in srgb, var(--fr-warn) 14%, transparent); --fr-bad-soft:color-mix(in srgb, var(--fr-bad) 14%, transparent); --fr-neu-soft:color-mix(in srgb, var(--fr-fg) 8%, transparent); }
.fr { box-sizing:border-box; width:100%; max-width:1340px; margin:0 auto; display:flex; flex-direction:column; gap:18px; color:var(--fr-fg); font:400 13.5px/1.5 var(--fr-body); text-align:left; }
.fr *, .fr *::before, .fr *::after { box-sizing:border-box; }
.fr :focus-visible { outline:2px solid var(--fr-signal); outline-offset:2px; }
.fr h1, .fr h2, .fr h3, .fr p, .fr ol, .fr ul { margin:0; }
.fr ol, .fr ul { padding:0; list-style:none; }
.fr button, .fr input, .fr select, .fr textarea { font:inherit; }
.fr button { cursor:pointer; }
.fr button:disabled { cursor:not-allowed; }
.fr a { color:inherit; }
.fr-view { display:flex; flex-direction:column; gap:18px; min-width:0; }
.fr-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.fr-title { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px; }
.fr-title > div:first-child { display:flex; flex-direction:column; gap:6px; min-width:0; }
.fr-crumb { align-self:flex-start; padding:0; border:0; background:none; color:var(--fr-fg3); font-size:12.5px; }
.fr-crumb:hover { color:var(--fr-fg); }
.fr-h1 { font:400 28px/1.1 var(--fr-display); letter-spacing:-.02em; overflow-wrap:anywhere; }
.fr-h1:focus { outline:none; }
.fr-sub { max-width:640px; color:var(--fr-fg2); font-size:14px; }
.fr-title__r { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.fr-pill { display:inline-flex; align-items:center; gap:6px; min-height:30px; padding:4px 10px; border-radius:999px; border:1px solid var(--fr-line2); background:var(--fr-s2); font-size:12px; color:var(--fr-fg2); }
.fr-dot { flex:0 0 6px; width:6px; height:6px; border-radius:50%; background:var(--fr-fg4); }
.fr-dot--ok { background:var(--fr-ok); } .fr-dot--warn { background:var(--fr-warn); } .fr-dot--bad { background:var(--fr-bad); }
.fr-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:32px; padding:0 13px; border-radius:8px; border:1px solid var(--fr-line2); background:transparent; color:var(--fr-fg); font-size:13px; white-space:nowrap; }
.fr-btn:hover:not(:disabled) { background:var(--fr-s3); }
.fr-btn:disabled { opacity:.55; }
.fr-btn--signal { background:var(--fr-signal); border-color:transparent; color:var(--fr-ink); font-weight:600; }
.fr-btn--signal:hover:not(:disabled) { background:var(--fr-signal); filter:brightness(1.07); }
.fr-btn--lg { min-height:40px; padding:0 18px; border-radius:9px; font-size:14px; font-weight:600; }
.fr-btn--quiet { color:var(--fr-fg2); }
.fr-link { padding:0; border:0; background:none; color:var(--fr-signal); font-size:13px; text-decoration:none; }
.fr-link:hover { text-decoration:underline; }
.fr-note { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; padding:11px 14px; border-radius:10px; border:1px solid var(--fr-line2); background:var(--fr-s2); color:var(--fr-fg2); font-size:13.5px; }
.fr-note--warn { border-color:color-mix(in srgb, var(--fr-warn) 40%, transparent); background:var(--fr-warn-soft); color:var(--fr-fg); }
.fr-note--bad { border-color:color-mix(in srgb, var(--fr-bad) 45%, transparent); background:var(--fr-bad-soft); color:var(--fr-fg); }
.fr-note__t { flex:1 1 260px; min-width:0; overflow-wrap:anywhere; }
.fr-sec { display:flex; flex-direction:column; gap:10px; min-width:0; }
.fr-hd { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:4px 12px; }
.fr-h2 { font:500 19px/1.3 var(--fr-display); letter-spacing:-.01em; overflow-wrap:anywhere; }
.fr-fine { font-size:12.5px; color:var(--fr-fg3); overflow-wrap:anywhere; }
.fr-card { border:1px solid var(--fr-line); border-radius:12px; background:var(--fr-surface); padding:16px; display:flex; flex-direction:column; gap:12px; min-width:0; }
.fr-needs { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:12px; }
.fr-need { border:1px solid var(--fr-line); border-radius:12px; background:var(--fr-surface); padding:14px 15px; display:flex; flex-direction:column; gap:9px; min-width:0; }
.fr-need__t { font-weight:500; font-size:14.5px; line-height:1.3; overflow-wrap:anywhere; }
.fr-need__b { flex:1 1 auto; font-size:13px; color:var(--fr-fg2); overflow-wrap:anywhere; }
.fr-need .fr-btn { align-self:flex-start; white-space:normal; text-align:left; }
.fr-tag { display:inline-flex; align-items:center; align-self:flex-start; padding:3px 8px; border-radius:6px; background:var(--fr-s3); color:var(--fr-fg3); font:400 11px/1.4 var(--fr-mono); white-space:nowrap; }
.fr-tag--ok { background:var(--fr-ok-soft); color:var(--fr-ok); } .fr-tag--warn { background:var(--fr-warn-soft); color:var(--fr-warn); }
.fr-tag--bad { background:var(--fr-bad-soft); color:var(--fr-bad); } .fr-tag--sig { background:var(--fr-signal-soft); color:var(--fr-signal); }
.fr-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
.fr-kpi { border:1px solid var(--fr-line); border-radius:12px; background:var(--fr-surface); padding:14px 16px; display:flex; flex-direction:column; gap:4px; min-width:0; }
.fr-kpi__l { font-size:12px; color:var(--fr-fg3); }
.fr-kpi__v { font:500 30px/1.15 var(--fr-display); letter-spacing:-.02em; overflow-wrap:anywhere; }
.fr-kpi__v--na { font-size:20px; color:var(--fr-fg3); }
.fr-kpi__n { font-size:12.5px; color:var(--fr-fg2); overflow-wrap:anywhere; }
.fr-cols { display:flex; flex-wrap:wrap; gap:18px; align-items:flex-start; }
.fr-main { flex:999 1 560px; min-width:0; display:flex; flex-direction:column; gap:18px; }
.fr-aside { flex:1 1 340px; max-width:420px; min-width:0; display:flex; flex-direction:column; gap:18px; }
.fr-big { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 14px; }
.fr-big b { font:500 26px/1.2 var(--fr-display); letter-spacing:-.02em; }
.fr-track { position:relative; height:10px; border-radius:5px; background:var(--fr-s3); }
.fr-track > span:first-child { position:absolute; left:0; top:0; bottom:0; border-radius:5px; background:var(--fr-signal); }
.fr-track__m { position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--fr-fg3); }
.fr-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
.fr-stat { border:1px solid var(--fr-line); border-radius:9px; background:var(--fr-s2); padding:8px 11px; display:flex; flex-direction:column; gap:1px; min-width:0; }
.fr-stat span:first-child { font-size:12px; color:var(--fr-fg3); }
.fr-stat span:last-child { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
.fr-acts { display:flex; flex-wrap:wrap; gap:8px; }
.fr-filters { display:flex; flex-wrap:wrap; gap:8px; }
.fr-filter { display:inline-flex; align-items:center; gap:7px; min-height:32px; padding:0 11px; border-radius:8px; border:0; background:transparent; color:var(--fr-fg2); font-size:13px; }
.fr-filter:hover { background:var(--fr-s3); }
.fr-filter[aria-pressed="true"] { background:var(--fr-s3); box-shadow:inset 0 0 0 1px var(--fr-line2); color:var(--fr-fg); }
.fr-filter b { font:400 11px var(--fr-mono); color:var(--fr-fg3); }
.fr-rows { display:flex; flex-direction:column; gap:4px; }
.fr-row { display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; width:100%; padding:11px 10px; border-radius:10px; border:1px solid transparent; background:transparent; color:inherit; text-align:left; }
.fr-row:hover { background:var(--fr-neu-soft); }
.fr-row[aria-pressed="true"] { background:var(--fr-s3); border-color:var(--fr-line2); }
.fr-av { flex:0 0 40px; width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font:600 14px var(--fr-display); background:var(--fr-a0); color:var(--fr-i0); }
.fr-av--1 { background:var(--fr-a1); color:var(--fr-i1); } .fr-av--2 { background:var(--fr-a2); color:var(--fr-i2); } .fr-av--3 { background:var(--fr-a3); color:var(--fr-i3); } .fr-av--4 { background:var(--fr-a4); color:var(--fr-i4); }
.fr-av--lg { flex-basis:52px; width:52px; height:52px; border-radius:12px; font-size:18px; }
.fr-row__t { flex:1 1 190px; min-width:0; display:flex; flex-direction:column; }
.fr-row__n { font-weight:500; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fr-row__d { font-size:12.5px; color:var(--fr-fg3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fr-row__m { flex:1 1 170px; min-width:0; display:flex; flex-direction:column; gap:5px; }
.fr-row__amt { display:flex; justify-content:space-between; gap:8px; font-size:12.5px; }
.fr-row__amt span { color:var(--fr-fg3); }
.fr-row .fr-tag { flex:0 0 108px; justify-content:center; align-self:center; }
.fr-bar { display:block; height:6px; border-radius:3px; background:var(--fr-s4); }
.fr-bar > span { display:block; height:6px; border-radius:3px; background:var(--fr-fg4); }
.fr-bar--ok > span { background:var(--fr-ok); } .fr-bar--bad > span { background:var(--fr-bad); } .fr-bar--warn > span { background:var(--fr-warn); }
.fr-empty { padding:16px; border:1px dashed var(--fr-line2); border-radius:10px; color:var(--fr-fg2); font-size:13.5px; display:flex; flex-direction:column; align-items:flex-start; gap:10px; }
.fr-skel { border-radius:10px; background:var(--fr-s2); height:64px; animation:fr-pulse 1.4s ease-in-out infinite; }
.fr-skel--k { height:92px; } .fr-skel--n { height:130px; }
@keyframes fr-pulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .fr-skel { animation:none; } .fr-spin { animation-duration:3s; } }
.fr-spin { display:inline-block; width:12px; height:12px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:fr-spin .8s linear infinite; }
@keyframes fr-spin { to { transform:rotate(360deg); } }
.fr-dh { display:flex; align-items:center; gap:12px; }
.fr-dh > div { min-width:0; display:flex; flex-direction:column; }
.fr-tiles { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.fr-label { font-size:11.5px; letter-spacing:.04em; text-transform:uppercase; color:var(--fr-fg4); }
.fr-move { display:flex; flex-direction:column; align-items:flex-start; gap:7px; padding:11px 0; border-top:1px solid var(--fr-line); }
.fr-move b { font-weight:500; font-size:14px; }
.fr-move p { font-size:13px; color:var(--fr-fg2); overflow-wrap:anywhere; }
.fr-move .fr-fine { font-size:12px; }
.fr-when { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-top:1px solid var(--fr-line); }
.fr-when > span { display:flex; flex-direction:column; min-width:0; }
.fr-when b { font-weight:500; font-size:14px; }
.fr-ideas { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
.fr-idea { border:1px solid var(--fr-line); border-radius:10px; background:var(--fr-s2); padding:12px; display:flex; flex-direction:column; align-items:flex-start; gap:6px; font-size:13px; color:var(--fr-fg2); }
.fr-idea b { color:var(--fr-fg); font-weight:500; font-size:14px; }
.fr-idea p { flex:1 1 auto; }
.fr-connect { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.fr-field { display:flex; flex-direction:column; gap:7px; min-width:0; }
.fr-field > span:first-child, .fr-fl { font-size:13px; font-weight:500; }
.fr-in { width:100%; min-height:38px; padding:0 12px; border:1px solid var(--fr-line2); border-radius:9px; background:var(--fr-s2); color:var(--fr-fg); font-size:14px; }
textarea.fr-in { padding:10px 12px; line-height:1.5; resize:vertical; }
.fr-in::placeholder { color:var(--fr-fg3); }
.fr-connect .fr-in { flex:1 1 220px; width:auto; }
.fr-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
.fr-err { color:var(--fr-warn); font-size:13px; }
.fr-err:empty { display:none; }
.fr-steps { display:flex; flex-wrap:wrap; gap:8px; }
.fr-step { display:inline-flex; align-items:center; gap:9px; min-height:34px; padding:0 12px 0 6px; border-radius:999px; border:1px solid var(--fr-line); background:transparent; color:var(--fr-fg3); font-size:13px; }
.fr-step[aria-current="step"] { background:var(--fr-s3); border-color:var(--fr-line2); color:var(--fr-fg); }
.fr-step:disabled { cursor:default; }
.fr-step.is-done { color:var(--fr-fg); }
.fr-step i { font-style:normal; width:22px; height:22px; border-radius:50%; background:var(--fr-s3); color:var(--fr-fg3); display:inline-flex; align-items:center; justify-content:center; font:400 11px var(--fr-mono); }
.fr-step[aria-current="step"] i { background:var(--fr-signal); color:var(--fr-ink); }
.fr-step.is-done i { background:var(--fr-ok-soft); color:var(--fr-ok); }
.fr-sum { display:flex; flex-direction:row; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 16px; }
.fr-sum > span { display:flex; flex-direction:column; align-items:flex-start; text-align:left; flex:1 1 260px; min-width:0; }
.fr-bcard { border:1px solid var(--fr-line2); border-radius:12px; background:var(--fr-surface); padding:18px; display:flex; flex-direction:column; gap:18px; min-width:0; }
.fr-place { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px; border:1px solid var(--fr-line); background:transparent; min-width:0; }
.fr-place.is-on { border-color:var(--fr-signal); background:var(--fr-signal-soft); }
.fr-place.is-off { opacity:.65; }
.fr-place input[type="checkbox"] { flex:0 0 auto; width:16px; height:16px; accent-color:var(--fr-signal); margin:0; }
.fr-place__t { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
.fr-place__t b { font-weight:500; font-size:13.5px; overflow-wrap:anywhere; }
.fr-place__t span { font-size:12.5px; color:var(--fr-fg3); overflow-wrap:anywhere; }
.fr-place .fr-in { margin-top:6px; }
.fr-places { display:flex; flex-direction:column; gap:8px; }
.fr-gift { display:flex; gap:8px; }
.fr-gift .fr-in:first-child { flex:0 0 96px; width:96px; }
.fr-gift .fr-in:nth-child(2) { flex:1 1 auto; min-width:0; }
.fr-gift .fr-btn { flex:0 0 38px; padding:0; }
.fr-opts { display:flex; flex-wrap:wrap; gap:10px; }
.fr-opt { display:inline-flex; align-items:center; gap:8px; min-height:34px; padding:0 12px 0 10px; border-radius:9px; border:1px solid var(--fr-line); font-size:13px; color:var(--fr-fg2); cursor:pointer; }
.fr-opt:has(input:checked) { background:var(--fr-s3); border-color:var(--fr-line2); color:var(--fr-fg); }
.fr-opt:has(input:focus-visible) { outline:2px solid var(--fr-signal); outline-offset:2px; }
.fr-opt input { width:16px; height:16px; margin:0; accent-color:var(--fr-signal); }
.fr-bacts { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
.fr-bcols { display:flex; flex-wrap:wrap; gap:18px; align-items:flex-start; }
.fr-bmain { flex:999 1 520px; min-width:0; display:flex; flex-direction:column; gap:12px; }
.fr-baside { flex:1 1 340px; max-width:440px; min-width:0; display:flex; flex-direction:column; gap:18px; }
.fr-strip { display:flex; gap:3px; height:34px; }
.fr-strip > span { flex:1 1 0; min-width:0; border-radius:5px; border:1px solid; }
.fr-leg { display:flex; align-items:center; gap:10px; padding:7px 0; border-top:1px solid var(--fr-line); font-size:13px; }
.fr-leg > i { flex:0 0 10px; width:10px; height:10px; border-radius:3px; border:1px solid; }
.fr-leg > span:first-of-type { flex:1 1 auto; min-width:0; }
.fr-leg .fr-fine { text-align:right; }
.fr-leg b { flex:0 0 34px; text-align:right; font:400 11.5px var(--fr-mono); color:var(--fr-fg2); }
.fr-sample { border:1px solid var(--fr-line); border-radius:10px; background:var(--fr-s2); padding:12px; display:flex; flex-direction:column; gap:8px; }
.fr-sample p { font-size:13.5px; line-height:1.5; overflow-wrap:anywhere; white-space:pre-line; }
.fr-sample .is-ph { color:var(--fr-fg3); font-style:italic; }
.fr-post { border:1px solid var(--fr-line); border-radius:12px; background:var(--fr-s2); padding:14px; display:flex; flex-direction:column; gap:8px; }
.fr-post__hd { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px 12px; font-size:12px; color:var(--fr-fg3); }
.fr-post__hd b { color:var(--fr-fg); text-transform:capitalize; font-weight:500; }
.fr-daybar { margin:10px 0 0; font-size:12px; font-weight:600; color:var(--fr-signal); text-transform:uppercase; letter-spacing:.06em; }
.fr-post .fr-in { min-height:36px; font-size:12.5px; color:var(--fr-fg2); }
.fr-post textarea.fr-in { font-size:13px; color:var(--fr-fg); }
.fr-ov { position:fixed; inset:0; z-index:10001; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:16px; }
.fr-modal { width:min(640px,100%); max-height:90vh; overflow:auto; border:1px solid var(--fr-line2); border-radius:14px; background:var(--fr-surface); color:var(--fr-fg); padding:18px; display:flex; flex-direction:column; gap:14px; font:400 13.5px/1.5 var(--fr-body); }
.fr-modal__hd { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.fr-modal__hd h2 { font:500 19px/1.3 var(--fr-display); margin:0; }
.fr-draft { display:flex; flex-direction:column; gap:8px; padding-top:12px; border-top:1px solid var(--fr-line); }
.fr-draft:first-of-type { border-top:0; padding-top:0; }
.fr-draft__hd { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 10px; }
.fr-draft__hd b { font-weight:500; overflow-wrap:anywhere; }
.fr-draft textarea { min-height:190px; font-size:13.5px; }
@media (max-width: 520px) { .fr-h1 { font-size:24px; } .fr-card, .fr-bcard { padding:14px; } .fr-kpi__v { font-size:26px; } .fr-row .fr-tag { flex-basis:auto; } }
`;
    document.head.appendChild(st);
  }

  /* ───────────────────────── small helpers for the page ───────────────────────── */

  const SVG = (d, w, sw) => `<svg width="${w || 15}" height="${w || 15}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const ICON = { x: SVG('M6 6l12 12 M18 6 6 18', 15, 2), out: SVG('M7 17 17 7 M8 7h9v9', 12, 2) };

  /** Copies text. Falls back to a hidden textarea where the clipboard API is not allowed. Resolves to true or false. */
  function copyText(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_) { return false; }
    };
    if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
      return global.navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }

  /* ───────────────────────── the page ───────────────────────── */

  let active = null;

  const IDEAS = [
    { title: 'Impact reel', platform: 'Instagram and TikTok', desc: 'Show what gifts make possible in 30 seconds. Use a real story that you have permission to share.' },
    { title: 'Supporters start their own pages', platform: 'Facebook and Instagram', desc: 'Ask supporters to start a JustGiving page for a birthday, a challenge or an event, and say thank you in public when they do.' },
    { title: 'Giving Tuesday countdown', platform: 'All platforms', desc: 'A short run of posts leading up to Giving Tuesday, each with one clear ask. If a funder is matching gifts, say so.' },
    { title: 'Live fundraising stream', platform: 'Facebook Live', desc: 'Go live with your goal on screen and say the ask out loud every few minutes. Put the link in the first comment.' },
  ];

  const PLATFORM_NAME = { facebook: 'Facebook', instagram: 'Instagram' };

  function mount(content, deps) {
    if (!content) return;
    if (active) active.destroy();
    injectStyles();
    deps = deps || {};

    const charity = String(deps.clientName || 'your charity');
    const toast = (m, k) => { if (typeof deps.toast === 'function') deps.toast(m, k); else if (typeof global.showToast === 'function') global.showToast(m, k); };
    const goTo = (nav) => { if (typeof deps.switchNav === 'function') deps.switchNav(nav); else if (typeof global.switchNav === 'function') global.switchNav(nav); };
    const nowDate = () => new Date();
    const today = () => (typeof deps.todayKey === 'function' && dayNum(deps.todayKey()) != null ? deps.todayKey() : todayIso(nowDate()));

    const S = {
      view: 'overview',
      hasJG: !!deps.hasJustGiving,
      jgState: deps.hasJustGiving ? 'loading' : 'off', jgError: '', jgAll: [],
      metaState: 'loading', metaError: '', metaList: [],
      filter: 'all', sel: null, showAll: false,
      connectBusy: false, connectErr: '',
      modal: null, opener: null,
      b: null,
    };
    let loadSeq = 0;
    let dead = false;
    let copyTimer = null;

    content.innerHTML = '<div class="fr" id="fundraise-root"><div class="fr-view" id="fr-view"></div><div id="fr-modal"></div><div class="fr-sr" id="fr-live" role="status" aria-live="polite"></div></div>';
    const root = content.querySelector('#fundraise-root');
    const $ = (sel) => root.querySelector(sel);
    const alive = () => !dead && root.isConnected;
    const live = (msg) => { const el = $('#fr-live'); if (el) el.textContent = msg; };

    /* ── network ── */
    async function call(path, init) {
      const fetcher = typeof deps.apiFetch === 'function' ? deps.apiFetch : global.apiFetch;
      const base = deps.api || global.API || global._seAPI || '';
      const opts = Object.assign({}, init || {});
      if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
      if (opts.body) opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      const res = await fetcher(`${base}${path}`, opts);
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body: body || {} };
    }

    /* ── derived data ── */
    const fundraisers = () => S.jgAll.filter((f) => f.active).concat(S.metaList);
    const byKey = (k) => fundraisers().find((f) => f.key === k) || null;
    const posts = () => {
      if (typeof deps.postsOmitted === 'function' && deps.postsOmitted()) return null;
      const p = typeof deps.getPosts === 'function' ? deps.getPosts() : null;
      return Array.isArray(p) ? p : null;
    };
    const create = { content: (t, u) => (typeof deps.createContent === 'function' ? deps.createContent(t, u) : (typeof global.fundraiseCreateContent === 'function' ? global.fundraiseCreateContent(t, u) : goTo('creation-studio'))),
      ad: (t, u) => (typeof deps.createAdDraft === 'function' ? deps.createAdDraft(t, u) : (typeof global.fundraiseCreateAdDraft === 'function' ? global.fundraiseCreateAdDraft(t, u) : goTo('ad-studio'))) };

    /* ── focus-preserving render ── */
    function renderInto(host, html) {
      if (!host) return;
      const a = document.activeElement;
      const fk = a && host.contains(a) && a.getAttribute ? a.getAttribute('data-fk') : null;
      host.innerHTML = html;
      if (fk) { const n = host.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n && !n.disabled) n.focus(); }
    }

    /* ───────────── overview ───────────── */

    function overviewShell() {
      return `<div class="fr-title">
          <div><h1 class="fr-h1" id="fr-h1" tabindex="-1">Fundraise</h1><p class="fr-sub">What your supporters have raised, who is raising it, and who to thank or nudge next.</p></div>
          <div class="fr-title__r" id="fr-chips"></div>
        </div>
        <div class="fr-sec" id="fr-notes"></div>
        <div id="fr-connect"></div>
        <section class="fr-sec" aria-labelledby="fr-needs-h">
          <div class="fr-hd"><h2 class="fr-h2" id="fr-needs-h">Worth doing this week</h2><span class="fr-fine">Worked out from your pages and their numbers. Nothing is sent for you.</span></div>
          <div id="fr-needs"></div>
        </section>
        <div id="fr-kpi"></div>
        <div class="fr-cols">
          <div class="fr-main"><div id="fr-camp"></div><div id="fr-list"></div><div id="fr-ideas"></div></div>
          <aside class="fr-aside" aria-label="Details"><div id="fr-detail"></div><div id="fr-coming"></div></aside>
        </div>`;
    }

    function showOverview() {
      S.view = 'overview';
      S.b = null;
      $('#fr-view').innerHTML = overviewShell();
      renderOverview();
    }

    function renderOverview() {
      if (!alive() || S.view !== 'overview') return;
      renderChips(); renderNotes(); renderConnect(); renderNeeds(); renderKpis(); renderCamp(); renderList(); renderDetail(); renderComing(); renderIdeas();
    }

    function renderChips() {
      const jg = S.jgState === 'ok' ? ['ok', 'JustGiving'] : S.jgState === 'off' ? ['warn', 'JustGiving: not connected'] : S.jgState === 'error' ? ['bad', 'JustGiving: could not load'] : ['', 'JustGiving: loading'];
      const mt = S.metaState === 'ok' ? ['ok', 'Meta fundraisers'] : S.metaState === 'permission' ? ['warn', 'Meta fundraisers: needs permission'] : S.metaState === 'off' ? ['warn', 'Meta fundraisers: not connected'] : S.metaState === 'error' ? ['bad', 'Meta fundraisers: could not load'] : ['', 'Meta fundraisers: loading'];
      const pill = (p) => `<span class="fr-pill"><span class="fr-dot${p[0] ? ' fr-dot--' + p[0] : ''}" aria-hidden="true"></span>${esc(p[1])}</span>`;
      renderInto($('#fr-chips'), `${pill(jg)}${pill(mt)}<button type="button" class="fr-btn fr-btn--signal fr-btn--lg" data-a="start" data-fk="start">Start a campaign</button>`);
    }

    function renderNotes() {
      const notes = [];
      if (S.jgState === 'error') notes.push(`<div class="fr-note fr-note--bad"><p class="fr-note__t">${esc(S.jgError || 'JustGiving could not be reached.')}</p><button type="button" class="fr-btn" data-a="retry" data-fk="retry-jg">Try again</button></div>`);
      if (S.metaState === 'permission') notes.push(`<div class="fr-note fr-note--warn"><p class="fr-note__t">Meta needs the <code>manage_fundraisers</code> permission to list your fundraisers. Reconnect Facebook in Settings and approve the new permission when prompted.${S.metaError ? ` Meta said: ${esc(S.metaError)}` : ''}</p><button type="button" class="fr-btn" data-a="settings" data-fk="settings">Reconnect Meta in Settings</button></div>`);
      else if (S.metaState === 'error') notes.push(`<div class="fr-note fr-note--bad"><p class="fr-note__t">${esc(S.metaError || 'Meta fundraisers could not be loaded.')}</p><button type="button" class="fr-btn" data-a="retry" data-fk="retry-meta">Try again</button></div>`);
      else if (S.metaState === 'off') notes.push('<div class="fr-note"><p class="fr-note__t">Connect your Facebook Page in Settings to load Meta fundraisers.</p><button type="button" class="fr-btn" data-a="settings" data-fk="settings">Open Settings</button></div>');
      renderInto($('#fr-notes'), notes.join(''));
    }

    function renderConnect() {
      if (S.jgState !== 'off') { renderInto($('#fr-connect'), ''); return; }
      renderInto($('#fr-connect'), `<section class="fr-card" aria-labelledby="fr-conn-h">
          <h2 class="fr-h2" id="fr-conn-h">Connect JustGiving</h2>
          <p class="fr-fine">Add your JustGiving charity ID and your fundraising pages will appear here, with what each has raised.</p>
          <div class="fr-connect"><label class="fr-sr" for="fr-cid">JustGiving charity ID</label>
            <input id="fr-cid" class="fr-in" type="text" inputmode="numeric" autocomplete="off" placeholder="Charity ID" aria-describedby="fr-cid-err"${S.connectBusy ? ' disabled' : ''}>
            <button type="button" class="fr-btn fr-btn--signal" data-a="connect" data-fk="connect"${S.connectBusy ? ' disabled' : ''}>${S.connectBusy ? '<span class="fr-spin" aria-hidden="true"></span>Connecting' : 'Connect'}</button></div>
          <p class="fr-err" id="fr-cid-err" role="alert">${esc(S.connectErr)}</p>
        </section>`);
    }

    function renderNeeds() {
      const host = $('#fr-needs');
      if (S.jgState === 'loading') { renderInto(host, '<div class="fr-needs" aria-busy="true"><div class="fr-skel fr-skel--n"></div><div class="fr-skel fr-skel--n"></div><div class="fr-skel fr-skel--n"></div></div>'); return; }
      const cards = needsThisWeek(fundraisers(), keyDates(nowDate()), nowDate());
      S.cards = cards;
      if (!cards.length) { renderInto(host, '<p class="fr-empty">Nothing needs you this week.</p>'); return; }
      renderInto(host, `<div class="fr-needs">${cards.map((c) => `<div class="fr-need">
          <span class="fr-tag fr-tag--${esc(c.tone === 'mute' ? '' : c.tone)}">${esc(c.chip)}</span>
          <span class="fr-need__t">${esc(c.title)}</span>
          <span class="fr-need__b">${esc(c.body)}</span>
          <button type="button" class="fr-btn" data-a="need" data-id="${esc(c.id)}" data-fk="need-${esc(c.id)}">${esc(c.cta)}</button></div>`).join('')}</div>`);
    }

    function kpiCard(label, value, note, na) {
      return `<div class="fr-kpi"><span class="fr-kpi__l">${esc(label)}</span><span class="fr-kpi__v${na ? ' fr-kpi__v--na' : ''}">${esc(value)}</span><span class="fr-kpi__n">${esc(note)}</span></div>`;
    }

    function renderKpis() {
      const host = $('#fr-kpi');
      if (S.jgState === 'off' || S.jgState === 'error') { renderInto(host, ''); return; }
      if (S.jgState === 'loading') { renderInto(host, '<div class="fr-kpis" aria-busy="true"><div class="fr-skel fr-skel--k"></div><div class="fr-skel fr-skel--k"></div><div class="fr-skel fr-skel--k"></div><div class="fr-skel fr-skel--k"></div></div>'); return; }
      const sm = summarize(S.jgAll, nowDate());
      const m = (n) => formatMoney(n, sm.currency);
      const raisedNote = [];
      raisedNote.push(sm.known ? `Across ${plural(sm.known, 'active page')}. Gift Aid is not included.` : (sm.active ? 'Totals for your active pages are not loaded.' : 'You have no active pages yet.'));
      if (sm.unknown) raisedNote.push(`${plural(sm.unknown, 'page')} without totals ${sm.unknown === 1 ? 'is' : 'are'} not counted.`);
      if (sm.otherCurrency) raisedNote.push(`${plural(sm.otherCurrency, 'page')} in another currency ${sm.otherCurrency === 1 ? 'is' : 'are'} not counted.`);
      if (S.metaList.length) {
        const by = {}; S.metaList.forEach((f) => { by[f.currency] = (by[f.currency] || 0) + f.raised; });
        raisedNote.push(`Meta fundraisers raised ${Object.keys(by).map((c) => formatMoney(by[c], c)).join(' and ')}, counted separately.`);
      }
      const gift = sm.giftAidPages
        ? kpiCard('Gift Aid on top', m(sm.giftAid), sm.giftAidPages === sm.known ? `${m(sm.raised + sm.giftAid)} in all with Gift Aid. Shown separately so you can tell supporters the real impact.` : `Counted on ${sm.giftAidPages} of ${sm.known} pages that report it. Shown separately so you can tell supporters the real impact.`)
        : kpiCard('Gift Aid on top', 'Not available', sm.known ? 'JustGiving did not send Gift Aid totals for these pages.' : 'Shown once your pages have totals.', true);
      const flags = [];
      if (sm.nearTarget) flags.push(`${sm.nearTarget} near target`);
      if (sm.endingSoon) flags.push(`${sm.endingSoon} ending soon`);
      if (sm.goneQuiet) flags.push(`${sm.goneQuiet} gone quiet`);
      if (sm.notStarted) flags.push(`${sm.notStarted} not started`);
      const act = kpiCard('Active pages', String(sm.active), `of ${plural(sm.listed, 'page')} listed${sm.listed >= 50 ? ' (JustGiving search shows up to 50)' : ''}.${flags.length ? ' ' + flags.join(', ') + '.' : ''}`);
      const avgNote = sm.known ? `Top page raised ${m(sm.top ? sm.top.raised : 0)}.${sm.known > 1 ? ` Half of the pages are under ${m(sm.median)}.` : ''}` : 'Shown once your pages have totals.';
      const avg = sm.average == null ? kpiCard('Average per active page', 'Not available', avgNote, true) : kpiCard('Average per active page', m(sm.average), avgNote);
      renderInto(host, `<section class="fr-kpis" aria-label="Totals">${kpiCard('Raised on JustGiving', m(sm.raised), raisedNote.join(' '))}${gift}${act}${avg}</section>`);
    }

    /* ── the campaign the user created ── */
    function currentCampaign() {
      const rows = posts();
      if (!rows) return null;
      const list = campaignsFromPosts(rows, nowDate());
      return list[0] || null;
    }

    function renderCamp() {
      const host = $('#fr-camp');
      const camp = currentCampaign();
      if (!camp) { renderInto(host, ''); return; }
      const t = today();
      const page = linkCampaign(camp, fundraisers());
      const known = page && page.numbersKnown !== false;
      const pace = paceFor({ start: camp.start, end: camp.end, today: t, raised: known ? page.raised : 0, goal: known ? page.goal : 0 });
      let dayLine = '';
      if (pace && pace.state === 'upcoming') dayLine = `Starts ${formatDate(camp.start)}. ${plural(pace.total, 'day')} long.`;
      else if (pace && pace.over) dayLine = `Ended ${formatDate(camp.end)}.`;
      else if (pace) dayLine = `Day ${pace.dayNo} of ${pace.total}. Ends ${formatDate(camp.end)}.`;
      let top = '';
      if (known && page.goal > 0) {
        const pct = percentOf(page.raised, page.goal);
        const tag = pace && pace.label ? `<span class="fr-tag fr-tag--${pace.state === 'ahead' ? 'ok' : pace.state === 'behind' ? 'warn' : 'sig'}">${esc(pace.label)}</span>` : '';
        const marker = pace && pace.expected != null && pace.state !== 'upcoming' ? `<span class="fr-track__m" style="left:${Math.min(100, pace.expected)}%" title="Where an even pace would be today"></span>` : '';
        top = `<div class="fr-big"><b>${esc(formatMoney(page.raised, page.currency))}</b><span>of ${esc(formatMoney(page.goal, page.currency))} goal, ${pct}%</span>${tag}</div>
          <div class="fr-track" role="img" aria-label="${esc(`${pct}% of the goal raised${pace && pace.expected != null && pace.state !== 'upcoming' ? `, an even pace would be ${pace.expected}%` : ''}`)}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span>${marker}</div>
          <p class="fr-fine">Totals are from the linked page, "${esc(page.title)}", and include anything raised before the campaign began. An even pace is a rule of thumb, not a forecast.</p>`;
      } else if (known) {
        top = `<div class="fr-big"><b>${esc(formatMoney(page.raised, page.currency))}</b><span>raised on the linked page, which has no goal set</span></div>`;
      } else {
        top = '<p class="fr-fine">The posts do not link to a JustGiving page or Meta fundraiser we can read totals for, so the amount raised is not shown. Choose one of your pages when you start a campaign to see it here.</p>';
      }
      const stats = [['Posts published', `${camp.published} of ${camp.total}`]];
      stats.push(['Next post', camp.next ? `${formatDate(camp.next.date)}${camp.next.time ? ', ' + formatClock(camp.next.time) : ''}${camp.next.platform ? ', ' + camp.next.platform : ''}` : 'No more posts to publish']);
      if (camp.thanksOn) stats.push(['Thank-you post', `Set for ${formatDate(camp.thanksOn)}`]);
      if (camp.draft) stats.push(['Need numbers', `${plural(camp.draft, 'post')} saved as Draft`]);
      renderInto(host, `<section class="fr-card" aria-label="Active campaign">
          <div class="fr-hd"><h2 class="fr-h2">${esc(camp.name)}</h2><span class="fr-fine">${esc(dayLine)}</span></div>
          ${top}
          <div class="fr-stats">${stats.map((s) => `<div class="fr-stat"><span>${esc(s[0])}</span><span>${esc(s[1])}</span></div>`).join('')}</div>
          <div class="fr-acts">
            <button type="button" class="fr-btn" data-a="camp-posts" data-fk="camp-posts">See the ${camp.total} posts</button>
            ${known ? '<button type="button" class="fr-btn" data-a="camp-progress" data-fk="camp-progress">Add a progress post</button>' : ''}
            <button type="button" class="fr-btn" data-a="camp-ad" data-fk="camp-ad">Make an ad for this campaign</button>
          </div>
        </section>`);
    }

    /* ── the list ── */
    function rowHtml(f) {
      const s = deriveStatus(f, nowDate());
      const on = f.key === S.sel;
      const who = f.source === 'meta' ? 'Meta fundraiser' : (f.owner || 'JustGiving page');
      const when = whenText(f, s, nowDate());
      const barTone = s.tone === 'ok' || s.tone === 'bad' || s.tone === 'warn' ? s.tone : '';
      const meter = s.key === 'unknown' ? '<span class="fr-row__amt"><span>Totals not loaded</span></span>'
        : `<span class="fr-row__amt"><b>${esc(formatMoney(f.raised, f.currency))}</b><span>${f.goal > 0 ? `of ${esc(formatMoney(f.goal, f.currency))}` : 'No goal set'}</span></span>${f.goal > 0 ? `<span class="fr-bar${barTone ? ' fr-bar--' + barTone : ''}" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, s.pct || 0))}%"></span></span>` : ''}`;
      return `<button type="button" class="fr-row" data-a="select" data-key="${esc(f.key)}" data-fk="row-${esc(f.key)}" aria-pressed="${on ? 'true' : 'false'}">
          <span class="fr-av fr-av--${hashIndex(f.key, 5)}" aria-hidden="true">${esc(initials(f.owner || f.title))}</span>
          <span class="fr-row__t"><span class="fr-row__n">${esc(f.title)}</span><span class="fr-row__d">${esc(who)}${when ? ' · ' + esc(when) : ''}</span></span>
          <span class="fr-row__m">${meter}</span>
          <span class="fr-tag fr-tag--${esc(s.tone === 'mute' ? '' : s.tone)}">${esc(s.label)}</span></button>`;
    }

    function renderList() {
      const host = $('#fr-list');
      const head = '<div class="fr-hd"><h2 class="fr-h2" id="fr-list-h">Your fundraisers</h2><span class="fr-fine">JustGiving pages and Meta fundraisers in one list</span></div>';
      const all = fundraisers();
      const loading = S.jgState === 'loading' || (S.metaState === 'loading' && !all.length);
      if (loading) { renderInto(host, `<section class="fr-card" aria-labelledby="fr-list-h" aria-busy="true">${head}<div class="fr-skel"></div><div class="fr-skel"></div><div class="fr-skel"></div></section>`); return; }
      if (!all.length) {
        let msg;
        if (S.jgState === 'error') msg = 'Your JustGiving pages could not be loaded, so there is nothing to list yet. Use Try again above.';
        else if (S.jgState === 'off') msg = 'Connect JustGiving above to list your fundraising pages. Meta fundraisers will show here too once Meta lets us read them.';
        else msg = 'No fundraising pages yet. When supporters start a JustGiving page for you, or you start a Meta fundraiser, it will show here with what it has raised.';
        renderInto(host, `<section class="fr-card" aria-labelledby="fr-list-h">${head}<div class="fr-empty"><span>${esc(msg)}</span><button type="button" class="fr-btn" data-a="start" data-fk="start-empty">Start a campaign</button></div></section>`);
        return;
      }
      const filters = filterCounts(all, nowDate());
      if (!filters.some((x) => x.id === S.filter)) S.filter = 'all';
      const list = applyFilter(all, S.filter, nowDate());
      const shown = S.showAll ? list : list.slice(0, ROWS_SHOWN);
      const foot = [];
      foot.push(list.length ? `Showing ${shown.length} of ${list.length}. Sorted by what needs you first.` : 'Nothing matches this filter.');
      const jgPages = all.filter((f) => f.source === 'justgiving');
      if (jgPages.length && !jgPages.some((f) => f.lastGiftAt)) foot.push('Last gift dates are not available from JustGiving, so Gone quiet is not shown.');
      const notLoaded = jgPages.filter((f) => f.numbersKnown === false).length;
      if (notLoaded) foot.push(`${plural(notLoaded, 'page')} past the first ${ENRICHED_PAGES} ${notLoaded === 1 ? 'has' : 'have'} no totals yet.`);
      renderInto(host, `<section class="fr-card" aria-labelledby="fr-list-h">${head}
          <div class="fr-filters" role="group" aria-label="Filter fundraisers">${filters.map((x) => `<button type="button" class="fr-filter" data-a="filter" data-id="${esc(x.id)}" data-fk="f-${esc(x.id)}" aria-pressed="${x.id === S.filter ? 'true' : 'false'}">${esc(x.label)}<b>${x.count}</b></button>`).join('')}</div>
          <div class="fr-rows">${shown.map(rowHtml).join('')}</div>
          <div class="fr-acts">${!S.showAll && list.length > shown.length ? `<button type="button" class="fr-btn" data-a="showall" data-fk="showall">Show all ${list.length}</button>` : ''}</div>
          <p class="fr-fine">${foot.map(esc).join(' ')}</p></section>`);
    }

    /* ── one fundraiser ── */
    function renderDetail() {
      const host = $('#fr-detail');
      const all = fundraisers();
      if (!all.length) { renderInto(host, ''); return; }
      const f = byKey(S.sel);
      if (!f) { renderInto(host, '<section class="fr-card"><p class="fr-fine">Pick a fundraiser to see what to do next.</p></section>'); return; }
      const s = deriveStatus(f, nowDate());
      const src = f.source === 'meta' ? 'Meta' : 'JustGiving';
      const tiles = [['Raised', s.key === 'unknown' ? 'Not loaded' : `${formatMoney(f.raised, f.currency)}${f.goal > 0 ? ` of ${formatMoney(f.goal, f.currency)}` : ''}`]];
      if (f.source === 'justgiving') tiles.push(['With Gift Aid', f.withGiftAid != null ? formatMoney(f.withGiftAid, f.currency) : 'Not available']);
      const missing = [];
      if (f.supporters != null) tiles.push(['Supporters', plural(f.supporters, 'gift')]); else missing.push('supporter count');
      if (f.lastGiftAt) { const q = s.quietDays; tiles.push(['Last gift', q === 0 ? 'Today' : q === 1 ? 'Yesterday' : `${plural(q, 'day')} ago`]); } else missing.push('last gift date');
      if (f.createdAt) tiles.push(['Started', formatDate(f.createdAt, { weekday: false })]);
      tiles.push(['Ends', f.endsAt ? formatDate(f.endsAt, { weekday: false, year: true }) : 'No end date']);
      const moves = movesFor(f, nowDate(), posts());
      const sub = [f.source === 'meta' ? 'Meta fundraiser' : f.owner, f.createdAt ? `started ${formatDate(f.createdAt, { weekday: false })}` : ''].filter(Boolean).join(' · ');
      const link = safeUrl(f.url);
      renderInto(host, `<section class="fr-card" aria-labelledby="fr-det-h">
          <div class="fr-dh"><span class="fr-av fr-av--lg fr-av--${hashIndex(f.key, 5)}" aria-hidden="true">${esc(initials(f.owner || f.title))}</span><div><h2 class="fr-h2" id="fr-det-h">${esc(f.title)}</h2><span class="fr-fine">${esc(sub)}</span></div></div>
          <div class="fr-tiles">${tiles.map((x) => `<div class="fr-stat"><span>${esc(x[0])}</span><span>${esc(x[1])}</span></div>`).join('')}</div>
          ${missing.length ? `<p class="fr-fine">The ${esc(missing.join(' and '))} ${missing.length > 1 ? 'are' : 'is'} not available from ${src}.</p>` : ''}
          <div><span class="fr-label">What to do next</span>
          ${moves.length ? moves.map((m) => `<div class="fr-move"><b>${esc(m.title)}</b><p>${esc(m.body)}</p><span class="fr-fine">Basis: ${esc(m.basis)}</span>
              <button type="button" class="fr-btn${m.primary ? ' fr-btn--signal' : ''}" data-a="move" data-draft="${esc(m.draft)}" data-key="${esc(f.key)}" data-fk="mv-${esc(m.id)}">${esc(m.cta)}</button></div>`).join('') : '<p class="fr-fine">Nothing to suggest until this fundraiser has its totals.</p>'}
          </div>
          <div class="fr-acts">${link ? `<a class="fr-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open on ${src}${ICON.out}</a>` : ''}
            <button type="button" class="fr-btn" data-a="create-content" data-key="${esc(f.key)}" data-fk="cc">Create a post</button>
            <button type="button" class="fr-btn" data-a="create-ad" data-key="${esc(f.key)}" data-fk="ca">Create an ad draft</button></div>
          <p class="fr-fine">Thank-you messages are drafts. You read them and send them yourself.</p></section>`);
    }

    function renderComing() {
      const list = keyDates(nowDate());
      renderInto($('#fr-coming'), `<section class="fr-card" aria-labelledby="fr-up-h"><h2 class="fr-h2" id="fr-up-h">Coming up</h2>
          <div>${list.map((m) => `<div class="fr-when"><span><b>${esc(m.name)}</b><span class="fr-fine">${esc(m.when)}</span></span>
            <button type="button" class="fr-btn" data-a="plan" data-id="${esc(m.id)}" data-fk="plan-${esc(m.id)}"${m.plan ? '' : ' disabled title="Too close to plan a campaign"'}>Plan it</button></div>`).join('')}</div></section>`);
    }

    function renderIdeas() {
      renderInto($('#fr-ideas'), `<section class="fr-card" aria-labelledby="fr-ideas-h"><div class="fr-hd"><h2 class="fr-h2" id="fr-ideas-h">Post ideas</h2><span class="fr-fine">Starting points for Create. Nothing is posted for you.</span></div>
          <div class="fr-ideas">${IDEAS.map((x, i) => `<div class="fr-idea"><b>${esc(x.title)}</b><span class="fr-fine">${esc(x.platform)}</span><p>${esc(x.desc)}</p><button type="button" class="fr-btn" data-a="idea" data-i="${i}" data-fk="idea-${i}">Create a post</button></div>`).join('')}</div></section>`);
    }

    /* ── loading ── */
    async function load() {
      const seq = ++loadSeq;
      S.jgState = S.hasJG ? 'loading' : 'off'; S.jgError = '';
      S.metaState = 'loading'; S.metaError = '';
      renderOverview();
      const jgJob = !S.hasJG ? Promise.resolve() : (async () => {
        try {
          const r = await call('/api/fundraise/campaigns');
          if (!alive() || seq !== loadSeq) return;
          if (!r.ok) { S.jgState = 'error'; S.jgError = r.body.error || 'JustGiving could not be reached. Try again in a moment.'; return; }
          S.jgAll = normalizeJustGiving(r.body.campaigns, nowDate());
          S.jgState = 'ok';
        } catch (_) {
          if (!alive() || seq !== loadSeq) return;
          S.jgState = 'error'; S.jgError = 'JustGiving could not be reached. Check your connection and try again.';
        }
      })().then(afterPart);
      const metaJob = (async () => {
        try {
          const r = await call('/api/fundraise/meta');
          if (!alive() || seq !== loadSeq) return;
          const d = r.body;
          if (!r.ok) { S.metaState = 'error'; S.metaError = d.error || 'Meta fundraisers could not be loaded.'; return; }
          S.metaList = normalizeMeta(d.fundraisers);
          if (!d.meta_connected) S.metaState = 'off';
          else if (d.error) { S.metaState = d.needs_permission ? 'permission' : 'error'; S.metaError = String(d.error); }
          else S.metaState = 'ok';
        } catch (_) {
          if (!alive() || seq !== loadSeq) return;
          S.metaState = 'error'; S.metaError = 'Meta fundraisers could not be loaded.';
        }
      })().then(afterPart);
      function afterPart() {
        if (!alive() || seq !== loadSeq) return;
        const all = fundraisers();
        if (!all.find((f) => f.key === S.sel)) S.sel = all.length ? sortFundraisers(all, nowDate())[0].key : null;
        if (S.view === 'overview') renderOverview(); else renderPlaces();
      }
      await Promise.all([jgJob, metaJob]);
      if (alive() && seq === loadSeq) live(`${plural(fundraisers().length, 'fundraiser')} loaded.`);
    }

    /* ───────────── drafts ───────────── */

    function openModal(title, items, note) {
      S.opener = document.activeElement;
      S.modal = { title, items, note };
      renderModal();
      const first = $('#fr-modal textarea'); if (first) first.focus(); else { const c = $('#fr-modal [data-a="close"]'); if (c) c.focus(); }
    }

    function closeModal() {
      S.modal = null;
      $('#fr-modal').innerHTML = '';
      const o = S.opener; S.opener = null;
      if (o && o.isConnected && typeof o.focus === 'function') o.focus();
    }

    function renderModal() {
      const m = S.modal;
      if (!m) { $('#fr-modal').innerHTML = ''; return; }
      $('#fr-modal').innerHTML = `<div class="fr-ov" data-a="overlay"><div class="fr-modal" role="dialog" aria-modal="true" aria-labelledby="fr-m-t">
          <div class="fr-modal__hd"><h2 id="fr-m-t">${esc(m.title)}</h2><button type="button" class="fr-btn" data-a="close" aria-label="Close">${ICON.x}</button></div>
          <p class="fr-fine">${esc(m.note || 'These are drafts. Read each one, change it if you like, then copy it and send or post it yourself. Nothing is sent from here.')}</p>
          ${m.items.map((it, i) => `<div class="fr-draft"><div class="fr-draft__hd"><b>${esc(it.label)}</b>${it.sub ? `<span class="fr-fine">${esc(it.sub)}</span>` : ''}</div>
            <label class="fr-sr" for="fr-d-${i}">${esc(it.label)}</label><textarea id="fr-d-${i}" class="fr-in" rows="9">${esc(it.text)}</textarea>
            <div class="fr-acts"><button type="button" class="fr-btn fr-btn--signal" data-a="copy" data-i="${i}">Copy</button>${it.create ? `<button type="button" class="fr-btn" data-a="modal-create" data-i="${i}">Open in Create</button>` : ''}</div></div>`).join('')}
          ${m.more ? `<p class="fr-fine">${esc(m.more)}</p>` : ''}</div></div>`;
    }

    function draftItems(kind, list, lead) {
      const build = DRAFT_BUILDERS[kind];
      return list.slice(0, DRAFTS_SHOWN).map((f) => ({
        label: f.title, sub: f.owner || (f.source === 'meta' ? 'Meta fundraiser' : ''), text: build(f, charity, nowDate()),
        create: kind === 'share' ? { title: f.title, url: f.url } : null,
      }));
    }

    function openDraftFor(kind, list) {
      const items = draftItems(kind, list);
      if (!items.length) return;
      const m = { title: list.length === 1 ? DRAFT_TITLES[kind] : `${DRAFT_TITLES[kind].replace(' draft', ' drafts')} (${list.length})` };
      openModal(m.title, items);
      if (list.length > DRAFTS_SHOWN) { S.modal.more = `Showing the first ${DRAFTS_SHOWN} of ${list.length}.`; renderModal(); }
    }

    function openProgressDraft() {
      const camp = currentCampaign();
      if (!camp) return;
      const page = linkCampaign(camp, fundraisers());
      if (!page || page.numbersKnown === false) return;
      openModal(DRAFT_TITLES.progress, [{ label: camp.name, sub: `From ${page.title}`, text: progressDraft(camp, page, charity, nowDate()), create: { title: camp.name, url: page.url } }],
        'This is a draft built from the linked page. Check the numbers, change it if you like, then copy it and post it yourself.');
    }

    /* ───────────── the builder ───────────── */

    const blankGift = () => ({ amount: '', what: '' });

    function newBuilder(plan) {
      const t = today();
      return {
        step: 1, phase: 'edit', busy: false, err: '', status: '', posts: null, campaign: null, empty: 0, saved: null,
        form: {
          name: plan ? plan.name : '', goal: '', currency: 'GBP',
          start: plan ? plan.start : addDays(t, 1), end: plan ? plan.end : addDays(t, 7), perDay: '2',
          pickJg: '', pickMeta: '', pasteJg: '', pasteMeta: '', siteUrl: '', story: '', gifts: [blankGift(), blankGift(), blankGift()],
          facebook: true, instagram: true, thanks: true, images: false,
        },
      };
    }

    function openBuilder(plan) {
      S.view = 'builder';
      S.b = newBuilder(plan);
      $('#fr-view').innerHTML = builderShell();
      renderBuilder();
      const h = $('#fr-b-h1'); if (h) h.focus({ preventScroll: true });
      const main = document.querySelector('.dash-main'); if (main && main.scrollTo) main.scrollTo(0, 0);
    }

    function leaveBuilder() {
      if (S.b && S.b.busy) return;
      showOverview();
      const h = $('#fr-h1'); if (h) h.focus({ preventScroll: true });
    }

    const eff = () => Object.assign({}, S.b.form, { justgivingUrl: S.b.form.pickJg || S.b.form.pasteJg.trim(), metaUrl: S.b.form.pickMeta || S.b.form.pasteMeta.trim() });

    function builderShell() {
      return `<div class="fr-title"><div>
          <nav aria-label="Breadcrumb"><button type="button" class="fr-crumb" data-a="b-exit" data-fk="b-exit">Fundraise</button> <span class="fr-fine" aria-hidden="true">/</span> <span class="fr-fine" aria-current="page">Start a campaign</span></nav>
          <h1 class="fr-h1" id="fr-b-h1" tabindex="-1">Start a campaign</h1>
          <p class="fr-sub">Tell us the goal and the story. We write the posts, you review every one before it goes on your calendar.</p></div></div>
        <div class="fr-bcols">
          <div class="fr-bmain"><ol class="fr-steps" id="fr-b-steps" aria-label="Steps"></ol><div id="fr-b-sum"></div><div id="fr-b-step"></div></div>
          <aside class="fr-baside" id="fr-b-aside" aria-label="Preview"></aside>
        </div>`;
    }

    function renderBuilder() {
      if (S.view !== 'builder' || !S.b) return;
      renderSteps(); renderSummary(); renderStep(); renderAside();
    }

    function renderSteps() {
      const B = S.b;
      const defs = [['1', 'Basics'], ['2', 'Story and impact'], ['3', 'Review and add to calendar']];
      renderInto($('#fr-b-steps'), defs.map(([n, label]) => {
        const k = Number(n);
        const done = k < B.step || (k === 3 && B.saved);
        const cur = k === B.step;
        const canGo = k < B.step && !B.busy && !B.saved;
        return `<li><button type="button" class="fr-step${done ? ' is-done' : ''}" data-a="b-step" data-n="${n}" data-fk="step-${n}"${cur ? ' aria-current="step"' : ''}${canGo ? '' : ' disabled'}><i aria-hidden="true">${done && !cur ? '✓' : n}</i>${esc(label)}${done && !cur ? '<span class="fr-sr"> (done)</span>' : ''}</button></li>`;
      }).join(''));
    }

    function platformsText(f) {
      const p = []; if (f.facebook) p.push('Facebook'); if (f.instagram) p.push('Instagram');
      return p.length ? p.join(' and ') : 'No platform picked';
    }

    function renderSummary() {
      const B = S.b; const f = B.form;
      if (B.step === 1) { $('#fr-b-sum').innerHTML = ''; return; }
      const days = diffDays(f.start, f.end);
      $('#fr-b-sum').innerHTML = `<section class="fr-card fr-sum" aria-label="Campaign basics"><span><b>${esc(f.name || 'Your campaign')} · ${esc(formatMoney(Number(f.goal) || 0, f.currency))}</b>
          <span class="fr-fine">${esc(formatDate(f.start))} to ${esc(formatDate(f.end))}${days != null && days >= 0 ? ` · ${plural(Number(f.perDay) || 2, 'post')} a day` : ''} · ${esc(platformsText(f))}</span></span>
          ${B.saved || B.busy ? '' : '<button type="button" class="fr-link" data-a="b-step" data-n="1" data-fk="edit-basics">Edit basics</button>'}</section>`;
    }

    function renderStep() {
      const B = S.b;
      const host = $('#fr-b-step');
      host.innerHTML = B.step === 1 ? step1Html() : B.step === 2 ? step2Html() : step3Html();
      if (B.step === 2) { renderPlaces(); const gh = $('#fr-gifts'); if (gh) gh.innerHTML = giftsHtml(); }
    }

    function field(label, inner, cls) { return `<label class="fr-field${cls ? ' ' + cls : ''}"><span>${esc(label)}</span>${inner}</label>`; }

    function step1Html() {
      const f = S.b.form;
      const n = diffDays(f.start, f.end);
      const t = today();
      return `<section class="fr-bcard" aria-labelledby="fr-s-h"><h2 class="fr-h2" id="fr-s-h">Basics</h2>
          <div class="fr-form">
            ${field('Campaign name', `<input class="fr-in" data-f="name" type="text" maxlength="120" value="${esc(f.name)}" placeholder="e.g. Three Weeks Appeal" autocomplete="off">`)}
            ${field('Goal', `<input class="fr-in" data-f="goal" type="number" min="1" step="1" inputmode="numeric" value="${esc(f.goal)}" placeholder="2000">`)}
            ${field('Currency', `<select class="fr-in" data-f="currency">${['GBP', 'USD', 'EUR'].map((c) => `<option${c === f.currency ? ' selected' : ''}>${c}</option>`).join('')}</select>`)}
            ${field('Start', `<input class="fr-in" data-f="start" type="date" min="${esc(t)}" value="${esc(f.start)}">`)}
            ${field('End', `<input class="fr-in" data-f="end" type="date" min="${esc(t)}" value="${esc(f.end)}">`)}
            ${field('Posts per day', `<select class="fr-in" data-f="perDay">${[1, 2, 3].map((c) => `<option value="${c}"${String(c) === String(f.perDay) ? ' selected' : ''}>${c}</option>`).join('')}</select>`)}
          </div>
          <p class="fr-err" id="fr-b-err" role="alert">${esc(S.b.err)}</p>
          <div class="fr-bacts"><button type="button" class="fr-btn fr-btn--signal fr-btn--lg" data-a="b-next" data-fk="b-next">Continue</button>
            <span class="fr-fine">Campaigns can run for up to ${CAMPAIGN_MAX_DAYS} days.${n != null && n >= 0 ? ` This one runs for ${plural(n + 1, 'day')}.` : ''}</span></div></section>`;
    }

    function step2Html() {
      const f = S.b.form;
      const host = siteHost(deps.website);
      return `<section class="fr-bcard" aria-labelledby="fr-s-h"><h2 class="fr-h2" id="fr-s-h">Story and impact</h2>
          <div class="fr-field"><span class="fr-fl" id="fr-pl-l">Where do people give?</span><div class="fr-places" id="fr-places" role="group" aria-labelledby="fr-pl-l"></div>
            <span class="fr-fine">Choose where the posts send people. Instagram posts say "Link in bio", Facebook posts carry the link.</span></div>
          ${field('What is this campaign for?', `<textarea class="fr-in" data-f="story" rows="4" maxlength="${STORY_MAX}" aria-describedby="fr-story-n">${esc(f.story)}</textarea><span class="fr-fine" style="display:flex;justify-content:space-between;gap:8px"><span>Real details only. The writer will not invent any.</span><span id="fr-story-n">${f.story.length} of ${STORY_MAX.toLocaleString('en-GB')}</span></span>`)}
          <div class="fr-field"><span class="fr-fl" id="fr-gl">What does a gift do?</span><div id="fr-gifts" role="group" aria-labelledby="fr-gl"></div>
            <button type="button" class="fr-link" style="align-self:flex-start" data-a="b-addgift" data-fk="addgift">Add another</button>
            <span class="fr-fine">Only list what a gift really does. If you leave this empty, posts will not mention amounts.</span></div>
          <div class="fr-field"><span class="fr-fl" id="fr-ol">Platforms and extras</span><div class="fr-opts" role="group" aria-labelledby="fr-ol">
            ${[['facebook', 'Facebook'], ['instagram', 'Instagram'], ['thanks', 'Thank-you post the day after'], ['images', 'Generate pictures']].map(([k, l]) => `<label class="fr-opt"><input type="checkbox" data-f="${k}"${f[k] ? ' checked' : ''}>${esc(l)}</label>`).join('')}</div>
            <span class="fr-fine">Pictures are made after the posts are saved. ${host ? '' : 'Add your website in Settings to link your own donation page.'}</span></div>
          <p class="fr-err" id="fr-b-err" role="alert">${esc(S.b.err)}</p>
          <div class="fr-bacts"><button type="button" class="fr-btn fr-btn--signal fr-btn--lg" data-a="b-write" data-fk="b-write">Write the posts</button>
            <button type="button" class="fr-btn fr-btn--lg" data-a="b-back" data-fk="b-back">Back</button>
            <span class="fr-fine">Takes about a minute. Nothing goes on your calendar until you approve it.</span></div></section>`;
    }

    function giftsHtml() {
      const f = S.b.form;
      return f.gifts.map((g, i) => `<div class="fr-gift" style="margin-bottom:8px">
          <input class="fr-in" data-gi="${i}" data-gk="amount" type="text" value="${esc(g.amount)}" placeholder="${['£10', '£25', '£50', '£100', '£250', '£500'][i] || '£25'}" aria-label="Gift amount, line ${i + 1}" autocomplete="off">
          <input class="fr-in" data-gi="${i}" data-gk="what" type="text" maxlength="160" value="${esc(g.what)}" placeholder="What it does, e.g. one support call" aria-label="What that gift does, line ${i + 1}" autocomplete="off">
          ${f.gifts.length > 1 ? `<button type="button" class="fr-btn" data-a="b-delgift" data-i="${i}" aria-label="Remove gift line ${i + 1}">${ICON.x}</button>` : ''}</div>`).join('');
    }

    function placeRow({ id, on, off, title, sub, chip, input, kind }) {
      return `<div class="fr-place${on ? ' is-on' : ''}${off ? ' is-off' : ''}">
          ${kind ? `<input type="checkbox" id="${esc(id)}" data-fk="${esc(id)}" data-pick="${esc(kind.source)}" data-url="${esc(kind.url)}"${on ? ' checked' : ''}${off ? ' disabled' : ''} aria-describedby="${esc(id)}-d">` : ''}
          <span class="fr-place__t"><b>${kind ? `<label for="${esc(id)}">${esc(title)}</label>` : esc(title)}</b><span id="${esc(id)}-d">${esc(sub)}</span>${input || ''}</span>
          ${chip ? `<span class="fr-tag${on ? ' fr-tag--sig' : ''}">${esc(chip)}</span>` : ''}</div>`;
    }

    function renderPlaces() {
      const host = $('#fr-places');
      if (!host || !S.b) return;
      const f = S.b.form;
      const rows = [];
      const jg = S.jgAll.filter((x) => x.active && x.url);
      if (S.jgState === 'loading') rows.push(placeRow({ id: 'pl-jg-l', off: true, title: 'JustGiving pages', sub: 'Loading your pages' }));
      else if (S.jgState === 'off') rows.push(placeRow({ id: 'pl-jg-o', off: true, title: 'JustGiving', sub: 'Not connected. Add your charity ID on the Fundraise page.', chip: 'Not connected' }));
      else if (S.jgState === 'error') rows.push(placeRow({ id: 'pl-jg-e', off: true, title: 'JustGiving pages', sub: 'Could not be loaded. You can paste a link below.', chip: 'Unavailable' }));
      else if (!jg.length) rows.push(placeRow({ id: 'pl-jg-n', off: true, title: 'JustGiving pages', sub: 'No active pages to choose from yet.' }));
      sortFundraisers(jg, nowDate()).slice(0, 12).forEach((x, i) => {
        const on = f.pickJg === x.url;
        rows.push(placeRow({ id: `pl-jg-${i}`, on, title: `JustGiving: ${x.title}`, sub: `${formatMoney(x.raised, x.currency)} raised so far · ${x.url.replace(/^https?:\/\/(www\.)?/, '')}`, chip: on ? 'Selected' : '', kind: { source: 'jg', url: x.url } }));
      });
      if (jg.length > 12) rows.push(`<p class="fr-fine">Showing 12 of ${jg.length}. Paste a link below for any other page.</p>`);
      rows.push(placeRow({ id: 'pl-own', on: !!f.siteUrl.trim(), title: 'Your donation page', sub: siteHost(deps.website) ? `On your website, ${siteHost(deps.website)}` : 'Add your website in Settings to use this', chip: f.siteUrl.trim() ? 'Also link' : '',
        input: `<input class="fr-in" data-fk="own-url" data-f="siteUrl" type="url" value="${esc(f.siteUrl)}" placeholder="https://${esc(siteHost(deps.website) || 'www.yourcharity.org')}/donate" aria-label="Your own donation page link">` }));
      const meta = S.metaList.filter((x) => x.url);
      if (S.metaState === 'ok' && meta.length) {
        meta.slice(0, 6).forEach((x, i) => {
          const on = f.pickMeta === x.url;
          rows.push(placeRow({ id: `pl-meta-${i}`, on, title: `Facebook fundraiser: ${x.title}`, sub: `${formatMoney(x.raised, x.currency)} raised so far`, chip: on ? 'Selected' : '', kind: { source: 'meta', url: x.url } }));
        });
      } else {
        const why = S.metaState === 'loading' ? 'Loading your fundraisers' : S.metaState === 'permission' ? 'Needs the Meta fundraisers permission in Settings' : S.metaState === 'off' ? 'Connect your Facebook Page in Settings' : S.metaState === 'error' ? 'Could not be loaded' : 'No fundraisers found on your connected account';
        rows.push(placeRow({ id: 'pl-meta-o', off: true, title: 'Facebook fundraiser', sub: why, chip: S.metaState === 'loading' ? '' : 'Not connected' }));
      }
      rows.push(`<details class="fr-place" style="display:block"><summary style="cursor:pointer">Link a page that is not listed</summary>
          <div class="fr-form" style="margin-top:10px">${field('JustGiving link', `<input class="fr-in" data-f="pasteJg" type="url" value="${esc(f.pasteJg)}" placeholder="https://www.justgiving.com/page/...">`)}${field('Facebook fundraiser link', `<input class="fr-in" data-f="pasteMeta" type="url" value="${esc(f.pasteMeta)}" placeholder="https://www.facebook.com/donate/...">`)}</div></details>`);
      const open = host.querySelector('details') && host.querySelector('details').open;
      renderInto(host, rows.join(''));
      if (open) { const d = host.querySelector('details'); if (d) d.open = true; }
    }

    /* ── step 3 ── */
    function step3Html() {
      const B = S.b;
      if (B.saved) {
        const s = B.saved;
        return `<section class="fr-bcard" aria-labelledby="fr-s-h"><h2 class="fr-h2" id="fr-s-h" tabindex="-1">Added to your calendar</h2>
          <p>Added ${plural(s.created, 'post')} to your calendar${s.needs ? `, and ${s.needs} ${s.needs === 1 ? 'is' : 'are'} saved as Draft until you fill in the numbers` : ''}. Nothing publishes until you approve it in Review.</p>
          ${s.skipped ? `<p class="fr-fine">${plural(s.skipped, 'post')} could not be saved because ${s.skipped === 1 ? 'it was' : 'they were'} empty.</p>` : ''}
          <div class="fr-bacts"><button type="button" class="fr-btn fr-btn--signal fr-btn--lg" data-a="b-review" data-fk="b-review">Open Review</button><button type="button" class="fr-btn fr-btn--lg" data-a="b-exit" data-fk="b-done">Back to Fundraise</button></div></section>`;
      }
      if (B.phase === 'previewing') {
        return `<section class="fr-bcard" aria-labelledby="fr-s-h" aria-busy="true"><h2 class="fr-h2" id="fr-s-h" tabindex="-1">Writing your campaign</h2>
          <p><span class="fr-spin" aria-hidden="true"></span> Writing your campaign, this takes about a minute. You can read and change every post before it is saved.</p></section>`;
      }
      if (B.phase === 'failed' || !B.posts) {
        return `<section class="fr-bcard" aria-labelledby="fr-s-h"><h2 class="fr-h2" id="fr-s-h" tabindex="-1">The posts could not be written</h2>
          <p class="fr-err" role="alert">${esc(B.err || 'Could not write the campaign.')}</p>
          <div class="fr-bacts"><button type="button" class="fr-btn fr-btn--signal fr-btn--lg" data-a="b-write" data-fk="b-write">Try again</button><button type="button" class="fr-btn fr-btn--lg" data-a="b-back" data-fk="b-back">Back</button></div></section>`;
      }
      let lastDate = '';
      const rows = B.posts.map((p, i) => {
        let head = '';
        if (p.date !== lastDate) { lastDate = p.date; head = `<h3 class="fr-daybar">${esc(formatDate(p.date, { long: true }))} · ${esc(PHASE_LABEL[p.phase] || p.phase)}</h3>`; }
        return `${head}<div class="fr-post"><div class="fr-post__hd"><span><b>${esc(p.platform)}</b> · ${esc(p.time)}</span>${p.needs_numbers ? '<span style="color:var(--fr-warn);font-weight:600">Needs a number, saves as Draft</span>' : ''}</div>
          <label class="fr-sr" for="fr-pc-${i}">Post ${i + 1} text</label><textarea id="fr-pc-${i}" class="fr-in" rows="7" data-pi="${i}" data-pk="caption">${esc(p.caption)}</textarea>
          <label class="fr-sr" for="fr-ph-${i}">Post ${i + 1} hashtags</label><input id="fr-ph-${i}" class="fr-in" data-pi="${i}" data-pk="hashtags" value="${esc(p.hashtags)}">
          <label class="fr-sr" for="fr-pf-${i}">Post ${i + 1} first comment</label><input id="fr-pf-${i}" class="fr-in" data-pi="${i}" data-pk="first_comment" value="${esc(p.first_comment)}" placeholder="First comment">
          ${p.reel_idea ? `<p class="fr-fine"><b>Reel idea:</b> ${esc(p.reel_idea)}</p>` : ''}${p.image_prompt ? `<p class="fr-fine"><b>Visual:</b> ${esc(p.image_prompt)}</p>` : ''}</div>`;
      }).join('');
      return `<section class="fr-bcard" aria-labelledby="fr-s-h"><h2 class="fr-h2" id="fr-s-h" tabindex="-1">Review and add to calendar</h2>
          <p class="fr-fine">${B.empty ? `${plural(B.empty, 'post')} came back empty. Write ${B.empty === 1 ? 'it' : 'them'} in, or write the campaign again.` : 'Read each post and change anything you like. Nothing goes on your calendar until you add it.'}</p>
          ${rows}
          <p class="fr-err" id="fr-b-err" role="alert">${esc(B.err)}</p>
          <div class="fr-bacts"><button type="button" class="fr-btn fr-btn--signal fr-btn--lg" data-a="b-save" data-fk="b-save">Add ${B.posts.length} posts to calendar</button>
            <button type="button" class="fr-btn fr-btn--lg" data-a="b-back" data-fk="b-back">Back</button>
            <span class="fr-fine" id="fr-b-status">Posts go to Review. Nothing publishes until you approve it.</span></div></section>`;
    }

    /* ── the preview beside the builder ── */
    function samplePost(f) {
      const plat = f.facebook ? 'facebook' : f.instagram ? 'instagram' : '';
      const e = eff();
      const sentence = String(f.story || '').trim().split(/(?<=[.!?])\s+/)[0] || '';
      const gifts = impactLines(f.gifts, f.currency);
      const link = plat === 'facebook' ? (e.metaUrl || f.siteUrl.trim() || e.justgivingUrl) : (f.siteUrl.trim() || e.justgivingUrl || e.metaUrl);
      const ending = !plat ? '' : plat === 'instagram' ? 'Link in bio to donate.' : (link ? `Give here: ${link}` : 'The donate link goes here.');
      const tags = String(deps.brandHashtags || '').trim();
      return { plat, sentence: sentence.slice(0, 180), gift: gifts.lines[0] || '', ending, tags };
    }

    function renderAside() {
      const B = S.b; if (!B) return;
      const f = B.form;
      const plan = timelinePlan({ start: f.start, end: f.end, perDay: f.perDay, thanks: f.thanks });
      let tl;
      if (!plan) {
        const n = diffDays(f.start, f.end);
        tl = `<p class="fr-fine">${n != null && n + 1 > CAMPAIGN_MAX_DAYS ? `Campaigns can run for up to ${CAMPAIGN_MAX_DAYS} days. Shorten the dates to see your plan.` : 'Pick a start and end date to see your days.'}</p>`;
      } else {
        tl = `<div class="fr-strip" aria-hidden="true">${plan.days.map((d) => `<span title="${esc(`Day ${d.day}: ${PHASE_LABEL[d.phase]}`)}" style="background:color-mix(in srgb, var(--fr-c${PHASE_ORDER.indexOf(d.phase)}) 22%, transparent);border-color:var(--fr-c${PHASE_ORDER.indexOf(d.phase)})"></span>`).join('')}</div>
          <div>${plan.legend.map((l) => `<div class="fr-leg"><i aria-hidden="true" style="background:color-mix(in srgb, var(--fr-c${l.index}) 22%, transparent);border-color:var(--fr-c${l.index})"></i><span>${esc(l.name)}</span><span class="fr-fine">${esc(l.when)}</span><b>${l.posts}</b></div>`).join('')}</div>`;
      }
      const sp = samplePost(f);
      const launch = plan ? plan.days[0] : null;
      const meta = launch && sp.plat ? `Launch · ${formatDate(launch.date)}, ${formatClock(SLOT_TIMES[sp.plat])} · ${PLATFORM_NAME[sp.plat]}` : 'Launch';
      $('#fr-b-aside').innerHTML = `<section class="fr-card" aria-labelledby="fr-tl-h"><div class="fr-hd"><h2 class="fr-h2" id="fr-tl-h">${plan ? `Your ${plural(plan.dayCount, 'day')}` : 'Your days'}</h2><span class="fr-fine">${plan ? plural(plan.posts, 'post') : ''}</span></div>${tl}</section>
        <section class="fr-card" aria-labelledby="fr-sm-h"><div class="fr-hd"><h2 class="fr-h2" id="fr-sm-h">What a post looks like</h2><span class="fr-fine">Sample layout</span></div>
          <div class="fr-sample"><span class="fr-fine">${esc(meta)}</span>
            <p${sp.sentence ? '' : ' class="is-ph"'}>${esc(sp.sentence || 'The first line of your story opens the post.')}</p>
            ${sp.gift ? `<p>${esc(sp.gift)}</p>` : ''}${sp.ending ? `<p>${esc(sp.ending)}</p>` : ''}${sp.tags ? `<span class="fr-fine">${esc(sp.tags)}</span>` : ''}</div>
          <p class="fr-fine">This only shows the layout, using what you have typed. The real posts are written in the last step and you can change every word. A post that needs a figure you have not given us is marked "needs a number" and saved as a Draft. We never make one up.</p></section>`;
    }

    /* ── builder actions ── */
    function setErr(msg) {
      S.b.err = msg || '';
      const el = $('#fr-b-err'); if (el) el.textContent = S.b.err;
    }

    function goStep(n) {
      S.b.step = n; S.b.err = '';
      renderBuilder();
      const h = $('#fr-s-h'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }

    function next() {
      const err = basicsError(S.b.form, today());
      if (err) { setErr(err); return; }
      goStep(2);
    }

    async function writePosts() {
      const B = S.b;
      if (B.busy) return;
      const e1 = basicsError(B.form, today());
      if (e1) { goStep(1); setErr(e1); return; }
      const e2 = storyError(eff(), { website: deps.website });
      if (e2) { setErr(e2); return; }
      B.busy = true; B.phase = 'previewing'; B.err = ''; B.posts = null; B.step = 3;
      renderBuilder();
      live('Writing your campaign. This takes about a minute.');
      try {
        const r = await call('/api/fundraise/campaign/preview', { method: 'POST', body: campaignPayload(eff()) });
        if (!alive() || S.b !== B) return;
        if (!r.ok) throw new Error(r.body.error || 'Could not write the campaign.');
        B.campaign = r.body.campaign; B.posts = Array.isArray(r.body.posts) ? r.body.posts : []; B.empty = Number(r.body.empty) || 0;
        if (!B.posts.length) throw new Error('No posts came back. Try again in a minute.');
        B.phase = 'review'; B.err = '';
        live('Your posts are ready to review.');
      } catch (e) {
        if (!alive() || S.b !== B) return;
        B.phase = 'failed'; B.err = e.message || 'Could not write the campaign.';
      } finally {
        if (S.b === B) { B.busy = false; if (alive()) { renderBuilder(); const h = $('#fr-s-h'); if (h) h.focus({ preventScroll: true }); } }
      }
    }

    async function savePosts() {
      const B = S.b;
      if (B.busy || B.saved || !B.posts) return;
      B.busy = true; B.err = '';
      const btn = $('[data-a="b-save"]'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="fr-spin" aria-hidden="true"></span>Saving'; }
      const st = $('#fr-b-status'); if (st) st.textContent = 'Saving…';
      try {
        const r = await call('/api/fundraise/campaign/create', { method: 'POST', body: { campaign: B.campaign, posts: B.posts, generate_images: !!B.form.images } });
        if (!alive() || S.b !== B) return;
        if (!r.ok) throw new Error(r.body.error || 'Could not save the campaign.');
        B.saved = { created: Number(r.body.created) || 0, needs: Number(r.body.needs_numbers) || 0, skipped: Array.isArray(r.body.skipped) ? r.body.skipped.length : (Number(r.body.skipped) || 0) };
        toast('Campaign added to your calendar');
        live(`Added ${plural(B.saved.created, 'post')} to your calendar.`);
        if (typeof deps.refreshPosts === 'function') { try { await deps.refreshPosts(); } catch (_) { /* the tracker catches up on the next visit */ } }
      } catch (e) {
        if (!alive() || S.b !== B) return;
        B.err = e.message || 'Could not save the campaign.';
      } finally {
        if (S.b === B) { B.busy = false; if (alive()) { renderBuilder(); const h = $('#fr-s-h'); if (h) h.focus({ preventScroll: true }); if (B.err) { const el = $('#fr-b-err'); if (el) el.textContent = B.err; } } }
      }
    }

    /* ── connecting JustGiving ── */
    async function connect() {
      if (S.connectBusy) return;
      const input = $('#fr-cid');
      const id = input && input.value ? input.value.trim() : '';
      if (!id) { S.connectErr = 'Enter your JustGiving charity ID.'; renderConnect(); const i = $('#fr-cid'); if (i) i.focus(); return; }
      S.connectBusy = true; S.connectErr = ''; renderConnect();
      try {
        const r = await call('/api/fundraise/save-charity-id', { method: 'POST', body: { justgiving_charity_id: id } });
        if (!alive()) return;
        if (!r.ok) throw new Error(r.body.error || 'Could not save. Please try again.');
        S.hasJG = true; S.connectBusy = false;
        if (typeof deps.onCharityIdSaved === 'function') deps.onCharityIdSaved(id);
        toast('JustGiving connected');
        load();
      } catch (e) {
        if (!alive()) return;
        S.connectBusy = false; S.connectErr = e.message || 'Could not save. Please try again.';
        renderConnect();
      }
    }

    /* ───────────── events ───────────── */

    const stackedAside = () => { const a = $('.fr-aside'); const m = $('.fr-main'); return !!(a && m && a.getBoundingClientRect().top >= m.getBoundingClientRect().bottom - 2); };

    root.addEventListener('click', (ev) => {
      const t = ev.target.closest ? ev.target.closest('[data-a]') : null;
      if (!t || !root.contains(t)) return;
      const a = t.getAttribute('data-a');
      if (a === 'overlay') { if (ev.target === t) closeModal(); return; }
      if (a === 'close') { closeModal(); return; }
      if (a === 'copy') {
        const i = Number(t.getAttribute('data-i'));
        const ta = $(`#fr-d-${i}`);
        if (!ta) return;
        copyText(ta.value).then((ok) => {
          if (!alive()) return;
          if (ok) {
            t.textContent = 'Copied'; live('Copied to the clipboard.');
            clearTimeout(copyTimer); copyTimer = setTimeout(() => { if (t.isConnected) t.textContent = 'Copy'; }, 2000);
          } else { ta.focus(); ta.select(); live('Could not copy. The text is selected, so you can copy it yourself.'); toast('Could not copy. Select the text and copy it yourself.', 'warning'); }
        });
        return;
      }
      if (a === 'modal-create') {
        const it = S.modal && S.modal.items[Number(t.getAttribute('data-i'))];
        if (it && it.create) { const c = it.create; S.modal = null; $('#fr-modal').innerHTML = ''; S.opener = null; create.content(c.title, c.url); }
        return;
      }
      if (a === 'start') { openBuilder(); return; }
      if (a === 'b-exit') { leaveBuilder(); return; }
      if (a === 'settings') { goTo('settings'); return; }
      if (a === 'retry') { load(); return; }
      if (a === 'connect') { connect(); return; }
      if (a === 'plan') { const m = keyDates(nowDate()).find((x) => x.id === t.getAttribute('data-id')); if (m && m.plan) openBuilder(m.plan); return; }
      if (a === 'need') {
        const c = (S.cards || []).find((x) => x.id === t.getAttribute('data-id'));
        if (!c) return;
        if (c.kind === 'plan') { if (c.moment && c.moment.plan) openBuilder(c.moment.plan); return; }
        openDraftFor(c.kind, c.keys.map(byKey).filter(Boolean));
        return;
      }
      if (a === 'filter') { S.filter = t.getAttribute('data-id'); S.showAll = false; renderList(); const n = applyFilter(fundraisers(), S.filter, nowDate()).length; live(`${plural(n, 'fundraiser')} shown.`); return; }
      if (a === 'showall') { S.showAll = true; renderList(); return; }
      if (a === 'select') {
        S.sel = t.getAttribute('data-key'); renderList(); renderDetail();
        const f = byKey(S.sel); if (f) live(`Showing details for ${f.title}.`);
        if (stackedAside()) { const d = $('#fr-detail'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        return;
      }
      if (a === 'move') { const f = byKey(t.getAttribute('data-key')); if (f) openDraftFor(t.getAttribute('data-draft'), [f]); return; }
      if (a === 'create-content') { const f = byKey(t.getAttribute('data-key')); if (f) create.content(f.title, f.url); return; }
      if (a === 'create-ad') { const f = byKey(t.getAttribute('data-key')); if (f) create.ad(f.title, f.url); return; }
      if (a === 'idea') { const x = IDEAS[Number(t.getAttribute('data-i'))]; if (x) create.content(`${x.title} for ${charity}`, ''); return; }
      if (a === 'camp-posts') { goTo('content'); return; }
      if (a === 'camp-progress') { openProgressDraft(); return; }
      if (a === 'camp-ad') { const c = currentCampaign(); if (c) { const p = linkCampaign(c, fundraisers()); create.ad(c.name, (p && p.url) || c.links[0] || ''); } return; }
      if (!S.b) return;
      if (a === 'b-step') { if (S.b.busy) return; const n = Number(t.getAttribute('data-n')); if (n < S.b.step) goStep(n); return; }
      if (a === 'b-next') { next(); return; }
      if (a === 'b-back') { if (!S.b.busy) goStep(Math.max(1, S.b.step - 1)); return; }
      if (a === 'b-write') { writePosts(); return; }
      if (a === 'b-save') { savePosts(); return; }
      if (a === 'b-review') { goTo('content'); return; }
      if (a === 'b-addgift') { if (S.b.form.gifts.length < IMPACT_MAX) { S.b.form.gifts.push(blankGift()); const gh = $('#fr-gifts'); if (gh) gh.innerHTML = giftsHtml(); const ins = gh && gh.querySelectorAll('input[data-gk="amount"]'); if (ins && ins.length) ins[ins.length - 1].focus(); } return; }
      if (a === 'b-delgift') { const i = Number(t.getAttribute('data-i')); S.b.form.gifts.splice(i, 1); if (!S.b.form.gifts.length) S.b.form.gifts.push(blankGift()); const gh = $('#fr-gifts'); if (gh) gh.innerHTML = giftsHtml(); renderAside(); return; }
    });

    function onField(t) {
      if (!S.b) return;
      const f = S.b.form;
      if (t.hasAttribute('data-pick')) {
        const k = t.getAttribute('data-pick') === 'jg' ? 'pickJg' : 'pickMeta';
        f[k] = t.checked ? t.getAttribute('data-url') : '';
        renderPlaces(); renderAside();
        return;
      }
      if (t.hasAttribute('data-gi')) {
        const g = f.gifts[Number(t.getAttribute('data-gi'))];
        if (g) g[t.getAttribute('data-gk')] = t.value;
        renderAside();
        return;
      }
      if (t.hasAttribute('data-pi')) {
        const p = S.b.posts && S.b.posts[Number(t.getAttribute('data-pi'))];
        if (p) p[t.getAttribute('data-pk')] = t.value;
        return;
      }
      const k = t.getAttribute('data-f');
      if (!k) return;
      f[k] = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'story') { const n = $('#fr-story-n'); if (n) n.textContent = `${f.story.length} of ${STORY_MAX.toLocaleString('en-GB')}`; }
      if (S.b.err) setErr('');
      if (S.b.step === 2 && (k === 'siteUrl')) renderPlacesLight();
      renderAside();
      if (S.b.step > 1) renderSummary();
    }
    // The own-page chip changes as you type; the input keeps focus because only the chip is touched.
    function renderPlacesLight() {
      const row = $('#fr-places .fr-place:has([data-f="siteUrl"])'); if (!row) return;
      const on = !!S.b.form.siteUrl.trim();
      row.classList.toggle('is-on', on);
      const tag = row.querySelector('.fr-tag');
      if (on && !tag) { const s = document.createElement('span'); s.className = 'fr-tag fr-tag--sig'; s.textContent = 'Also link'; row.appendChild(s); }
      else if (!on && tag) tag.remove();
    }

    root.addEventListener('input', (ev) => { const t = ev.target; if (t && t.matches && t.matches('[data-f],[data-gi],[data-pi]') && t.type !== 'checkbox') onField(t); });
    root.addEventListener('change', (ev) => { const t = ev.target; if (t && t.matches && t.matches('[data-f],[data-pick],[data-gi],[data-pi]')) onField(t); });

    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target && ev.target.id === 'fr-cid') { ev.preventDefault(); connect(); return; }
      if (ev.key === 'Enter' && S.view === 'builder' && S.b && S.b.step === 1 && ev.target && ev.target.matches && ev.target.matches('input[data-f]')) { ev.preventDefault(); next(); return; }
      if (!S.modal) return;
      if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
      if (ev.key === 'Tab') {
        const box = $('#fr-modal .fr-modal'); if (!box) return;
        const els = Array.from(box.querySelectorAll('button, textarea, a[href]')).filter((e) => !e.disabled);
        if (!els.length) return;
        const first = els[0]; const last = els[els.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        else if (!box.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
      }
    });

    function destroy() {
      dead = true;
      clearTimeout(copyTimer);
      if (active && active.destroy === destroy) active = null;
    }
    active = { destroy };

    showOverview();
    load();
  }

  if (typeof window !== 'undefined') {
    global.renderFundraisePage = mount;
    global.seFundraise = { helpers };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
})(typeof window !== 'undefined' ? window : globalThis);
