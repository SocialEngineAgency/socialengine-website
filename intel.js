/* Intel: the competitor watchlist.
 *
 * The user adds a competitor (that runs the first check) and presses "Check now" to look again.
 * Nothing runs on a schedule. The page shows what changed, how you compare (measured values, no
 * overall score), how often each side posts, and a few moves that point back to the findings.
 *
 * portal.html keeps the tier gates and calls:
 *   window.renderIntel(contentEl, { api, apiFetch, variant, clientType, clientName, toast, switchNav, confirm })
 *
 * API (all through apiFetch):
 *   GET    /api/intel                          list, limit, page_checks
 *   POST   /api/intel/competitors              { url }  -> 201 { competitor }
 *   DELETE /api/intel/competitors/:id
 *   POST   /api/intel/competitors/:id/check    -> 202 { competitor } | 429 { error, retry_at }
 *   GET    /api/intel/competitors/:id          findings, compare, rhythm, moves
 *   POST   /api/intel/competitors/:id/report    the written report, built from what the checks found
 *
 * The pure helpers at the top are exported for node tests (intel.test.js).
 */
(function (global) {
  'use strict';

  const POLL_MS = 4000;
  const GIVE_UP_MS = 3 * 60 * 1000;
  const DAYS = 28;
  const SAVED_KEY = 'se_intel_saved';
  const DISMISSED_KEY = 'se_intel_dismissed';
  const MAX_TIMEOUT = 2147483000;

  /* ───────────────────────── pure helpers ───────────────────────── */

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Only http(s) links are ever put in an href. Returns '' for anything else. */
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!/^https?:\/\//i.test(s)) return '';
    try { return new URL(s).href; } catch (_) { return ''; }
  }

  const count = (n) => { const x = Math.floor(Number(n)); return Number.isFinite(x) && x > 0 ? x : 0; };

  /** "You are ahead on 2, behind on 3, level on 1. 2 could not be found." Only words and numbers from the data. */
  function standingSummary(st) {
    const s = st || {};
    const lead = count(s.lead); const behind = count(s.behind); const even = count(s.even); const unknown = count(s.unknown);
    const parts = [];
    if (lead) parts.push(`ahead on ${lead}`);
    if (behind) parts.push(`behind on ${behind}`);
    if (even) parts.push(`level on ${even}`);
    const lost = unknown ? `${unknown} could not be found.` : '';
    if (parts.length) return `You are ${parts.join(', ')}.${lost ? ' ' + lost : ''}`;
    return lost ? `Nothing to compare yet. ${lost}` : '';
  }

  function toDate(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** "Oct 21" in the viewer's own format. opts.locale / opts.timeZone are for tests. */
  function formatDay(iso, opts) {
    const d = toDate(iso);
    if (!d) return '';
    const o = opts || {};
    return d.toLocaleDateString(o.locale, { month: 'short', day: 'numeric', timeZone: o.timeZone });
  }

  /** "Oct 21, 3:14 PM" */
  function formatDateTime(iso, opts) {
    const d = toDate(iso);
    if (!d) return '';
    const o = opts || {};
    return d.toLocaleString(o.locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: o.timeZone });
  }

  function formatTime(iso, opts) {
    const d = toDate(iso);
    if (!d) return '';
    const o = opts || {};
    return d.toLocaleTimeString(o.locale, { hour: 'numeric', minute: '2-digit', timeZone: o.timeZone });
  }

  const dayKey = (d, tz, locale) => d.toLocaleDateString(locale || 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });

  /** "3:40 PM" when it is today, otherwise "Oct 24, 3:40 PM". */
  function availableLabel(iso, now, opts) {
    const d = toDate(iso);
    if (!d) return '';
    const n = toDate(now) || new Date();
    const o = opts || {};
    return dayKey(d, o.timeZone) === dayKey(n, o.timeZone) ? formatTime(d, o) : formatDateTime(d, o);
  }

  /** Milliseconds until a new check is allowed; 0 when it is allowed now. A failed check can always be retried. */
  function cooldownMs(c, now) {
    if (c && c.status === 'failed') return 0;
    const t = toDate(c && c.next_check_allowed_at);
    if (!t) return 0;
    const left = t.getTime() - (toDate(now) || new Date()).getTime();
    return left > 0 ? left : 0;
  }

  function initials(name) {
    const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  /** The chip on a watchlist card: { text, tone } */
  function chipFor(c) {
    if (!c) return { text: '', tone: 'neu' };
    if (c.status === 'checking') return { text: 'Checking', tone: 'sig' };
    if (c.status === 'failed') return { text: 'Check failed', tone: 'warn' };
    const n = count(c.finding_count);
    if (!n) return { text: 'No changes', tone: 'neu' };
    return { text: n === 1 ? '1 change' : `${n} changes`, tone: 'sig' };
  }

  const GROUPS = [
    { id: 'pages', kinds: ['new_page', 'collection'], label: () => 'Pages' },
    { id: 'give', kinds: ['giving_page', 'price'], label: (v) => (v === 'charity' ? 'Giving page' : v === 'store' ? 'Prices' : 'Giving or prices') },
    { id: 'social', kinds: ['social', 'followers'], label: () => 'Social' },
    { id: 'site', kinds: ['homepage'], label: () => 'Website' },
  ];

  /** Tabs for the findings: All, then one per group that has findings. [] when there are none. */
  function groupFindings(findings, variant) {
    const list = Array.isArray(findings) ? findings : [];
    if (!list.length) return [];
    const tabs = [{ id: 'all', label: 'All', count: list.length }];
    for (const g of GROUPS) {
      const n = list.filter((f) => g.kinds.includes(f && f.kind)).length;
      if (n) tabs.push({ id: g.id, label: g.label(variant), count: n });
    }
    return tabs;
  }

  function filterFindings(findings, tabId) {
    const list = Array.isArray(findings) ? findings : [];
    const g = GROUPS.find((x) => x.id === tabId);
    return g ? list.filter((f) => g.kinds.includes(f && f.kind)) : list;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /**
   * 28 days, oldest to newest, the last one being `today`. Laid out as 4 rows of 7, so each column is one
   * weekday; the first column is the weekday of the first day (the header row starts there).
   * Values: 0 none, 1 one post, 2 two or more, null not visible to us.
   * knownFrom: the index of the first day we can see (null when none). hidden: no day is visible.
   */
  function rhythmLayout(series, today) {
    const t = toDate(today) || new Date();
    const base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const raw = Array.isArray(series) ? series : [];
    const vals = [];
    for (let i = 0; i < DAYS; i += 1) {
      const v = raw[i];
      vals.push(v === 0 || v === 1 || v === 2 ? v : null);
    }
    const cells = vals.map((value, i) => {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (DAYS - 1 - i));
      return { index: i, date: isoLocal(date), dow: date.getDay(), value };
    });
    const first = vals.findIndex((v) => v !== null);
    const rows = [];
    for (let r = 0; r < 4; r += 1) rows.push(cells.slice(r * 7, r * 7 + 7));
    return {
      cells,
      rows,
      firstDow: cells[0].dow,
      weekdays: cells.slice(0, 7).map((c) => c.dow),
      hidden: first === -1,
      knownFrom: first === -1 ? null : first,
      visibleDays: first === -1 ? 0 : DAYS - first,
      activeDays: vals.filter((v) => v === 1 || v === 2).length,
    };
  }

  function weekdayName(dow, style, locale) {
    return new Date(2023, 0, 1 + dow).toLocaleDateString(locale, { weekday: style || 'narrow' });
  }

  function cellTitle(cell, locale) {
    const d = new Date(`${cell.date}T12:00:00`);
    const when = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    const what = cell.value === null ? 'Not visible to us' : cell.value === 0 ? 'No posts' : cell.value === 1 ? '1 post' : '2 or more posts';
    return `${when}: ${what}`;
  }

  /** The brief handed to Create, or null when the action goes elsewhere. */
  function actionPlan(action) {
    if (!action || typeof action !== 'object') return null;
    const target = action.target;
    if (target === 'create') return { target, nav: 'design-studio', session: { destination: 'design', mode: 'image', aspect_ratio: '4:5', prompt: String(action.brief || action.label || '') } };
    if (target === 'calendar') return { target, nav: 'schedule' };
    if (target === 'campaign') return { target, nav: 'fundraise' };
    return null;
  }

  const moveKey = (compId, m) => `${compId}|${m && m.title}`;
  const isDismiss = (s) => !!s && (!s.target || /^dismiss$/i.test(String(s.label || '')));

  const helpers = { esc, safeUrl, standingSummary, formatDay, formatDateTime, formatTime, availableLabel, cooldownMs, initials, chipFor, groupFindings, filterFindings, rhythmLayout, weekdayName, cellTitle, actionPlan, moveKey, isDismiss };

  /* ───────────────────────── styles ───────────────────────── */

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('intel-styles')) return;
    const st = document.createElement('style');
    st.id = 'intel-styles';
    // Colours come from --in-* tokens. The old look gets its own dark values; the new look maps them to
    // the --nl-* tokens (so Day/Dark follow). Tints use color-mix so the look mapper leaves them alone.
    st.textContent = `
.intel { --in-bg:#0b1020; --in-surface:#111827; --in-s2:#0f1a2e; --in-s3:#162237; --in-s4:#1e2a44; --in-line:rgba(255,255,255,.07); --in-line2:rgba(255,255,255,.14);
  --in-fg:#f1f5f9; --in-fg2:#cbd5e1; --in-fg3:#94a3b8; --in-fg4:#64748b; --in-signal:#a78bfa; --in-ink:#0b0820; --in-ok:#34d399; --in-warn:#fbbf24;
  --in-display:'Figtree','Plus Jakarta Sans',system-ui,sans-serif; --in-body:'Instrument Sans','Inter',system-ui,sans-serif; --in-mono:'JetBrains Mono',ui-monospace,Menlo,monospace; }
html.nl .intel { --in-bg:var(--nl-bg); --in-surface:var(--nl-surface); --in-s2:var(--nl-s2); --in-s3:var(--nl-s3); --in-s4:var(--nl-s4); --in-line:var(--nl-line); --in-line2:var(--nl-line-strong);
  --in-fg:var(--nl-fg); --in-fg2:var(--nl-fg2); --in-fg3:var(--nl-fg3); --in-fg4:var(--nl-fg4); --in-signal:var(--nl-signal); --in-ink:var(--nl-signal-ink); --in-ok:var(--nl-ok); --in-warn:var(--nl-warn);
  --in-display:var(--nl-display); --in-body:var(--nl-body); --in-mono:var(--nl-mono); }
.intel { --in-signal-soft:color-mix(in srgb, var(--in-signal) 14%, transparent); --in-signal-mid:color-mix(in srgb, var(--in-signal) 45%, transparent);
  --in-ok-soft:color-mix(in srgb, var(--in-ok) 13%, transparent); --in-warn-soft:color-mix(in srgb, var(--in-warn) 14%, transparent); --in-neu-soft:color-mix(in srgb, var(--in-fg) 8%, transparent); }
.intel { box-sizing:border-box; width:100%; max-width:1340px; margin:0 auto; display:flex; flex-direction:column; gap:18px; color:var(--in-fg); font:400 13.5px/1.5 var(--in-body); }
.intel *, .intel *::before, .intel *::after { box-sizing:border-box; }
.intel :focus-visible { outline:2px solid var(--in-signal); outline-offset:2px; }
.intel h1, .intel h2, .intel h3, .intel p { margin:0; }
.intel button { font:inherit; cursor:pointer; }
.intel button:disabled { cursor:not-allowed; }
.intel a { color:inherit; }
.in-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.in-title { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px; }
.in-title > div:first-child { display:flex; flex-direction:column; gap:6px; min-width:0; }
.in-h1 { font:400 28px/1.1 var(--in-display); letter-spacing:-.02em; }
.in-sub { max-width:620px; color:var(--in-fg2); font-size:14px; }
.in-title__r { display:flex; flex-wrap:wrap; gap:8px; }
.in-pill { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:999px; border:1px solid var(--in-line2); background:var(--in-s2); font-size:12px; color:var(--in-fg2); white-space:nowrap; }
.in-note { display:flex; align-items:flex-start; gap:8px; padding:9px 12px; border-radius:9px; border:1px solid var(--in-line); background:var(--in-s2); color:var(--in-fg2); font-size:12.5px; }
.in-note::before { content:''; flex:0 0 auto; width:6px; height:6px; margin-top:7px; border-radius:50%; background:var(--in-fg3); }
.in-card { border:1px solid var(--in-line); border-radius:12px; background:var(--in-surface); padding:16px; display:flex; flex-direction:column; gap:12px; min-width:0; }
.in-watch { gap:14px; }
.in-add { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.in-input { flex:1 1 320px; min-width:0; display:flex; align-items:center; gap:10px; height:42px; padding:0 12px; border:1px solid var(--in-line2); border-radius:9px; background:var(--in-s2); color:var(--in-fg3); }
.in-input:focus-within { outline:2px solid var(--in-signal); outline-offset:2px; }
.in-input input { flex:1 1 auto; min-width:0; height:100%; border:0; outline:0; background:transparent; color:var(--in-fg); font:400 14px var(--in-body); }
.in-input input::placeholder { color:var(--in-fg3); }
.in-input input:disabled { color:var(--in-fg4); }
.in-input:has(input:disabled) { opacity:.65; }
.in-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:30px; padding:0 12px; border-radius:7px; border:1px solid var(--in-line2); background:transparent; color:var(--in-fg2); font-size:12.5px; white-space:nowrap; }
.in-btn:hover:not(:disabled) { background:var(--in-s3); color:var(--in-fg); }
.in-btn:disabled { opacity:.6; }
.in-btn--lg { height:42px; padding:0 18px; border-radius:9px; font-size:14px; font-weight:600; }
.in-btn--signal { background:var(--in-signal); border-color:transparent; color:var(--in-ink); }
.in-btn--signal:hover:not(:disabled) { background:var(--in-signal); color:var(--in-ink); filter:brightness(1.07); }
.in-btn--soft { border:0; background:var(--in-signal-soft); color:var(--in-signal); font-weight:500; }
.in-btn--soft:hover:not(:disabled) { background:var(--in-signal-soft); color:var(--in-signal); filter:brightness(1.12); }
.in-btn--md { height:32px; padding:0 13px; border-radius:8px; }
.in-btn--rep { height:36px; padding:0 14px; border-radius:8px; font-size:13px; color:var(--in-fg); }
.in-err { color:var(--in-warn); font-size:12.5px; margin-top:-4px; }
.in-err:empty { display:none; }
.in-hint { color:var(--in-fg3); font-size:12.5px; margin-top:-4px; }
.in-cards { display:flex; flex-wrap:wrap; gap:12px; }
.in-empty { flex:1 1 100%; padding:12px 14px; border:1px dashed var(--in-line2); border-radius:10px; color:var(--in-fg2); font-size:13.5px; }
.in-wc { position:relative; flex:1 1 260px; max-width:420px; display:flex; align-items:stretch; border-radius:10px; border:1px solid var(--in-line); background:transparent; }
.in-wc[data-on="1"] { border-color:var(--in-line2); background:var(--in-s3); }
.in-wc__main { flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:12px; padding:12px; border:0; border-radius:10px; background:transparent; color:var(--in-fg); text-align:left; }
.in-wc__main:hover { background:var(--in-neu-soft); }
.in-av { flex:0 0 40px; height:40px; border-radius:9px; background:var(--in-s4); border:1px solid var(--in-line2); display:flex; align-items:center; justify-content:center; font:400 11px var(--in-mono); color:var(--in-fg2); }
.in-wc__t { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
.in-wc__n { font-weight:500; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.in-wc__d { font-size:12px; color:var(--in-fg3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.in-chip { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px; font-size:12px; font-weight:500; white-space:nowrap; background:var(--in-neu-soft); color:var(--in-fg3); }
.in-chip--sig { background:var(--in-signal-soft); color:var(--in-signal); }
.in-chip--warn { background:var(--in-warn-soft); color:var(--in-warn); }
.in-x { flex:0 0 44px; border:0; border-left:1px solid var(--in-line); border-radius:0 10px 10px 0; background:transparent; color:var(--in-fg3); display:flex; align-items:center; justify-content:center; }
.in-x:hover { background:var(--in-neu-soft); color:var(--in-fg); }
.in-spin { display:inline-block; width:12px; height:12px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:in-spin .8s linear infinite; }
@keyframes in-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .in-spin { animation-duration:3s; } }
.in-cols { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start; }
.in-main { flex:999 1 560px; min-width:0; display:flex; flex-direction:column; gap:12px; }
.in-aside { flex:1 1 380px; max-width:460px; min-width:0; display:flex; flex-direction:column; gap:16px; }
.in-hd { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; }
.in-hd__l { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 10px; min-width:0; }
.in-h2 { font:500 19px/1.3 var(--in-display); letter-spacing:-.01em; overflow-wrap:anywhere; }
.in-meta { font-size:12.5px; color:var(--in-fg3); }
.in-acts { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-left:auto; }
.in-tabs { display:inline-flex; flex-wrap:wrap; align-self:flex-start; max-width:100%; padding:3px; gap:2px; border-radius:9px; border:1px solid var(--in-line2); background:var(--in-s2); }
.in-tab { height:28px; padding:0 11px; border:0; border-radius:6px; background:transparent; color:var(--in-fg3); font-size:12.5px; }
.in-tab[aria-selected="true"] { background:var(--in-s4); color:var(--in-fg); }
.in-tab:hover:not([aria-selected="true"]) { color:var(--in-fg); }
.in-banner { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; padding:11px 14px; border-radius:10px; border:1px solid var(--in-line2); background:var(--in-s2); color:var(--in-fg2); font-size:13.5px; }
.in-banner--warn { border-color:color-mix(in srgb, var(--in-warn) 40%, transparent); background:var(--in-warn-soft); color:var(--in-fg); }
.in-banner__t { flex:1 1 220px; min-width:0; overflow-wrap:anywhere; }
.in-feed { display:flex; flex-direction:column; gap:12px; }
.in-find { border:1px solid var(--in-line); border-radius:12px; background:var(--in-surface); padding:16px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.in-find__top { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
.in-kind { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:6px; font-size:12px; font-weight:500; background:var(--in-neu-soft); color:var(--in-fg2); }
.in-kind::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.in-kind--ok { background:var(--in-ok-soft); color:var(--in-ok); }
.in-kind--warn { background:var(--in-warn-soft); color:var(--in-warn); }
.in-kind--sig { background:var(--in-signal-soft); color:var(--in-signal); }
.in-seen { font:400 11px var(--in-mono); color:var(--in-fg3); }
.in-h3 { font:500 17px/1.3 var(--in-display); letter-spacing:-.01em; overflow-wrap:anywhere; }
.in-body { color:var(--in-fg2); font-size:14px; max-width:700px; overflow-wrap:anywhere; }
.in-find__ft { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding-top:10px; border-top:1px solid var(--in-line); }
.in-src { display:inline-flex; align-items:center; gap:6px; min-width:0; max-width:100%; font:400 11.5px var(--in-mono); color:var(--in-fg3); text-decoration:none; }
.in-src span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
a.in-src:hover { color:var(--in-fg); }
.in-find__acts { display:flex; flex-wrap:wrap; gap:6px; }
.in-find__acts .in-btn[aria-pressed="true"] { color:var(--in-fg); border-color:var(--in-fg4); }
.in-cmp { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) 58px; column-gap:10px; align-items:baseline; }
.in-cmp--h { font-size:12px; color:var(--in-fg3); padding-bottom:6px; border-bottom:1px solid var(--in-line); }
.in-cmp--h span { overflow-wrap:anywhere; }
.in-cmp--r { padding:6px 0; border-bottom:1px solid var(--in-line); }
.in-cmp__l { color:var(--in-fg2); font-size:13px; overflow-wrap:anywhere; }
.in-cmp__v { font-size:14px; font-weight:500; overflow-wrap:anywhere; }
.in-miss { color:var(--in-fg4); font-weight:400; }
.in-mark { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:500; justify-self:end; }
.in-mark::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.in-mark--lead { color:var(--in-ok); }
.in-mark--behind { color:var(--in-warn); }
.in-sum { font-size:13px; color:var(--in-fg2); }
.in-fine { font-size:12px; color:var(--in-fg3); }
.in-rhy { display:flex; flex-wrap:wrap; gap:14px 16px; }
.in-rhy__s { display:flex; flex-direction:column; gap:8px; width:164px; max-width:100%; }
.in-rhy__n { font-size:12px; color:var(--in-fg3); overflow-wrap:anywhere; max-width:164px; }
.in-grid { display:grid; grid-template-columns:repeat(7,20px); gap:4px; }
.in-dow { width:20px; text-align:center; font:400 10px var(--in-mono); color:var(--in-fg4); }
.in-sq { width:20px; height:20px; border-radius:5px; background:var(--in-s3); }
.in-sq--1 { background:var(--in-signal-mid); }
.in-sq--2 { background:var(--in-signal); }
.in-sq--n { background:repeating-linear-gradient(135deg, var(--in-s3) 0 3px, transparent 3px 6px); border:1px dashed var(--in-line2); }
.in-hide { padding:14px 0; font-size:13px; color:var(--in-fg3); width:164px; }
.in-moves { display:flex; flex-direction:column; gap:12px; }
.in-moves__hd { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 10px; }
.in-moves__list { display:flex; flex-wrap:wrap; gap:14px; }
.in-move { flex:1 1 300px; border:1px solid var(--in-line); border-radius:12px; background:var(--in-surface); padding:16px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.in-basis { font:400 11.5px var(--in-mono); color:var(--in-fg3); overflow-wrap:anywhere; }
.in-move__acts { display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; padding-top:6px; }
.in-rep { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--in-line); border-radius:12px; background:var(--in-surface); padding:14px 16px; }
.in-rep__t { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 280px; }
.in-rep__t b { font-weight:500; font-size:14px; }
.in-rep__t span { font-size:12.5px; color:var(--in-fg3); }
.in-report { border:1px solid var(--in-line); border-radius:12px; background:var(--in-surface); padding:16px; display:flex; flex-direction:column; gap:14px; }
.in-report h3 { font:500 16px/1.3 var(--in-display); }
.in-swot { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
.in-swot > div { border:1px solid var(--in-line); border-radius:10px; background:var(--in-s2); padding:12px; }
.in-swot h4 { margin:0 0 6px; font:500 13px var(--in-display); }
.in-swot ul, .in-report ul { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px; color:var(--in-fg2); font-size:13.5px; }
.in-report p { color:var(--in-fg2); font-size:14px; }
.in-tbl { width:100%; border-collapse:collapse; font-size:13px; }
.in-tbl th, .in-tbl td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--in-line); overflow-wrap:anywhere; }
.in-tbl th { color:var(--in-fg3); font-weight:400; }
.in-idea { border:1px solid var(--in-line); border-radius:10px; background:var(--in-s2); padding:12px; display:flex; flex-direction:column; gap:4px; font-size:13.5px; color:var(--in-fg2); }
.in-idea b { color:var(--in-fg); font-weight:500; }
.in-load { padding:18px; color:var(--in-fg3); }
@media (max-width: 520px) { .in-h1 { font-size:24px; } .in-card, .in-find { padding:14px; } }
html.nl[data-nl-theme="day"] .intel .in-sq--n { background:repeating-linear-gradient(135deg, var(--in-s4) 0 3px, transparent 3px 6px); }
`;
    document.head.appendChild(st);
  }

  /* ───────────────────────── storage ───────────────────────── */

  function readJson(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch (_) { return fallback; }
  }
  function writeJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* private mode */ } }

  /* ───────────────────────── icons ───────────────────────── */

  const SVG = (d, w, extra) => `<svg width="${w || 15}" height="${w || 15}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${(extra && extra.sw) || 1.8}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const ICON = {
    link: SVG('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
    plus: SVG('M12 5v14 M5 12h14', 15, { sw: 2 }),
    out: SVG('M7 17 17 7 M8 7h9v9', 12, { sw: 2 }),
    x: SVG('M6 6l12 12 M18 6 6 18', 15, { sw: 2 }),
  };

  /* ───────────────────────── the page ───────────────────────── */

  let active = null;

  function mount(content, deps) {
    if (!content) return;
    if (active) active.destroy();
    injectStyles();
    deps = deps || {};

    const variant = deps.variant === 'charity' || deps.variant === 'store' ? deps.variant : 'brand';
    const COPY = variant === 'charity'
      ? { noun: 'charity', nouns: 'charities', sub: 'Charities you watch, what changed, and how you compare.', ph: 'https://similar-charity.org', empty: 'You are not watching any charities yet. Add one above and we will take a first look at its website and social profile, which takes up to a minute.' }
      : variant === 'store'
        ? { noun: 'store', nouns: 'stores', sub: 'Stores you watch, what changed, and how you compare.', ph: 'https://competitor-store.com', empty: 'You are not watching any stores yet. Add one above and we will take a first look at its website and social profile, which takes up to a minute.' }
        : { noun: 'competitor', nouns: 'competitors', sub: 'Competitors you watch, what changed, and how you compare.', ph: 'https://competitor.com', empty: 'You are not watching any competitors yet. Add one above and we will take a first look at its website and social profile, which takes up to a minute.' };
    const clientType = deps.clientType || (variant === 'charity' ? 'charity' : variant === 'store' ? 'shopify' : 'brand');
    const toast = (m, k) => { if (typeof deps.toast === 'function') deps.toast(m, k); else if (typeof global.showToast === 'function') global.showToast(m, k); };
    const confirmFn = typeof deps.confirm === 'function' ? deps.confirm : (m) => global.confirm(m);

    const S = {
      loaded: false, loadErr: '', limit: 5, pageChecks: true,
      list: [], sel: null, tab: 'all',
      detail: new Map(), detailErr: new Map(), detailLoading: new Set(),
      sending: new Set(), stalled: new Set(), notice: new Map(),
      addBusy: false, addErr: '',
      report: new Map(), showDismissed: false,
    };
    const polls = new Map();
    let cooldownTimer = null;
    let dead = false;

    content.innerHTML = `<div class="intel" id="intel-root">
      <div class="in-title">
        <div><h1 class="in-h1">Intel</h1><p class="in-sub">${esc(COPY.sub)}</p></div>
        <div class="in-title__r"><span class="in-pill" id="in-count"></span><span class="in-pill">Checked when you ask</span></div>
      </div>
      <div id="in-pc"></div>
      <section class="in-card in-watch" aria-label="Watchlist">
        <div class="in-add">
          <label class="in-input" for="in-url">${ICON.link}<span class="in-sr">Website address of a ${esc(COPY.noun)} to watch</span>
            <input id="in-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${esc(COPY.ph)}" aria-describedby="in-add-hint in-add-err"></label>
          <button type="button" class="in-btn in-btn--lg in-btn--signal" id="in-add" data-a="add">${ICON.plus}Add to watchlist</button>
        </div>
        <p class="in-err" id="in-add-err" role="alert"></p>
        <p class="in-hint" id="in-add-hint"></p>
        <div class="in-cards" id="in-cards" role="group" aria-label="Watchlist"></div>
      </section>
      <div id="in-focus"></div>
      <div class="in-sr" id="in-live" role="status" aria-live="polite"></div>
    </div>`;
    const root = content.querySelector('#intel-root');
    const $ = (id) => root.querySelector(id);

    const alive = () => !dead && root.isConnected;
    const live = (msg) => { const el = $('#in-live'); if (el) el.textContent = msg; };
    const current = () => S.list.find((c) => c.id === S.sel) || null;
    const byId = (id) => S.list.find((c) => c.id === id) || null;

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

    /* ── state helpers ── */
    function upsert(c) {
      if (!c || !c.id) return;
      const i = S.list.findIndex((x) => x.id === c.id);
      if (i >= 0) S.list[i] = Object.assign({}, S.list[i], c); else S.list.push(c);
    }

    function applyDetail(d) {
      if (!d || !d.competitor) return;
      upsert(d.competitor);
      S.detail.set(d.competitor.id, d);
      if (typeof d.page_checks === 'boolean') { S.pageChecks = d.page_checks; renderNote(); }
    }

    /* ── focus-preserving render ── */
    function renderInto(host, html) {
      if (!host) return;
      const a = document.activeElement;
      const fk = a && host.contains(a) && a.getAttribute ? a.getAttribute('data-fk') : null;
      host.innerHTML = html;
      if (fk) { const n = host.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n && !n.disabled) n.focus(); }
    }

    function renderAll() {
      if (!alive()) return;
      renderWatch();
      renderFocus();
      scheduleCooldown();
    }

    function renderNote() {
      const host = $('#in-pc');
      if (!host) return;
      host.innerHTML = S.pageChecks === false
        ? '<p class="in-note" role="note">Page checks are not switched on yet. Social and catalog numbers still work.</p>'
        : '';
    }

    /* ── watchlist ── */
    function renderWatch() {
      const full = S.list.length >= S.limit;
      $('#in-count').textContent = `${S.list.length} of ${S.limit}`;
      $('#in-count').setAttribute('aria-label', `${S.list.length} of ${S.limit} ${COPY.nouns} on your watchlist`);
      const input = $('#in-url'); const btn = $('#in-add');
      input.disabled = full || S.addBusy;
      btn.disabled = full || S.addBusy;
      btn.innerHTML = S.addBusy ? `<span class="in-spin" aria-hidden="true"></span>Adding` : `${ICON.plus}Add to watchlist`;
      $('#in-add-err').textContent = S.addErr;
      $('#in-add-hint').textContent = full
        ? `Your watchlist is full. Remove one to add another.`
        : S.list.length ? 'We only check when you add one or press Check now.' : 'Nothing runs on its own. We check when you add one and when you press Check now.';
      const cards = S.list.map((c) => {
        const chip = chipFor(c);
        const on = c.id === S.sel;
        return `<div class="in-wc" data-on="${on ? 1 : 0}">
          <button type="button" class="in-wc__main" data-a="select" data-id="${esc(c.id)}" data-fk="sel-${esc(c.id)}" aria-current="${on ? 'true' : 'false'}">
            <span class="in-av" aria-hidden="true">${esc(initials(c.name))}</span>
            <span class="in-wc__t"><span class="in-wc__n">${esc(c.name || c.domain)}</span><span class="in-wc__d">${esc(c.domain)}</span><span class="in-wc__d">${c.last_checked_at ? 'Checked ' + esc(formatDay(c.last_checked_at)) : 'Not checked yet'}</span></span>
            <span class="in-chip in-chip--${esc(chip.tone)}">${c.status === 'checking' ? '<span class="in-spin" aria-hidden="true"></span>' : ''}${esc(chip.text)}</span>
          </button>
          <button type="button" class="in-x" data-a="remove" data-id="${esc(c.id)}" data-fk="rm-${esc(c.id)}" aria-label="Remove ${esc(c.name || c.domain)} from your watchlist">${ICON.x}</button>
        </div>`;
      }).join('');
      renderInto($('#in-cards'), cards || (S.loaded ? `<p class="in-empty">${esc(COPY.empty)}</p>` : ''));
    }

    /* ── focus: one competitor ── */
    function toolbarButton(c, label, cls) {
      const left = cooldownMs(c);
      const checking = c.status === 'checking' || S.sending.has(c.id);
      if (checking) return `<button type="button" class="in-btn ${cls || ''}" disabled><span class="in-spin" aria-hidden="true"></span>Checking</button>`;
      if (left > 0) return `<button type="button" class="in-btn ${cls || ''}" disabled>Available again ${esc(availableLabel(c.next_check_allowed_at))}</button>`;
      return `<button type="button" class="in-btn ${cls || ''}" data-a="check" data-id="${esc(c.id)}" data-fk="check-${esc(label)}">${esc(label)}</button>`;
    }

    function statusHTML(c) {
      const out = [];
      const stalled = S.stalled.has(c.id);
      if (c.status === 'checking' && !stalled) {
        out.push(`<div class="in-banner"><span class="in-spin" aria-hidden="true"></span><span class="in-banner__t">Checking now, this takes up to a minute.</span></div>`);
      } else if (c.status === 'checking' && stalled) {
        out.push(`<div class="in-banner in-banner--warn"><span class="in-banner__t">This check is taking longer than usual. It may still finish, so look again in a few minutes.</span><button type="button" class="in-btn" data-a="look" data-id="${esc(c.id)}" data-fk="look">Look again</button></div>`);
      } else if (c.status === 'failed') {
        out.push(`<div class="in-banner in-banner--warn" role="alert"><span class="in-banner__t">The last check did not work.${c.error ? ' ' + esc(c.error) : ''}</span>${toolbarButton(c, 'Retry', '')}</div>`);
      }
      const n = S.notice.get(c.id);
      if (n) out.push(`<div class="in-banner in-banner--warn" role="status"><span class="in-banner__t">${esc(n)}</span></div>`);
      return out.join('');
    }

    function findingHTML(f, saved) {
      const tone = ['ok', 'warn', 'sig', 'neu'].includes(f.tone) ? f.tone : 'neu';
      const url = safeUrl(f.source_url);
      const srcInner = `<span>${esc(f.source || url)}</span>`;
      const src = f.source || url
        ? (url ? `<a class="in-src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON.out}${srcInner}</a>` : `<span class="in-src">${srcInner}</span>`)
        : '<span></span>';
      const plan = actionPlan(f.action);
      const isSaved = !!saved[f.id];
      return `<article class="in-find">
        <div class="in-find__top"><span class="in-kind in-kind--${tone}">${esc(f.label || '')}</span><span class="in-seen">Seen ${esc(formatDay(f.seen_at))}</span></div>
        <h3 class="in-h3">${esc(f.title)}</h3>
        <p class="in-body">${esc(f.body)}</p>
        <div class="in-find__ft">${src}
          <span class="in-find__acts">
            <button type="button" class="in-btn" data-a="save" data-fid="${esc(f.id)}" data-fk="save-${esc(f.id)}" aria-pressed="${isSaved}">${isSaved ? 'Saved' : 'Save'}</button>
            ${plan && f.action.label ? `<button type="button" class="in-btn in-btn--soft" data-a="finding" data-fid="${esc(f.id)}" data-fk="fa-${esc(f.id)}">${esc(f.action.label)}</button>` : ''}
          </span>
        </div></article>`;
    }

    function feedHTML(c, d) {
      const findings = d.findings || [];
      const tabs = groupFindings(findings, variant);
      let tab = S.tab;
      if (!tabs.some((t) => t.id === tab)) tab = 'all';
      const shown = filterFindings(findings, tab);
      const saved = readJson(SAVED_KEY, {});
      let html = '';
      if (d.first_check) html += `<p class="in-note" role="note">First look. Changes show up from the next check.</p>`;
      if (tabs.length) {
        html += `<div class="in-tabs" role="tablist" aria-label="Filter what changed">${tabs.map((t) => `<button type="button" role="tab" class="in-tab" id="in-tab-${esc(t.id)}" aria-selected="${t.id === tab}" aria-controls="in-panel" tabindex="${t.id === tab ? 0 : -1}" data-a="tab" data-tab="${esc(t.id)}" data-fk="tab-${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>
          <div class="in-feed" id="in-panel" role="tabpanel" aria-labelledby="in-tab-${esc(tab)}">${shown.map((f) => findingHTML(f, saved)).join('')}</div>`;
      } else if (c.status !== 'checking') {
        html += `<div class="in-banner">${d.first_check ? 'First look. Changes show up from the next check.' : 'Nothing changed since the last check.'}</div>`;
      }
      return html;
    }

    function compareHTML(d, c) {
      const cmp = d.compare;
      if (!cmp || !Array.isArray(cmp.rows) || !cmp.rows.length) return '';
      const sum = standingSummary(cmp.standing);
      const cell = (v) => (v == null || v === '' || v === 'Not found' ? '<span class="in-cmp__v in-miss">Not found</span>' : `<span class="in-cmp__v">${esc(v)}</span>`);
      const rows = cmp.rows.map((r) => {
        const mark = r.standing === 'lead' ? '<span class="in-mark in-mark--lead">ahead</span>' : r.standing === 'behind' ? '<span class="in-mark in-mark--behind">behind</span>' : '<span></span>';
        return `<div class="in-cmp in-cmp--r"><span class="in-cmp__l">${esc(r.label)}</span>${cell(r.you)}${cell(r.them)}${mark}</div>`;
      }).join('');
      const asOf = cmp.as_of ? ` on ${esc(formatDay(cmp.as_of))}` : '';
      return `<section class="in-card" aria-labelledby="in-cmp-h">
        <h2 class="in-h2" id="in-cmp-h">You and ${esc(cmp.them_label || (c && (c.name || c.domain)) || '')}</h2>
        ${sum ? `<p class="in-sum">${esc(sum)}</p>` : ''}
        <div class="in-cmp in-cmp--h"><span></span><span>${esc(cmp.you_label || 'You')}</span><span>${esc(cmp.them_label || 'Them')}</span><span class="in-sr">Standing</span></div>
        ${rows}
        <p class="in-fine">Read from public pages and profiles${asOf}. Anything we could not find shows as Not found. There is no overall score.</p>
      </section>`;
    }

    function gridHTML(label, series) {
      const lay = rhythmLayout(series, new Date());
      let body;
      let note = '';
      if (lay.hidden) {
        body = '<div class="in-hide">Not visible</div>';
      } else {
        const head = lay.weekdays.map((w) => `<span class="in-dow" aria-hidden="true">${esc(weekdayName(w, 'narrow'))}</span>`).join('');
        const sq = lay.cells.map((c) => `<span class="in-sq ${c.value === null ? 'in-sq--n' : 'in-sq--' + c.value}" title="${esc(cellTitle(c))}"></span>`).join('');
        body = `<div class="in-grid" aria-hidden="true">${head}${sq}</div>`;
        if (lay.knownFrom > 0) note = `<span class="in-fine">We can see the last ${lay.visibleDays} days only</span>`;
      }
      const summary = lay.hidden ? `${label}: not visible` : `${label}: posted on ${lay.activeDays} of the ${lay.visibleDays} days we can see`;
      return `<div class="in-rhy__s" role="img" aria-label="${esc(summary)}"><span class="in-rhy__n">${esc(label)}</span>${body}${note}</div>`;
    }

    function rhythmHTML(d, c) {
      const r = d.rhythm;
      const cmp = Object.assign({ you_label: deps.clientName || 'You', them_label: (c && (c.name || c.domain)) || 'Them' }, d.compare || {});
      if (!r || (!Array.isArray(r.you) && !Array.isArray(r.them))) return '';
      return `<section class="in-card" aria-labelledby="in-rh-h">
        <h2 class="in-h2" id="in-rh-h">Posting, last 4 weeks</h2>
        ${r.source === 'instagram' ? '<p class="in-fine">Instagram posts, last 4 weeks</p>' : r.source === 'tiktok' ? '<p class="in-fine">TikToks, last 4 weeks</p>' : ''}
        <div class="in-rhy">${gridHTML(cmp.you_label || 'You', r.you)}${gridHTML(cmp.them_label || 'Them', r.them)}</div>
        <p class="in-fine">Each square is a day, oldest first, under its weekday. Brighter means more posts that day. Hatched squares are days we could not see. Counted from public posts.</p>
      </section>`;
    }

    function movesHTML(c, d) {
      const all = Array.isArray(d.moves) ? d.moves : [];
      if (!all.length) return '';
      const dismissed = readJson(DISMISSED_KEY, {});
      const hidden = all.filter((m) => dismissed[moveKey(c.id, m)]);
      const shown = all.map((m, i) => ({ m, i })).filter(({ m }) => S.showDismissed || !dismissed[moveKey(c.id, m)]);
      const cards = shown.map(({ m, i }) => {
        const p = m.primary && m.primary.label ? m.primary : null;
        const s = m.secondary && m.secondary.label ? m.secondary : null;
        const isHid = !!dismissed[moveKey(c.id, m)];
        return `<article class="in-move">
          <h3 class="in-h3">${esc(m.title)}</h3>
          <p class="in-body">${esc(m.body)}</p>
          ${m.basis ? `<span class="in-basis">Based on: ${esc(m.basis)}</span>` : ''}
          <div class="in-move__acts">
            ${p && actionPlan(p) ? `<button type="button" class="in-btn in-btn--md in-btn--soft" data-a="move" data-i="${i}" data-which="primary" data-fk="mp-${i}">${esc(p.label)}</button>` : ''}
            ${isHid ? `<button type="button" class="in-btn in-btn--md" data-a="undismiss" data-i="${i}" data-fk="mu-${i}">Show again</button>`
              : s ? `<button type="button" class="in-btn in-btn--md" data-a="move" data-i="${i}" data-which="secondary" data-fk="ms-${i}">${esc(s.label)}</button>` : ''}
          </div></article>`;
      }).join('');
      return `<section class="in-moves" aria-label="Moves">
        <div class="in-moves__hd"><h2 class="in-h2">Moves for you</h2><span class="in-meta">Written by AI from the findings above. Each one points back to what we saw.</span></div>
        ${cards ? `<div class="in-moves__list">${cards}</div>` : '<p class="in-meta">You dismissed every move for now.</p>'}
        ${hidden.length && !S.showDismissed ? `<button type="button" class="in-btn" style="align-self:flex-start" data-a="showdismissed" data-fk="sd">Show ${hidden.length} dismissed</button>` : ''}
      </section>`;
    }

    function reportHTML(c) {
      const r = S.report.get(c.id) || { state: 'idle' };
      const busy = r.state === 'loading';
      const panel = r.state === 'done' ? reportBody(r.data, c) : '';
      return `<section class="in-rep" aria-label="Full report">
          <span class="in-rep__t"><b>Want the full picture of ${esc(c.name || c.domain)}?</b><span>A written report with strengths, weaknesses, opportunities and threats, built from what the checks found. Every point links to the page behind it. It takes under a minute and uses no extra checks.</span></span>
          <button type="button" class="in-btn in-btn--rep" data-a="report" data-fk="report" ${busy ? 'disabled' : ''}>${busy ? '<span class="in-spin" aria-hidden="true"></span>Writing the report' : r.state === 'done' ? 'Write it again' : 'Write the full report'}</button>
        </section>
        ${r.state === 'error' ? `<div class="in-banner in-banner--warn" role="alert"><span class="in-banner__t">${esc(r.error)}</span></div>` : ''}
        ${panel}`;
    }

    function sourcesHTML(sources) {
      const arr = Array.isArray(sources) ? sources : [];
      if (!arr.length) return '';
      return ` <span class="in-fine">${arr.map((s) => {
        const url = safeUrl(s && s.url);
        const label = esc((s && s.label) || 'Source');
        return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
      }).join(', ')}</span>`;
    }

    function listHTML(items) {
      const arr = Array.isArray(items) ? items.filter((x) => x != null && x !== '') : [];
      return arr.length ? `<ul>${arr.map((i) => `<li>${esc(typeof i === 'string' ? i : (i.text || i.title || i.point || JSON.stringify(i)))}${typeof i === 'object' ? sourcesHTML(i.sources) : ''}</li>`).join('')}</ul>` : '<p class="in-fine">Nothing to report.</p>';
    }

    function reportBody(r, c) {
      r = r || {};
      const isCharity = r.analysis_type === 'charity' || variant === 'charity';
      const swot = [['Strengths', r.strengths], ['Weaknesses', r.weaknesses], ['Opportunities', r.opportunities], ['Threats', r.threats]];
      const ideas = Array.isArray(r.content_ideas) ? r.content_ideas : [];
      const products = Array.isArray(r.top_competitor_products) ? r.top_competitor_products : [];
      const cp = r.competitor_pricing || {}; const yp = r.client_pricing || {};
      const money = (v) => (v != null && v !== '' ? '$' + esc(v) : '—');
      const priceRows = ['low', 'avg', 'high'].filter((k) => cp[k] != null || yp[k] != null)
        .map((k) => `<tr><td>${k[0].toUpperCase() + k.slice(1)}</td><td>${money(cp[k])}</td><td>${money(yp[k])}</td></tr>`).join('');
      return `<section class="in-report" id="in-report" aria-label="Full report" tabindex="-1">
        <h3>Full report on ${esc(r.competitor_name || c.name || c.domain)}</h3>
        ${r.overall_summary ? `<p>${esc(r.overall_summary)}</p>` : ''}
        ${r.pricing_insight ? `<p><b>Pricing:</b> ${esc(r.pricing_insight)}</p>` : ''}
        <div class="in-swot">${swot.map(([t, items]) => `<div><h4>${t}</h4>${listHTML(items)}</div>`).join('')}</div>
        ${isCharity && r.messaging_analysis ? `<div><h4>Messaging</h4><p>${esc(r.messaging_analysis)}${sourcesHTML(r.messaging_sources)}</p></div>` : ''}
        ${isCharity && Array.isArray(r.cause_differentiation) && r.cause_differentiation.length ? `<div><h4>Where you stand out</h4>${listHTML(r.cause_differentiation)}</div>` : ''}
        ${!isCharity && priceRows ? `<table class="in-tbl"><thead><tr><th>Price</th><th>${esc(r.competitor_name || 'Them')}</th><th>${esc(deps.clientName || 'You')}</th></tr></thead><tbody>${priceRows}</tbody></table>` : ''}
        ${r.based_on && r.based_on.checked_at ? `<p class="in-fine">Written from the check on ${esc(formatDateTime(r.based_on.checked_at))}, using ${esc(String(r.based_on.observations || 0))} observations from public pages and profiles.</p>` : ''}
        ${ideas.length ? `<div><h4>Content ideas</h4><div class="in-moves__list" style="gap:10px">${ideas.map((i) => (typeof i === 'string'
          ? `<div class="in-idea" style="flex:1 1 280px">${esc(i)}</div>`
          : `<div class="in-idea" style="flex:1 1 280px">${i.concept || i.format ? `<b>${esc(i.concept || i.format)}</b>` : ''}${i.platform ? `<span class="in-fine">${esc(i.platform)}</span>` : ''}${i.hook ? `<span>“${esc(i.hook)}”</span>` : ''}${i.description ? `<span>${esc(i.description)}</span>` : ''}${i.why_it_works ? `<span class="in-fine">Why it works: ${esc(i.why_it_works)}</span>` : ''}${i.sources ? `<span>${sourcesHTML(i.sources)}</span>` : ''}</div>`)).join('')}</div></div>` : ''}
        ${!isCharity && products.length ? `<div><h4>Top products</h4><table class="in-tbl"><thead><tr><th>Product</th><th>Price</th><th>Type</th></tr></thead><tbody>${products.map((p) => `<tr><td>${esc(p.title || p.name || '—')}</td><td>${p.price != null ? '$' + esc(p.price) : '—'}</td><td>${esc(p.product_type || p.type || '—')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </section>`;
    }

    function renderFocus() {
      const host = $('#in-focus');
      if (!host) return;
      if (!S.loaded) { renderInto(host, S.loadErr
        ? `<div class="in-banner in-banner--warn" role="alert"><span class="in-banner__t">${esc(S.loadErr)}</span><button type="button" class="in-btn" data-a="reload" data-fk="reload">Try again</button></div>`
        : '<p class="in-load">Loading your watchlist…</p>'); return; }
      const c = current();
      if (!c) { renderInto(host, ''); return; }
      const d = S.detail.get(c.id);
      const err = S.detailErr.get(c.id);
      const checked = c.last_checked_at ? `Last checked ${formatDateTime(c.last_checked_at)}` : 'Not checked yet';
      let html = `<div class="in-cols"><section class="in-main" aria-label="What changed">
        <div class="in-hd">
          <div class="in-hd__l"><h2 class="in-h2">What changed at ${esc(c.name || c.domain)}</h2><span class="in-meta">${esc(checked)}</span></div>
          <div class="in-acts">${toolbarButton(c, 'Check now', '')}</div>
        </div>
        ${statusHTML(c)}`;
      if (d) html += feedHTML(c, d);
      else if (err) html += `<div class="in-banner in-banner--warn" role="alert"><span class="in-banner__t">${esc(err)}</span><button type="button" class="in-btn" data-a="retrydetail" data-id="${esc(c.id)}" data-fk="rd">Try again</button></div>`;
      else html += '<p class="in-load">Loading…</p>';
      html += '</section>';
      if (d) {
        const aside = compareHTML(d, c) + rhythmHTML(d, c);
        if (aside) html += `<aside class="in-aside" aria-label="How you compare">${aside}</aside>`;
      }
      html += '</div>';
      if (d) html += movesHTML(c, d);
      html += reportHTML(c);
      renderInto(host, html);
    }

    /* ── polling ── */
    function stopPoll(id) { const p = polls.get(id); if (p) { clearTimeout(p.timer); polls.delete(id); } }

    function startPoll(id) {
      if (polls.has(id) || !alive()) return;
      S.stalled.delete(id);
      const p = { start: Date.now(), timer: null };
      polls.set(id, p);
      const tick = async () => {
        if (!alive() || polls.get(id) !== p) { stopPoll(id); return; }
        try {
          const r = await call(`/api/intel/competitors/${encodeURIComponent(id)}`);
          if (!alive() || polls.get(id) !== p) return;
          if (r.status === 404) { stopPoll(id); S.list = S.list.filter((x) => x.id !== id); S.detail.delete(id); if (S.sel === id) S.sel = S.list[0] ? S.list[0].id : null; renderAll(); return; }
          if (r.ok && r.body && r.body.competitor) {
            applyDetail(r.body);
            if (r.body.competitor.status !== 'checking') {
              stopPoll(id);
              const nm = r.body.competitor.name || r.body.competitor.domain;
              live(r.body.competitor.status === 'failed' ? `The check for ${nm} did not work.` : `The check for ${nm} is done.`);
              renderAll();
              return;
            }
            renderAll();
          }
        } catch (_) { /* a missed poll is fine, the next one tries again */ }
        if (Date.now() - p.start >= GIVE_UP_MS) { stopPoll(id); S.stalled.add(id); renderAll(); live('This check is taking longer than usual.'); return; }
        p.timer = setTimeout(tick, POLL_MS);
      };
      p.timer = setTimeout(tick, POLL_MS);
    }

    function scheduleCooldown() {
      clearTimeout(cooldownTimer);
      const now = new Date();
      const lefts = S.list.map((c) => cooldownMs(c, now)).filter((n) => n > 0);
      if (!lefts.length) return;
      cooldownTimer = setTimeout(() => { if (alive()) renderAll(); }, Math.min(MAX_TIMEOUT, Math.min(...lefts) + 500));
    }

    /* ── loading ── */
    async function loadList() {
      S.loadErr = '';
      try {
        const r = await call('/api/intel');
        if (!alive()) return;
        if ((r.status === 402 || r.status === 403) && deps.upgradeHTML) { dead = true; content.innerHTML = deps.upgradeHTML; if (typeof deps.afterUpgrade === 'function') deps.afterUpgrade(); return; }
        if (!r.ok) throw new Error(r.body.error || `Could not load your watchlist (${r.status}).`);
        S.limit = count(r.body.limit) || 5;
        S.pageChecks = r.body.page_checks !== false;
        S.list = Array.isArray(r.body.competitors) ? r.body.competitors.slice() : [];
        S.loaded = true;
        if (!S.sel || !byId(S.sel)) S.sel = S.list[0] ? S.list[0].id : null;
        renderNote();
        renderAll();
        S.list.filter((c) => c.status === 'checking').forEach((c) => startPoll(c.id));
        if (S.sel) loadDetail(S.sel);
      } catch (e) {
        if (!alive()) return;
        S.loadErr = e.message || 'Could not load your watchlist.';
        renderAll();
      }
    }

    async function loadDetail(id) {
      if (S.detailLoading.has(id)) return;
      S.detailLoading.add(id);
      S.detailErr.delete(id);
      try {
        const r = await call(`/api/intel/competitors/${encodeURIComponent(id)}`);
        if (!alive()) return;
        if (!r.ok) throw new Error(r.body.error || `Could not load the findings (${r.status}).`);
        applyDetail(r.body);
        if (r.body.competitor && r.body.competitor.status === 'checking') startPoll(id);
      } catch (e) {
        if (alive()) S.detailErr.set(id, e.message || 'Could not load the findings.');
      } finally {
        S.detailLoading.delete(id);
        if (alive()) renderAll();
      }
    }

    /* ── actions ── */
    async function add() {
      if (S.addBusy || S.list.length >= S.limit) return;
      const input = $('#in-url');
      let url = input.value.trim();
      if (!url) { S.addErr = `Enter the website address of a ${COPY.noun} to watch.`; renderWatch(); input.focus(); return; }
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
      S.addBusy = true; S.addErr = '';
      renderWatch();
      try {
        const r = await call('/api/intel/competitors', { method: 'POST', body: { url } });
        if (!alive()) return;
        if (r.status === 201 && r.body.competitor) {
          input.value = '';
          upsert(r.body.competitor);
          S.sel = r.body.competitor.id; S.tab = 'all';
          S.addBusy = false;
          live(`Checking ${r.body.competitor.name || r.body.competitor.domain} now.`);
          renderAll();
          if (r.body.competitor.status === 'checking') startPoll(r.body.competitor.id);
          loadDetail(r.body.competitor.id);
          return;
        }
        S.addErr = r.body.error || 'Could not add that website. Check the address and try again.';
      } catch (e) {
        S.addErr = 'Could not reach the server. Try again in a moment.';
      }
      S.addBusy = false;
      renderWatch();
      const i = $('#in-url'); if (i) i.focus();
    }

    async function check(id) {
      const c = byId(id);
      if (!c || S.sending.has(id) || c.status === 'checking' || cooldownMs(c) > 0) return;
      S.sending.add(id); S.notice.delete(id);
      renderAll();
      try {
        const r = await call(`/api/intel/competitors/${encodeURIComponent(id)}/check`, { method: 'POST' });
        if (!alive()) return;
        if (r.status === 429) {
          if (r.body.retry_at) upsert({ id, next_check_allowed_at: r.body.retry_at });
          S.notice.set(id, r.body.error || 'That was checked a moment ago.');
        } else if (r.ok && r.body.competitor) {
          upsert(r.body.competitor);
          S.stalled.delete(id);
          live(`Checking ${r.body.competitor.name || r.body.competitor.domain} now.`);
          if (r.body.competitor.status === 'checking') startPoll(id);
        } else {
          S.notice.set(id, r.body.error || 'The check could not start. Try again in a moment.');
        }
      } catch (_) {
        if (alive()) S.notice.set(id, 'Could not reach the server. Try again in a moment.');
      } finally {
        S.sending.delete(id);
        if (alive()) renderAll();
      }
    }

    async function remove(id) {
      const c = byId(id);
      if (!c) return;
      if (!confirmFn(`Remove ${c.name || c.domain} from your watchlist?`)) return;
      try {
        const r = await call(`/api/intel/competitors/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!alive()) return;
        if (!r.ok && r.status !== 404) throw new Error(r.body.error || 'Could not remove it.');
        stopPoll(id);
        S.list = S.list.filter((x) => x.id !== id);
        S.detail.delete(id); S.report.delete(id);
        if (S.sel === id) { S.sel = S.list[0] ? S.list[0].id : null; S.tab = 'all'; if (S.sel) loadDetail(S.sel); }
        S.addErr = '';
        live(`${c.name || c.domain} was removed.`);
        renderAll();
      } catch (e) {
        toast(e.message || 'Could not remove it.', 'error');
      }
    }

    function go(action) {
      const plan = actionPlan(action);
      if (!plan) return;
      const nav = typeof deps.switchNav === 'function' ? deps.switchNav : global.switchNav;
      if (typeof nav !== 'function') return;
      if (plan.target !== 'create' && !document.querySelector(`[data-nav="${plan.nav}"]`)) { toast('That page is not available on your account.', 'info'); return; }
      if (plan.session) global.__SE_COACH_CREATE_SESSION = plan.session;
      nav(plan.nav);
    }

    async function writeReport() {
      const c = current();
      if (!c) return;
      const prev = S.report.get(c.id);
      if (prev && prev.state === 'loading') return;
      S.report.set(c.id, { state: 'loading' });
      live('Writing the report. This can take a minute or two.');
      renderFocus();
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 150000) : null;
      try {
        const r = await call(`/api/intel/competitors/${encodeURIComponent(c.id)}/report`, { method: 'POST', body: {}, signal: ctl ? ctl.signal : undefined });
        if (!alive()) return;
        if (!r.ok) throw new Error(r.body.error || r.body.message || `The report could not be written (${r.status}).`);
        S.report.set(c.id, { state: 'done', data: r.body });
        live('The report is ready.');
        renderFocus();
        const rp = $('#in-report'); if (rp) rp.focus();
      } catch (e) {
        if (!alive()) return;
        S.report.set(c.id, { state: 'error', error: e.name === 'AbortError' ? 'The report took too long. Try again in a few minutes.' : (e.message || 'The report could not be written.') });
        renderFocus();
      } finally { if (timer) clearTimeout(timer); }
    }

    /* ── events ── */
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-a]');
      if (!t || !root.contains(t)) return;
      const a = t.getAttribute('data-a');
      const id = t.getAttribute('data-id');
      const c = current();
      const d = c ? S.detail.get(c.id) : null;
      if (a === 'add') add();
      else if (a === 'select') { if (id !== S.sel) { S.sel = id; S.tab = 'all'; S.showDismissed = false; } renderAll(); loadDetail(id); }
      else if (a === 'remove') remove(id);
      else if (a === 'check') check(id);
      else if (a === 'look') { S.stalled.delete(id); startPoll(id); renderAll(); }
      else if (a === 'retrydetail') loadDetail(id);
      else if (a === 'reload') { renderAll(); loadList(); }
      else if (a === 'tab') { S.tab = t.getAttribute('data-tab'); renderFocus(); }
      else if (a === 'save') {
        const fid = t.getAttribute('data-fid'); const saved = readJson(SAVED_KEY, {});
        if (saved[fid]) delete saved[fid]; else saved[fid] = 1;
        writeJson(SAVED_KEY, saved); renderFocus();
      } else if (a === 'finding') {
        const f = d && (d.findings || []).find((x) => String(x.id) === t.getAttribute('data-fid'));
        if (f) go(f.action);
      } else if (a === 'move') {
        const m = d && (d.moves || [])[Number(t.getAttribute('data-i'))];
        if (!m || !c) return;
        const which = t.getAttribute('data-which');
        const act = m[which];
        if (which === 'secondary' && isDismiss(act)) {
          const dis = readJson(DISMISSED_KEY, {}); dis[moveKey(c.id, m)] = 1; writeJson(DISMISSED_KEY, dis);
          renderFocus(); live('Move dismissed.');
        } else go(act);
      } else if (a === 'undismiss') {
        const m = d && (d.moves || [])[Number(t.getAttribute('data-i'))];
        if (!m || !c) return;
        const dis = readJson(DISMISSED_KEY, {}); delete dis[moveKey(c.id, m)]; writeJson(DISMISSED_KEY, dis); renderFocus();
      } else if (a === 'showdismissed') { S.showDismissed = true; renderFocus(); }
      else if (a === 'report') writeReport();
    });

    root.addEventListener('keydown', (ev) => {
      if (ev.target && ev.target.id === 'in-url' && ev.key === 'Enter') { ev.preventDefault(); add(); return; }
      const tab = ev.target && ev.target.closest && ev.target.closest('[role="tab"]');
      if (tab && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Home' || ev.key === 'End')) {
        const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
        let i = tabs.indexOf(tab);
        if (ev.key === 'ArrowRight') i = (i + 1) % tabs.length;
        else if (ev.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
        else if (ev.key === 'Home') i = 0; else i = tabs.length - 1;
        ev.preventDefault();
        S.tab = tabs[i].getAttribute('data-tab');
        renderFocus();
        const n = root.querySelector(`[data-fk="tab-${CSS.escape(S.tab)}"]`); if (n) n.focus();
      }
    });
    $('#in-url').addEventListener('input', () => { if (S.addErr) { S.addErr = ''; $('#in-add-err').textContent = ''; } });

    function destroy() {
      dead = true;
      polls.forEach((p) => clearTimeout(p.timer));
      polls.clear();
      clearTimeout(cooldownTimer);
      if (active && active.destroy === destroy) active = null;
    }
    active = { destroy };

    renderAll();
    loadList();
  }

  if (typeof window !== 'undefined') {
    global.renderIntel = mount;
    global.seIntel = { helpers };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
})(typeof window !== 'undefined' ? window : globalThis);
