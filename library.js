/* Library: everything Create and Coach can use, as a browsable grid with filters and a detail panel.
 *
 * portal.html keeps fetchAssetLibrary and the "use this still" hand-off, and calls:
 *   window.renderLibraryUI(contentEl, { apiFetch, fetchAssets, useStill, variant, clientName, toast, confirm, prompt, assets })
 *
 *   variant   'charity' | 'store' | 'brand'   (wording only)
 *   assets    the SEAssets helpers (portal-assets.js); defaults to window.SEAssets
 *
 * API (all through apiFetch, same routes the old Library used):
 *   GET    /api/assets                         { assets }
 *   POST   /api/assets                         multipart: kind, name, collection, file
 *   PATCH  /api/assets/:id                     { name } | { kind }
 *   DELETE /api/assets/:id
 *   POST   /api/assets/harvest                 import logo and colors from the website
 *   POST   /api/assets/analyze-missing         label every picture that has no label
 *   POST   /api/assets/:id/analyze             label one picture
 *   POST   /api/assets/:id/generate-views      turnaround sheet
 *   POST   /api/assets/:id/more-like-this      { prompt, count } -> { drafts }
 *   POST   /api/assets/generate                { asset_ids, prompt, kind, collection } -> { drafts }   (charity, FigureLabs)
 *   POST   /api/assets/from-url                { url, kind, name, source, created_from_id }
 *   POST   /api/assets/drafts/accept | /reject
 *   GET    /api/studio/media-library?type=image&limit=80    past posts, for "Import past content"
 *
 * The pure helpers at the top are exported for node tests (library.test.js).
 */
(function (global) {
  'use strict';

  /* ───────────────────────── pure helpers ───────────────────────── */

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Only http(s) addresses are ever put in a src or href. Returns '' for anything else. */
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!/^https?:\/\//i.test(s)) return '';
    try { return new URL(s).href; } catch (_) { return ''; }
  }

  /** '#abc', '#aabbcc' or '#aabbccdd' in, the same (upper case, 6 or 8 digits) out. '' for anything else. */
  function safeHex(value) {
    const s = String(value == null ? '' : value).trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return '';
    const h = s.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return '#' + full.toUpperCase();
  }

  /**
   * A colour as hsl(), for a custom property such as --lb-c. The look mapper in new-look.js rewrites hex and
   * rgb colours in real properties (and reads hsl() back as rgb()), which would repaint a brand colour. It
   * leaves custom properties alone, so a swatch set that way always shows the real colour.
   */
  function hexToHsl(hex) {
    const h = safeHex(hex);
    if (!h) return '';
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    const r = n(1); const g = n(3); const b = n(5);
    const a = h.length === 9 ? n(7) : 1;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const l = (max + min) / 2; const d = max - min;
    let s = 0; let hue = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
      hue *= 60; if (hue < 0) hue += 360;
    }
    const f = (x) => Math.round(x * 1000) / 10;
    const core = `${Math.round(hue * 10) / 10} ${f(s)}% ${f(l)}%`;
    return a < 1 ? `hsl(${core} / ${Math.round(a * 1000) / 1000})` : `hsl(${core})`;
  }

  /** True when black text reads better on this colour than white text. */
  function isLightHex(hex) {
    const h = safeHex(hex);
    if (!h) return false;
    const c = (i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5) > 0.4;
  }

  const clean = (v) => String(v == null ? '' : v).trim();
  const list = (v) => (Array.isArray(v) ? v : []).map(clean).filter(Boolean);

  /** What the AI wrote about a picture, tidied. */
  function analysisOf(a) {
    const an = (a && a.analysis) || {};
    return {
      summary: clean(an.summary),
      aliases: list(an.aliases).slice(0, 6),
      subjects: list(an.subjects).slice(0, 6),
      place: clean(an.place),
    };
  }

  function collectionOf(a) {
    return clean((a && a.collection) || (a && a.analysis && a.analysis.collection));
  }

  /** 'labeled' | 'unlabeled' | 'none'. Only pictures can have a label. */
  function labelState(a, isStill) {
    if (!a || !isStill(a.kind)) return 'none';
    const an = analysisOf(a);
    return an.summary || an.subjects.length ? 'labeled' : 'unlabeled';
  }

  /* ── type groups ── */

  const KIND_GROUP = {
    character: 'people', item: 'things', setting: 'places', scene: 'scenes', plate: 'scenes', style: 'looks',
    shot: 'video', outro: 'video', intro: 'video', video: 'video', music: 'music', logo: 'brand', color: 'brand',
  };

  const ICON_PATH = {
    scene: 'M4 6h16v12H4z M4 15l5-5 4 4 3-3 4 4',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 20c0-4 3.6-6 8-6s8 2 8 6',
    item: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8',
    place: 'M3 18h18 M6 18V9l6-4 6 4v9 M10 18v-5h4v5',
    style: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z',
    video: 'M4 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M17 10l4-2v8l-4-2',
    music: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-3-3 M19 16a3 3 0 1 1-3-3',
    brand: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.3l-5.2 2.8 1-5.8L3.5 9.2l5.9-.9z',
    other: 'M5 5h14v14H5z',
  };

  const GROUP_ICON = { people: 'person', things: 'item', places: 'place', scenes: 'scene', looks: 'style', video: 'video', music: 'music', brand: 'brand', other: 'other' };

  /** Colour family of a placeholder picture, by kind. The look itself is in the stylesheet. */
  const KIND_TINT = { character: 'p', item: 'w', setting: 'c', scene: 'b', plate: 'b', style: 'y', shot: 'b', outro: 'b', intro: 'b', video: 'b', music: 'k', logo: 'k', color: 'k' };
  const tintOf = (kind) => KIND_TINT[clean(kind)] || 'k';

  function groupOf(kind) { return KIND_GROUP[clean(kind)] || 'other'; }
  function iconFor(kind) { return ICON_PATH[GROUP_ICON[groupOf(kind)]] || ICON_PATH.other; }

  /** The type list in the side bar, in the order the mockups use. */
  function typeGroups(variant) {
    const people = { id: 'people', label: variant === 'store' ? 'Models and people' : 'People and characters' };
    const things = { id: 'things', label: variant === 'store' ? 'Products' : 'Things' };
    const rest = [
      { id: 'places', label: 'Places and settings' }, { id: 'scenes', label: 'Scenes' }, { id: 'looks', label: 'Looks and styles' },
      { id: 'video', label: 'Video clips' }, { id: 'music', label: 'Music' },
    ];
    const head = variant === 'store' ? [things, people] : [people, things];
    return [...head, ...rest, { id: 'brand', label: 'Logo and colors' }, { id: 'other', label: 'Other' }];
  }

  /** Chip on a tile and in the panel: "Product" for a store's item, "Person" for its character. */
  function chipLabel(kind, variant, kindLabel) {
    const k = clean(kind);
    if (variant === 'store') {
      if (k === 'item') return 'Product';
      if (k === 'character') return 'Person';
    }
    return typeof kindLabel === 'function' ? kindLabel(k) : (k || 'Asset');
  }

  /** The side bar's type rows: All first, then each group with its count. Brand and Other only when they have items. */
  function typeCounts(assets, variant) {
    const items = Array.isArray(assets) ? assets : [];
    const out = [{ id: 'all', label: 'All', count: items.length }];
    for (const g of typeGroups(variant)) {
      const count = items.filter((a) => a && groupOf(a.kind) === g.id).length;
      if (count || (g.id !== 'brand' && g.id !== 'other')) out.push({ id: g.id, label: g.label, count });
    }
    return out;
  }

  /** Collections named on the items. The first spelling seen is the one shown. Biggest first. */
  function collectionsOf(assets) {
    const map = new Map();
    for (const a of (Array.isArray(assets) ? assets : [])) {
      const name = collectionOf(a);
      if (!name) continue;
      const key = name.toLowerCase();
      const cur = map.get(key);
      if (cur) cur.count += 1; else map.set(key, { name, count: 1 });
    }
    return [...map.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  }

  /* ── views, search, sort ── */

  /** 'all' | 'g:people' | 'c:Spring walk' | 'smart:label' | 'smart:review' */
  function parseView(v) {
    const s = String(v == null ? 'all' : v);
    if (s.startsWith('g:')) return { type: 'group', id: s.slice(2) };
    if (s.startsWith('c:')) return { type: 'collection', name: s.slice(2) };
    if (s === 'smart:label') return { type: 'smart', id: 'label' };
    if (s === 'smart:review') return { type: 'smart', id: 'review' };
    return { type: 'all' };
  }

  function searchText(a, ctx) {
    const c = ctx || {};
    const an = analysisOf(a);
    const kind = clean(a && a.kind);
    return [
      a && a.name, kind, chipLabel(kind, c.variant, c.kindLabel), an.summary, an.aliases.join(' '), an.subjects.join(' '), an.place, collectionOf(a),
    ].map(clean).filter(Boolean).join(' ').toLowerCase();
  }

  function matchesQuery(a, query, ctx) {
    const words = clean(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = searchText(a, ctx);
    return words.every((w) => hay.includes(w));
  }

  /** The assets a view shows, before sorting. The "review" view is drafts, not assets, so it returns []. */
  function filterAssets(assets, view, query, ctx) {
    const c = ctx || {};
    const v = parseView(view);
    const isStill = c.isStill || (() => false);
    return (Array.isArray(assets) ? assets : []).filter((a) => {
      if (!a) return false;
      if (v.type === 'group' && groupOf(a.kind) !== v.id) return false;
      if (v.type === 'collection' && collectionOf(a).toLowerCase() !== v.name.toLowerCase()) return false;
      if (v.type === 'smart') {
        if (v.id === 'review') return false;
        if (v.id === 'label' && labelState(a, isStill) !== 'unlabeled') return false;
      }
      return matchesQuery(a, query, c);
    });
  }

  const SORTS = [{ id: 'new', label: 'Newest first' }, { id: 'old', label: 'Oldest first' }, { id: 'name', label: 'Name, A to Z' }];
  const sortLabel = (id) => (SORTS.find((s) => s.id === id) || SORTS[0]).label;

  function timeOf(a) {
    const raw = a && (a.created_at || a.added_at || a.createdAt);
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : null;
  }

  /**
   * Newest first uses the date an item was added when the server sends one. It does not send one today, so
   * the order the list arrives in is taken as oldest to newest and reversed.
   */
  function sortAssets(items, mode, labelOf) {
    const rows = (Array.isArray(items) ? items : []).map((a, i) => ({ a, i, t: timeOf(a) }));
    const name = (a) => clean(typeof labelOf === 'function' ? labelOf(a) : (a && a.name)).toLowerCase();
    if (mode === 'name') rows.sort((x, y) => name(x.a).localeCompare(name(y.a)) || x.i - y.i);
    else {
      const dir = mode === 'old' ? 1 : -1;
      rows.sort((x, y) => {
        if (x.t != null && y.t != null && x.t !== y.t) return dir * (x.t - y.t);
        if ((x.t == null) !== (y.t == null)) return x.t == null ? 1 : -1; // dated items first
        return dir * (x.i - y.i);
      });
    }
    return rows.map((r) => r.a);
  }

  /** Logo and colors live in the strip at the top, so in a mixed list they go after everything else. Order is otherwise kept. */
  function brandLast(items) {
    const rows = Array.isArray(items) ? items : [];
    return [...rows.filter((a) => groupOf(a && a.kind) !== 'brand'), ...rows.filter((a) => groupOf(a && a.kind) === 'brand')];
  }

  /** "48 items. Newest first." or "12 of 48 items. Newest first." */
  function countLine(shown, total, sort) {
    const noun = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;
    return `${shown === total ? noun(total) : `${shown} of ${noun(total)}`}. ${sortLabel(sort)}.`;
  }

  function viewTitle(view, typeRows) {
    const v = parseView(view);
    if (v.type === 'collection') return v.name;
    if (v.type === 'smart') return v.id === 'label' ? 'Needs a label' : 'To review';
    if (v.type === 'group') { const row = (typeRows || []).find((r) => r.id === v.id); return row ? row.label : 'Items'; }
    return 'All items';
  }

  /** What an empty grid says. Returns { title, body } */
  function emptyCopy(view, query, total, variant) {
    const v = parseView(view);
    if (v.type === 'smart' && v.id === 'review') {
      return { title: 'Nothing to review', body: 'Pictures from More like this and Make diagrams wait here until you add or reject them.' };
    }
    if (!total) {
      const what = variant === 'store' ? 'your products, models and shop pictures' : variant === 'charity' ? 'pictures of your people, places and events' : 'pictures of your people, places and things';
      return { title: 'Your Library is empty', body: `Add ${what}, and Create and Coach can use them when you say yes.` };
    }
    if (clean(query)) return { title: 'Nothing matches', body: `Nothing matches "${clean(query)}". Try another word, or clear the search.` };
    if (v.type === 'smart' && v.id === 'label') return { title: 'Every picture has a label', body: 'Nothing is waiting to be labeled.' };
    return { title: 'Nothing here yet', body: 'Upload something, or pick another type on the left.' };
  }

  /** "Oct 21" in the viewer's own format, or '' when the server sent no date. */
  function addedLabel(a, opts) {
    const t = timeOf(a);
    if (t == null) return '';
    const o = opts || {};
    return new Date(t).toLocaleDateString(o.locale, { month: 'short', day: 'numeric', timeZone: o.timeZone });
  }

  /** The line under the name in the panel: "Spring walk 2026 · Added Oct 21", whatever of it is known. */
  function metaLine(a, opts) {
    const col = collectionOf(a);
    const added = addedLabel(a, opts);
    return [col, added ? `Added ${added}` : ''].filter(Boolean).join(' · ');
  }

  /** Which ids are selected: the ticked ones, or else the one being looked at. */
  function selectedIds(focus, checked) {
    const c = checked instanceof Set ? [...checked] : [];
    if (c.length) return c;
    return focus ? [focus] : [];
  }

  /**
   * A box was ticked or unticked. If the person has clicked an item and ticks another, both end up ticked.
   * The item the page shows by default (nobody clicked it) is not counted: `explicit` says whether they did.
   */
  function toggleChecked(focus, checked, id, explicit) {
    const has = checked instanceof Set && checked.size;
    if (!has && focus === id) return new Set([id]);
    const base = new Set(has ? checked : (focus && explicit ? [focus] : []));
    if (base.has(id)) base.delete(id); else base.add(id);
    return base;
  }

  /** Kinds every selected item can be changed to. */
  function commonKinds(items, retagKinds) {
    const lists = (items || []).map((a) => retagKinds(a.kind, a.url));
    if (!lists.length) return [];
    return lists[0].filter((k) => lists.every((l) => l.includes(k)));
  }

  /** The turnaround sheet block in the panel. */
  function sheetInfo(a, busy) {
    const views = Array.isArray(a && a.views) ? a.views.filter((v) => v && safeUrl(v.url)) : [];
    const hasSheet = !!a && (a.multiview_kind === 'sheet' || !!clean(a.sheet_url));
    const legacy = views.length > 0;
    const sheetUrl = safeUrl(a && a.sheet_url) || ((hasSheet || legacy) ? safeUrl(a && a.url) : '');
    const show = !!busy || hasSheet || legacy;
    return {
      show, hasSheet, legacy, busy: !!busy, url: sheetUrl, canRemake: hasSheet || legacy,
      meta: busy ? 'Making sheet…' : (hasSheet ? 'Single turnaround' : 'Older angles. Remake for one sheet.'),
    };
  }

  /** How a tile or panel draws the file: 'color' | 'audio' | 'video' | 'image' | 'none' */
  function previewFamily(a, persistFamily) {
    if (!a) return 'none';
    const fam = (typeof persistFamily === 'function' ? persistFamily(a.kind) : '')
      || (a.kind === 'color' ? 'color' : a.kind === 'music' ? 'audio' : ['outro', 'intro', 'shot', 'video'].includes(a.kind) ? 'video' : 'image');
    if (a.kind === 'color' || fam === 'color') return 'color';
    if (!safeUrl(a.url)) return 'none';
    return fam === 'audio' ? 'audio' : fam === 'video' ? 'video' : 'image';
  }

  /** The Add menu entries. The diagram maker is for charities only. */
  function addMenu(variant) {
    const items = [
      { id: 'upload', label: 'Upload files', hint: 'Pictures, video or music' },
      { id: 'past', label: 'Import past content', hint: 'Save finished posts as Style stills' },
    ];
    if (variant === 'charity') items.push({ id: 'gen', label: 'Make diagrams', hint: 'From 2 to 8 pictures you pick' });
    return items;
  }

  /** 2 to 8 pictures are needed to make diagrams. */
  function genReady(n) { return n >= 2 && n <= 8; }

  /** "Tick 2 to 8 pictures" copy for the diagram maker. */
  function genStatus(n) {
    if (n < 2) return n === 1 ? '1 picture ticked. Tick at least 1 more.' : 'None ticked yet. Tick 2 to 8 pictures in the grid.';
    if (n > 8) return `${n} pictures ticked. Untick ${n - 8} to get down to 8.`;
    return `${n} pictures ticked. Ready to make diagrams.`;
  }

  /** Letters for the logo box when there is no logo: "OPA" for OPA Cancer Charity, "LC" for Linen and Co. */
  function initialsOf(name) {
    const words = clean(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    if (/^\p{Lu}{2,4}$/u.test(words[0])) return words[0];
    const sig = words.filter((w) => !/^(and|the|of|for|a|an)$/i.test(w));
    const use = (sig.length ? sig : words).slice(0, 2);
    return use.length === 1 ? use[0].slice(0, 2).toUpperCase() : use.map((w) => w[0]).join('').toUpperCase();
  }

  const pluralize = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  const helpers = {
    esc, safeUrl, safeHex, hexToHsl, isLightHex, analysisOf, collectionOf, labelState, groupOf, iconFor, tintOf, typeGroups, chipLabel, typeCounts,
    collectionsOf, parseView, searchText, matchesQuery, filterAssets, SORTS, sortLabel, sortAssets, brandLast, countLine, viewTitle, emptyCopy,
    addedLabel, metaLine, selectedIds, toggleChecked, commonKinds, sheetInfo, previewFamily, addMenu, genReady, genStatus, initialsOf, pluralize,
  };

  /* ───────────────────────── styles ───────────────────────── */

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('library-styles')) return;
    const st = document.createElement('style');
    st.id = 'library-styles';
    // Colours come from --lb-* tokens. The old look gets its own dark values; the new look maps them to the
    // --nl-* tokens, so Day and Dark follow. Colours that must stay put (picture tints, scrims) are written
    // as hsl() inside custom properties (--lb-scrim and friends): the look mapper in new-look.js rewrites hex and rgb
    // colours it finds in real properties, and reads hsl() back as rgb(), but it leaves custom properties alone.
    st.textContent = `
.lib { --lb-bg:#0b1020; --lb-surface:#111827; --lb-s2:#0f1a2e; --lb-s3:#162237; --lb-s4:#1e2a44; --lb-line:rgba(255,255,255,.07); --lb-line2:rgba(255,255,255,.14);
  --lb-fg:#f1f5f9; --lb-fg2:#cbd5e1; --lb-fg3:#94a3b8; --lb-fg4:#64748b; --lb-signal:#a78bfa; --lb-ink:#0b0820; --lb-ok:#34d399; --lb-warn:#fbbf24; --lb-bad:#f87171;
  --lb-display:'Figtree','Plus Jakarta Sans',system-ui,sans-serif; --lb-body:'Instrument Sans','Inter',system-ui,sans-serif; --lb-mono:'JetBrains Mono',ui-monospace,Menlo,monospace; }
html.nl .lib { --lb-bg:var(--nl-bg); --lb-surface:var(--nl-surface); --lb-s2:var(--nl-s2); --lb-s3:var(--nl-s3); --lb-s4:var(--nl-s4); --lb-line:var(--nl-line); --lb-line2:var(--nl-line-strong);
  --lb-fg:var(--nl-fg); --lb-fg2:var(--nl-fg2); --lb-fg3:var(--nl-fg3); --lb-fg4:var(--nl-fg4); --lb-signal:var(--nl-signal); --lb-ink:var(--nl-signal-ink); --lb-ok:var(--nl-ok); --lb-warn:var(--nl-warn); --lb-bad:var(--nl-bad);
  --lb-display:var(--nl-display); --lb-body:var(--nl-body); --lb-mono:var(--nl-mono); }
.lib { --lb-scrim:hsl(220 20% 4% / .62); --lb-scrim-ink:hsl(40 12% 90%); --lb-chk-line:hsl(40 12% 90% / .6); --lb-chk-bg:hsl(220 20% 4% / .38); --lb-shadow:hsl(220 30% 4% / .35); --lb-ring:hsl(0 0% 50% / .35); }
.lib { --lb-signal-soft:color-mix(in srgb, var(--lb-signal) 15%, transparent); --lb-warn-soft:color-mix(in srgb, var(--lb-warn) 14%, transparent); --lb-neu-soft:color-mix(in srgb, var(--lb-fg) 8%, transparent); }
/* picture tints: a gradient and a line colour per kind of thing, dark first */
.lib .lb-c-p { --lb-pa:hsl(251 31% 21%); --lb-pb:hsl(249 27% 16%); --lb-pi:hsl(250 100% 84%); }
.lib .lb-c-w { --lb-pa:hsl(14 28% 18%); --lb-pb:hsl(15 34% 11%); --lb-pi:hsl(16 78% 73%); }
.lib .lb-c-c { --lb-pa:hsl(153 36% 14%); --lb-pb:hsl(155 37% 10%); --lb-pi:hsl(157 67% 65%); }
.lib .lb-c-b { --lb-pa:hsl(216 40% 18%); --lb-pb:hsl(217 42% 12%); --lb-pi:hsl(215 78% 73%); }
.lib .lb-c-y { --lb-pa:hsl(47 43% 16%); --lb-pb:hsl(46 41% 11%); --lb-pi:hsl(44 83% 71%); }
.lib .lb-c-k { --lb-pa:hsl(222 9% 16%); --lb-pb:hsl(222 10% 11%); --lb-pi:hsl(43 5% 63%); }
html.nl[data-nl-theme="day"] .lib .lb-c-p { --lb-pa:hsl(266 52% 92%); --lb-pb:hsl(254 50% 87%); --lb-pi:hsl(250 37% 40%); }
html.nl[data-nl-theme="day"] .lib .lb-c-w { --lb-pa:hsl(22 62% 91%); --lb-pb:hsl(23 56% 84%); --lb-pi:hsl(18 49% 36%); }
html.nl[data-nl-theme="day"] .lib .lb-c-c { --lb-pa:hsl(146 36% 90%); --lb-pb:hsl(147 33% 82%); --lb-pi:hsl(150 39% 30%); }
html.nl[data-nl-theme="day"] .lib .lb-c-b { --lb-pa:hsl(215 55% 92%); --lb-pb:hsl(214 52% 86%); --lb-pi:hsl(216 45% 37%); }
html.nl[data-nl-theme="day"] .lib .lb-c-y { --lb-pa:hsl(47 64% 89%); --lb-pb:hsl(46 63% 79%); --lb-pi:hsl(46 59% 30%); }
html.nl[data-nl-theme="day"] .lib .lb-c-k { --lb-pa:hsl(48 14% 91%); --lb-pb:hsl(45 12% 82%); --lb-pi:hsl(43 6% 32%); }
.lib { box-sizing:border-box; width:100%; max-width:1400px; margin:0 auto; display:flex; flex-direction:column; gap:18px; color:var(--lb-fg); font:400 13.5px/1.5 var(--lb-body); }
.lib *, .lib *::before, .lib *::after { box-sizing:border-box; }
.lib [hidden] { display:none !important; }
.lib :focus-visible { outline:2px solid var(--lb-signal); outline-offset:2px; }
.lib h1, .lib h2, .lib h3, .lib p { margin:0; }
.lib button { font:inherit; cursor:pointer; }
.lib button:disabled { cursor:not-allowed; }
.lib a { color:inherit; }
.lib svg { flex:0 0 auto; }
.lb-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.lb-title { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px; }
.lb-title > div:first-child { display:flex; flex-direction:column; gap:6px; min-width:0; }
.lb-h1 { font:400 28px/1.1 var(--lb-display); letter-spacing:-.02em; }
.lb-sub { max-width:640px; color:var(--lb-fg2); font-size:14px; }
.lb-title__r { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.lb-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:36px; padding:0 14px; border-radius:9px; border:1px solid var(--lb-line2); background:transparent; color:var(--lb-fg2); font-size:13px; white-space:nowrap; text-decoration:none; }
.lb-btn:hover:not(:disabled) { background:var(--lb-s3); color:var(--lb-fg); }
.lb-btn:disabled { opacity:.55; }
.lb-btn--top { height:38px; font-size:13.5px; }
.lb-btn--signal { background:var(--lb-signal); border-color:transparent; color:var(--lb-ink); font-weight:600; font-size:14px; }
.lb-btn--signal:hover:not(:disabled) { background:var(--lb-signal); color:var(--lb-ink); filter:brightness(1.07); }
.lb-btn--lg { height:40px; }
.lb-btn--block { width:100%; }
.lb-btn--quiet { color:var(--lb-fg3); }
.lb-btn--sm { height:30px; padding:0 11px; border-radius:7px; font-size:12.5px; }
.lb-link { border:0; background:none; padding:0; color:var(--lb-fg2); font-size:13px; text-decoration:underline; text-underline-offset:3px; }
.lb-link:hover:not(:disabled) { color:var(--lb-fg); }
.lb-link--quiet { color:var(--lb-fg3); }
.lb-link:disabled { opacity:.55; }
.lb-spin { display:inline-block; width:12px; height:12px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:lb-spin .8s linear infinite; }
@keyframes lb-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .lb-spin { animation-duration:3s; } .lb-wait { animation:none !important; } }
.lb-addwrap { position:relative; }
.lb-menu { position:absolute; right:0; top:calc(100% + 6px); z-index:30; min-width:260px; padding:6px; border-radius:11px; border:1px solid var(--lb-line2); background:var(--lb-surface); box-shadow:0 14px 40px var(--lb-shadow); display:flex; flex-direction:column; gap:2px; }
.lb-menu__i { display:flex; flex-direction:column; align-items:flex-start; gap:1px; width:100%; padding:8px 10px; border:0; border-radius:8px; background:transparent; color:var(--lb-fg); text-align:left; font-size:13.5px; }
.lb-menu__i:hover, .lb-menu__i:focus-visible { background:var(--lb-s3); }
.lb-menu__i span { color:var(--lb-fg3); font-size:12px; }
.lb-brand { border:1px solid var(--lb-line); border-radius:12px; background:var(--lb-surface); padding:14px 16px; display:flex; flex-wrap:wrap; align-items:center; gap:18px 28px; }
.lb-brand__logo { display:flex; align-items:center; gap:12px; min-width:0; }
.lb-logo { flex:0 0 52px; width:52px; height:52px; border-radius:11px; background:var(--lb-s4); border:1px solid var(--lb-line2); display:flex; align-items:center; justify-content:center; overflow:hidden; font:600 18px var(--lb-display); color:var(--lb-fg); }
.lb-logo img { width:100%; height:100%; object-fit:contain; display:block; padding:4px; }
.lb-brand__t { display:flex; flex-direction:column; min-width:0; }
.lb-brand__t b { font-weight:500; font-size:14px; }
.lb-brand__t span { font-size:12px; color:var(--lb-fg3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px; }
.lb-brand__colors { display:flex; flex-direction:column; gap:6px; min-width:0; }
.lb-brand__lbl { font-size:12px; color:var(--lb-fg3); }
.lb-sw-row { display:flex; flex-wrap:wrap; gap:8px; }
.lb-sw { display:inline-flex; align-items:center; gap:8px; height:32px; padding:0 10px 0 4px; border-radius:8px; border:1px solid var(--lb-line2); background:var(--lb-s2); color:var(--lb-fg2); font:400 11.5px var(--lb-mono); }
.lb-sw:hover { background:var(--lb-s3); color:var(--lb-fg); }
.lb-sw__c { width:24px; height:24px; border-radius:6px; box-shadow:inset 0 0 0 1px var(--lb-ring); background:var(--lb-c); }
.lb-brand__note { margin-left:auto; font-size:12.5px; color:var(--lb-fg3); max-width:300px; }
.lb-card { border:1px solid var(--lb-line); border-radius:12px; background:var(--lb-surface); padding:16px; display:flex; flex-direction:column; gap:12px; }
.lb-h3 { font:500 16px/1.3 var(--lb-display); letter-spacing:-.01em; }
.lb-hint { color:var(--lb-fg3); font-size:12.5px; }
.lb-row { display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; }
.lb-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
.lb-field > span { font-size:12px; color:var(--lb-fg3); }
.lb-field--grow { flex:1 1 220px; }
.lib select, .lib input[type="text"], .lib input[type="search"] { font:400 13.5px var(--lb-body); color:var(--lb-fg); color-scheme:inherit; }
.lib .lb-sel { appearance:none; -webkit-appearance:none; height:38px; padding:0 34px 0 12px !important; border-radius:9px; border:1px solid var(--lb-line2); background-color:var(--lb-s2); color:var(--lb-fg2); font-size:13px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat; background-position:right 12px center; max-width:100%; }
.lib .lb-sel option { background-color:var(--lb-surface); color:var(--lb-fg); }
.lb-text { height:38px; width:100%; padding:0 12px; border-radius:9px; border:1px solid var(--lb-line2); background:var(--lb-s2); color:var(--lb-fg); }
.lb-text::placeholder { color:var(--lb-fg3); }
.lb-err { color:var(--lb-warn); font-size:12.5px; }
.lb-err:empty { display:none; }
.lb-cols { display:flex; flex-wrap:wrap; gap:18px; align-items:flex-start; }
.lb-side { flex:1 1 210px; max-width:230px; display:flex; flex-direction:column; gap:16px; min-width:0; }
.lb-side__sec { display:flex; flex-direction:column; gap:2px; }
.lb-side__h { padding:0 10px 6px; font:400 11.5px var(--lb-body); letter-spacing:.04em; text-transform:uppercase; color:var(--lb-fg4); }
.lb-side__list { display:flex; flex-direction:column; gap:2px; }
.lb-nav { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; height:36px; padding:0 10px; border-radius:8px; border:0; background:transparent; color:var(--lb-fg2); font-size:13.5px; text-align:left; }
.lb-nav:hover { background:var(--lb-neu-soft); color:var(--lb-fg); }
.lb-nav[aria-current="true"] { background:var(--lb-s3); box-shadow:inset 0 0 0 1px var(--lb-line2); color:var(--lb-fg); }
.lb-nav__l { display:inline-flex; align-items:center; gap:9px; min-width:0; }
.lb-nav__l > span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lb-nav--smart { border:1px solid var(--lb-line); }
.lb-nav--smart[aria-current="true"] { border-color:var(--lb-line2); }
.lb-nav--col { height:32px; font-size:13px; }
.lb-n { font:400 11.5px var(--lb-mono); color:var(--lb-fg3); }
.lb-n--warn { color:var(--lb-warn); }
.lb-n--off { color:var(--lb-fg4); }
.lb-pip { width:7px; height:7px; border-radius:50%; background:var(--lb-warn); flex:0 0 auto; }
.lb-pip--off { background:var(--lb-fg4); }
.lb-main { flex:999 1 520px; min-width:0; display:flex; flex-direction:column; gap:12px; }
.lb-tools { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.lb-input { flex:1 1 280px; min-width:0; display:flex; align-items:center; gap:10px; height:38px; padding:0 12px; border:1px solid var(--lb-line2); border-radius:9px; background:var(--lb-s2); color:var(--lb-fg3); }
.lib .lb-input input:focus { box-shadow:none; border-color:transparent !important; }
.lb-input:focus-within { outline:2px solid var(--lb-signal); outline-offset:2px; }
.lb-input input { flex:1 1 auto; width:100%; min-width:0; height:100%; border:0; outline:0; background:transparent; color:var(--lb-fg); font:400 14px var(--lb-body); }
.lb-input input::placeholder { color:var(--lb-fg3); }
.lb-listing { display:flex; flex-direction:column; gap:12px; }
.lb-hd { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:8px; }
.lb-hd__l { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; min-width:0; }
.lb-h2 { font:500 19px/1.3 var(--lb-display); letter-spacing:-.01em; overflow-wrap:anywhere; }
.lb-meta { font-size:12.5px; color:var(--lb-fg3); }
.lb-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); gap:12px; }
.lb-tile { position:relative; display:flex; flex-direction:column; min-width:0; border-radius:12px; border:1px solid var(--lb-line); background:var(--lb-surface); overflow:hidden; }
.lb-tile[data-sel="1"] { border-color:var(--lb-signal); box-shadow:0 0 0 1px var(--lb-signal); }
.lb-tile__main { display:flex; flex-direction:column; width:100%; padding:0; border:0; background:transparent; color:inherit; text-align:left; }
.lb-thumb { position:relative; display:flex; align-items:center; justify-content:center; width:100%; aspect-ratio:4 / 4.4; overflow:hidden; background:linear-gradient(145deg, var(--lb-pa), var(--lb-pb)); color:var(--lb-pi); }
.lb-thumb > svg { opacity:.85; }
.lb-thumb img, .lb-thumb video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; }
.lb-thumb--logo img { object-fit:contain; padding:14%; }
.lb-thumb--color { background:var(--lb-c); }
.lb-hex { position:absolute; right:8px; bottom:8px; font:400 10.5px var(--lb-mono); padding:2px 7px; border-radius:5px; background:var(--lb-scrim); color:var(--lb-scrim-ink); }
.lb-kind { position:absolute; left:8px; bottom:8px; font:400 10.5px var(--lb-mono); padding:2px 7px; border-radius:5px; background:var(--lb-scrim); color:var(--lb-scrim-ink); max-width:calc(100% - 16px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lb-cap { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:9px 11px 10px; }
.lb-name { min-width:0; font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lb-dot { flex:0 0 auto; width:8px; height:8px; border-radius:50%; }
.lb-dot--ok { background:var(--lb-ok); }
.lb-dot--warn { background:var(--lb-warn); }
.lb-chk { position:absolute; left:2px; top:2px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; cursor:pointer; }
.lb-chk input { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; }
.lb-chk__box { width:20px; height:20px; border-radius:6px; border:1.5px solid var(--lb-chk-line); background:var(--lb-chk-bg); display:flex; align-items:center; justify-content:center; color:var(--lb-ink); pointer-events:none; }
.lb-chk__box svg { display:none; }
.lb-chk input:checked + .lb-chk__box { border-color:var(--lb-signal); background:var(--lb-signal); }
.lb-chk input:checked + .lb-chk__box svg { display:block; }
.lb-chk input:focus-visible + .lb-chk__box { outline:2px solid var(--lb-signal); outline-offset:2px; }
.lb-legend { font-size:12px; color:var(--lb-fg3); }
.lb-empty { border:1px dashed var(--lb-line2); border-radius:12px; padding:28px 20px; display:flex; flex-direction:column; align-items:flex-start; gap:8px; color:var(--lb-fg2); }
.lb-empty .lb-h3 { color:var(--lb-fg); }
.lb-empty__acts { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.lb-load { padding:28px 4px; color:var(--lb-fg3); display:flex; align-items:center; gap:10px; }
.lb-skel { display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); gap:12px; }
.lb-skel > div { aspect-ratio:4 / 5.4; border-radius:12px; border:1px solid var(--lb-line); background:linear-gradient(90deg, var(--lb-surface), var(--lb-s3), var(--lb-surface)); background-size:200% 100%; animation:lb-wait 1.4s ease-in-out infinite; }
@keyframes lb-wait { 0% { background-position:100% 0; } 100% { background-position:-100% 0; } }
.lb-banner { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; padding:11px 14px; border-radius:10px; border:1px solid color-mix(in srgb, var(--lb-warn) 40%, transparent); background:var(--lb-warn-soft); color:var(--lb-fg); font-size:13.5px; }
.lb-banner .lb-btn { background:var(--lb-surface); color:var(--lb-fg); }
.lb-banner__t { flex:1 1 220px; min-width:0; overflow-wrap:anywhere; }
.lb-detail { flex:1 1 340px; max-width:380px; min-width:0; display:flex; flex-direction:column; gap:12px; }
.lb-panel { border:1px solid var(--lb-line); border-radius:12px; background:var(--lb-surface); overflow:hidden; display:flex; flex-direction:column; }
.lb-panel:focus { outline:none; }
.lb-back { display:none; align-self:flex-start; margin:12px 16px 0; }
.lb-prev { position:relative; display:flex; align-items:center; justify-content:center; aspect-ratio:4 / 3.1; overflow:hidden; background:linear-gradient(145deg, var(--lb-pa), var(--lb-pb)); color:var(--lb-pi); }
.lb-prev img, .lb-prev video { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block; }
.lb-prev--audio { flex-direction:column; gap:14px; }
.lb-prev audio { position:relative; width:calc(100% - 32px); }
.lb-prev--color { background:var(--lb-c); }
.lb-prev .lb-hex { font-size:12px; }
.lb-panel__body { padding:16px; display:flex; flex-direction:column; gap:14px; min-width:0; }
.lb-panel__top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.lb-panel__top .lb-h2 { min-width:0; }
.lb-badge { flex:0 0 auto; font:400 11px var(--lb-mono); padding:3px 8px; border-radius:5px; background:var(--lb-signal-soft); color:var(--lb-signal); }
.lb-ai { display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px; border-radius:10px; background:var(--lb-s2); border:1px solid var(--lb-line); }
.lb-ai__k { font-size:12px; color:var(--lb-fg3); }
.lb-ai p { font-size:13.5px; color:var(--lb-fg2); overflow-wrap:anywhere; }
.lb-tags { display:flex; flex-wrap:wrap; gap:6px; }
.lb-tag { height:24px; display:inline-flex; align-items:center; padding:0 9px; border-radius:999px; background:var(--lb-s4); color:var(--lb-fg2); font-size:12px; }
.lb-sheet { display:flex; flex-direction:column; gap:8px; padding:12px; border-radius:10px; border:1px solid var(--lb-line); background:var(--lb-s2); }
.lb-sheet__hd { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
.lb-sheet__t { font-size:12.5px; font-weight:500; }
.lb-sheet__img { display:block; aspect-ratio:1 / 1; border-radius:8px; overflow:hidden; border:1px solid var(--lb-line); background:var(--lb-s3); }
.lb-sheet__img img { width:100%; height:100%; object-fit:contain; display:block; }
.lb-sheet__wait { aspect-ratio:1 / 1; border-radius:8px; border:1px solid var(--lb-line); background:linear-gradient(90deg, var(--lb-s2), var(--lb-s4), var(--lb-s2)); background-size:200% 100%; animation:lb-wait 1.2s ease-in-out infinite; }
.lb-bar { height:4px; border-radius:999px; background:var(--lb-neu-soft); overflow:hidden; }
.lb-bar > span { display:block; height:100%; width:42%; background:var(--lb-signal); }
.lb-acts { display:flex; flex-direction:column; gap:8px; }
.lb-acts__row { display:flex; gap:8px; }
.lb-acts__row .lb-btn { flex:1 1 0; min-width:0; padding:0 8px; }
.lb-foot { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 14px; padding-top:12px; border-top:1px solid var(--lb-line); }
.lb-foot__l { display:flex; flex-wrap:wrap; align-items:center; gap:6px 14px; }
.lb-kindsel { position:relative; display:inline-flex; }
.lb-kindsel > span { color:var(--lb-fg2); font-size:13px; text-decoration:underline; text-underline-offset:3px; }
.lb-kindsel select { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
.lb-kindsel:focus-within { outline:2px solid var(--lb-signal); outline-offset:3px; border-radius:3px; }
.lb-kindsel:hover > span { color:var(--lb-fg); }
.lb-bulk { padding:16px; gap:14px; }
.lb-bulk__top { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.lb-thumbs { display:flex; gap:8px; }
.lb-thumbs > span { flex:1 1 0; min-width:0; aspect-ratio:1; border-radius:9px; border:1px solid var(--lb-line); overflow:hidden; position:relative; background:linear-gradient(145deg, var(--lb-pa), var(--lb-pb)); }
.lb-thumbs img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.lb-thumbs .lb-more { display:flex; align-items:center; justify-content:center; color:var(--lb-fg2); font:400 12px var(--lb-mono); background:var(--lb-s3); }
.lb-acts .lb-sel { width:100%; height:40px; }
.lb-acts .lb-field { width:100%; }
.lb-note { padding:14px 16px; border:1px solid var(--lb-line); border-radius:12px; background:var(--lb-surface); color:var(--lb-fg2); font-size:13px; }
.lb-selbar { display:none; position:fixed; left:12px; right:76px; bottom:12px; z-index:40; align-items:center; justify-content:space-between; gap:10px; padding:8px 8px 8px 14px; border-radius:11px; border:1px solid var(--lb-line2); background:var(--lb-surface); box-shadow:0 10px 30px var(--lb-shadow); }
.lb-draft .lb-cap { flex-direction:column; align-items:stretch; gap:8px; }
.lb-draft__acts { display:flex; flex-wrap:wrap; gap:6px; }
.lb-past { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px; }
.lb-pastcard { position:relative; display:flex; flex-direction:column; border:1px solid var(--lb-line); border-radius:10px; overflow:hidden; background:var(--lb-s2); cursor:pointer; }
.lb-pastcard:has(input:checked) { border-color:var(--lb-signal); box-shadow:0 0 0 1px var(--lb-signal); }
.lb-pastcard .lb-thumb { aspect-ratio:1; }
.lb-pastcard span.lb-pastcard__t { display:flex; align-items:center; gap:6px; padding:7px 9px; font-size:12px; color:var(--lb-fg2); }
.lb-pastcard span.lb-pastcard__t span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lb-pastcard input { margin:0; accent-color:var(--lb-signal); }
@media (max-width: 899px) {
  .lb-side { flex-basis:100%; max-width:none; gap:10px; }
  .lb-side__sec { gap:4px; }
  .lb-side__list { flex-direction:row; overflow-x:auto; padding-bottom:4px; scrollbar-width:thin; }
  .lb-side__list .lb-nav { width:auto; flex:0 0 auto; height:34px; border:1px solid var(--lb-line); }
  .lb-side__list .lb-nav[aria-current="true"] { border-color:var(--lb-line2); }
  .lb-nav__l { white-space:nowrap; }
  .lb-nav { gap:10px; }
  .lb-side__sec--smart { flex-direction:row; flex-wrap:wrap; }
  .lb-side__sec--smart .lb-nav { width:auto; flex:1 1 150px; }
  .lb-main { flex-basis:100%; }
  .lb-detail { flex-basis:100%; max-width:none; }
  .lb-detail:not([data-open="1"]) { display:none; }
  .lb-back { display:inline-flex; }
  .lb-selbar { display:flex; }
  .lb-brand__note { margin-left:0; max-width:none; }
}
@media (max-width: 520px) { .lb-grid, .lb-skel { grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); } .lb-input { flex-basis:170px; } .lb-h1 { font-size:24px; } .lb-brand, .lb-card { padding:14px; } .lb-title__r { width:100%; } .lb-menu { right:auto; left:0; } .lb-grid, .lb-skel { gap:10px; } }
@media (pointer: coarse) { .lb-btn, .lb-btn--sm { min-height:44px; } .lb-nav { min-height:44px; } .lb-sw { min-height:44px; } .lib .lb-sel, .lb-text, .lb-input { min-height:44px; } .lb-link, .lb-kindsel { min-height:32px; display:inline-flex; align-items:center; } }
`;
    document.head.appendChild(st);
  }

  /* ───────────────────────── icons ───────────────────────── */

  const SVG = (d, w, sw) => `<svg width="${w || 15}" height="${w || 15}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const ICON = {
    search: SVG('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4'),
    plus: SVG('M12 5v14 M5 12h14', 14, 2.2),
    down: SVG('M6 9l6 6 6-6', 12, 2.2),
    check: SVG('M5 12l5 5 9-10', 12, 3),
  };
  const kindIcon = (kind, w, sw) => SVG(iconFor(kind), w, sw);
  const groupIcon = (gid) => SVG(ICON_PATH[GROUP_ICON[gid] || 'other'] || ICON_PATH.other, 15, 1.6);

  /* ───────────────────────── the page ───────────────────────── */

  // Kept between visits: drafts that have not been added or rejected, past posts already loaded, sheets being made.
  const keep = { drafts: [], pastItems: [], pastLoaded: false, busySheet: {} };
  let active = null;

  function mount(content, deps) {
    if (!content) return;
    if (active) active.destroy();
    injectStyles();
    deps = deps || {};

    const A = deps.assets || global.SEAssets || {};
    const variant = deps.variant === 'charity' || deps.variant === 'store' ? deps.variant : 'brand';
    const isStill = A.isStillKind || ((k) => ['scene', 'character', 'plate', 'logo', 'item', 'setting', 'style'].includes(String(k || '')));
    const kindLabel = A.kindLabel || ((k) => String(k || 'Asset'));
    const labelOf = A.labelOf || ((a) => clean(a && a.name) || kindLabel(a && a.kind));
    const persistFamily = A.persistFamily || (() => '');
    const retagKinds = A.retagKinds || ((k) => [k]);
    const acceptFor = A.acceptFor || (() => '*/*');
    const ctx = { variant, kindLabel, isStill };
    const toast = (m, k, o) => { if (typeof deps.toast === 'function') deps.toast(m, k, o); else if (typeof global.showToast === 'function') global.showToast(m, k, o); };
    const confirmFn = typeof deps.confirm === 'function' ? deps.confirm : (m) => global.confirm(m);
    const promptFn = typeof deps.prompt === 'function' ? deps.prompt : (m, v) => global.prompt(m, v);

    const COPY = variant === 'store'
      ? { sub: 'Everything Create and Coach can use: your logo, colors, products, models, places and looks.', ph: 'Search by name, product, person or place' }
      : variant === 'charity'
        ? { sub: 'Everything Create and Coach can use: your logo, colors, people, places, things and looks.', ph: 'Search by name, person or place' }
        : { sub: 'Everything Create and Coach can use: your logo, colors, people, places, things and looks.', ph: 'Search by name, person or place' };

    const S = {
      assets: [], loaded: false, loadErr: '',
      view: 'all', query: '', sort: 'new',
      focus: null, explicit: false, checked: new Set(), panelOpen: false,
      menu: false, cards: { up: false, past: false, gen: false },
      busy: {}, pastBusy: false, upErr: '',
    };
    let dead = false;
    let onDocClick = null;
    let lastLive = '';

    const kindOptions = ['scene', 'character', 'item', 'setting', 'style', 'plate', 'shot', 'outro', 'intro', 'music', 'logo', 'video'];
    const chip = (k) => chipLabel(k, variant, kindLabel);

    content.innerHTML = `<div class="lib" id="brand-library" data-variant="${esc(variant)}">
      <div class="lb-title">
        <div><h1 class="lb-h1">Library</h1><p class="lb-sub">${esc(COPY.sub)}</p></div>
        <div class="lb-title__r" id="lb-actions"></div>
      </div>
      <section class="lb-brand" id="lb-brand" aria-label="Logo and colors"></section>
      <section class="lb-card" id="lb-up" aria-label="Upload files" hidden>
        <h3 class="lb-h3">Upload files</h3>
        <p class="lb-hint">Say what the files are, and name a collection if you like. Pictures, video and music all work.</p>
        <div class="lb-row">
          <label class="lb-field"><span>Type</span>
            <select id="brand-lib-kind" class="lb-sel">${kindOptions.map((k) => `<option value="${esc(k)}">${esc(chip(k))}</option>`).join('')}</select></label>
          <label class="lb-field lb-field--grow"><span>Collection</span>
            <input id="brand-lib-collection" class="lb-text" type="text" list="lb-colls" placeholder="Collection name (optional)" autocomplete="off"></label>
          <datalist id="lb-colls"></datalist>
          <input type="file" id="brand-lib-file" multiple hidden>
          <button type="button" class="lb-btn lb-btn--signal lb-btn--lg" id="brand-lib-upload" data-a="choose" data-fk="choose">Choose files</button>
          <button type="button" class="lb-btn lb-btn--lg" data-a="close-card" data-card="up">Close</button>
        </div>
        <p class="lb-err" id="lb-up-err" role="alert"></p>
      </section>
      <section class="lb-card" id="lb-past" aria-label="Import past content" hidden>
        <h3 class="lb-h3">Import past content</h3>
        <p class="lb-hint">Pick finished posts to save as Style stills. Coach can match that look when you say yes. Video-only rows without a still are skipped.</p>
        <div id="lb-past-body"></div>
        <div><button type="button" class="lb-btn" data-a="close-card" data-card="past">Close</button></div>
      </section>
      <section class="lb-card" id="lb-gen" aria-label="Make diagrams" hidden>
        <h3 class="lb-h3">Make diagrams</h3>
        <p class="lb-hint">FigureLabs diagrams only: medical, scientific or technical. Tick 2 to 8 pictures in the grid as references. Not for fashion or product shots.</p>
        <div class="lb-row">
          <label class="lb-field lb-field--grow"><span>What to make</span>
            <input id="brand-lib-gen-prompt" class="lb-text" type="text" placeholder="5 labeled diagrams: anatomy, equipment, process" autocomplete="off"></label>
          <label class="lb-field"><span>Save as</span>
            <select id="brand-lib-gen-kind" class="lb-sel"><option value="scene">${esc(chip('scene'))}</option><option value="character">${esc(chip('character'))}</option><option value="plate">${esc(chip('plate'))}</option></select></label>
          <button type="button" class="lb-btn lb-btn--signal lb-btn--lg" id="brand-lib-generate" data-a="generate" data-fk="generate">Generate</button>
          <button type="button" class="lb-btn lb-btn--lg" data-a="close-card" data-card="gen">Close</button>
        </div>
        <p class="lb-hint" id="lb-gen-count"></p>
      </section>
      <div class="lb-cols">
        <nav class="lb-side" id="lb-side" aria-label="Browse the Library"></nav>
        <section class="lb-main" aria-label="Items">
          <div class="lb-tools">
            <label class="lb-input" for="brand-lib-filter">${ICON.search}<span class="lb-sr">Search the Library</span>
              <input id="brand-lib-filter" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(COPY.ph)}"></label>
            <label><span class="lb-sr">Sort</span>
              <select id="lb-sort" class="lb-sel">${SORTS.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select></label>
          </div>
          <div class="lb-listing" id="lb-listing"></div>
          <div class="lb-selbar" id="lb-selbar"></div>
        </section>
        <aside class="lb-detail" id="lb-aside" aria-label="Details"></aside>
      </div>
      <div class="lb-sr" id="lb-live" role="status" aria-live="polite"></div>
    </div>`;

    const root = content.querySelector('#brand-library');
    const $ = (sel) => root.querySelector(sel);
    const alive = () => !dead && root.isConnected;
    const live = (msg) => { if (msg === lastLive) return; lastLive = msg; const el = $('#lb-live'); if (el) el.textContent = msg; };
    const byId = (id) => S.assets.find((a) => String(a.id) === String(id)) || null;
    const draftId = (d) => String(d.id || d.url);

    /* ── network ── */
    async function call(path, method, body, fallback) {
      const opts = { method: method || 'GET' };
      if (typeof FormData !== 'undefined' && body instanceof FormData) opts.body = body;
      else if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = typeof body === 'string' ? body : JSON.stringify(body); }
      const res = await deps.apiFetch(path, opts);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error((d && d.error) || fallback || 'Something went wrong');
        err.request_id = d && d.request_id;
        throw err;
      }
      return d || {};
    }

    /* ── focus-preserving render ── */
    function renderInto(host, html) {
      if (!host) return;
      const a = document.activeElement;
      const fk = a && host.contains(a) && a.getAttribute ? a.getAttribute('data-fk') : null;
      host.innerHTML = html;
      if (fk) { const n = host.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n && !n.disabled) n.focus(); }
    }

    /* ── what is showing ── */
    function reviewView() { const v = parseView(S.view); return v.type === 'smart' && v.id === 'review'; }

    function visible() {
      const sorted = sortAssets(filterAssets(S.assets, S.view, S.query, ctx), S.sort, labelOf);
      const v = parseView(S.view);
      return S.sort === 'name' || (v.type === 'group' && v.id === 'brand') ? sorted : brandLast(sorted);
    }

    function needsLabelCount() { return S.assets.filter((a) => labelState(a, isStill) === 'unlabeled').length; }

    /** Keep the focus and the ticks pointing at things that still exist and are still showing. */
    function reconcile(list) {
      const ids = new Set(S.assets.map((a) => String(a.id)));
      for (const id of [...S.checked]) if (!ids.has(String(id))) S.checked.delete(id);
      if (reviewView()) { S.focus = null; return; }
      const shown = list || visible();
      if (!S.focus || !shown.some((a) => String(a.id) === String(S.focus))) { S.focus = shown.length ? String(shown[0].id) : null; S.explicit = false; }
    }

    function setAssets(next) {
      S.assets = Array.isArray(next) ? next : [];
      S.loaded = true; S.loadErr = '';
      paintAll();
    }

    /* ── painting ── */
    function paintAll() {
      if (!alive()) return;
      paintActions();
      paintBrand();
      paintSide();
      paintCards();
      paintListing();
    }

    function paintActions() {
      const menu = addMenu(variant);
      const harvesting = !!S.busy.harvest;
      renderInto($('#lb-actions'), `
        <button type="button" class="lb-btn lb-btn--top" id="brand-lib-harvest" data-a="harvest" data-fk="harvest" ${harvesting ? 'disabled' : ''}>${harvesting ? '<span class="lb-spin" aria-hidden="true"></span>Importing' : 'Import from website'}</button>
        <div class="lb-addwrap">
          <button type="button" class="lb-btn lb-btn--top lb-btn--signal" id="lb-add" data-a="menu" data-fk="menu" aria-haspopup="menu" aria-expanded="${S.menu}" aria-controls="lb-menu">${ICON.plus}Add${ICON.down}</button>
          <div class="lb-menu" id="lb-menu" role="menu" aria-label="Add to the Library" ${S.menu ? '' : 'hidden'}>
            ${menu.map((m) => `<button type="button" role="menuitem" class="lb-menu__i" id="${m.id === 'past' ? 'brand-lib-import-past' : 'lb-m-' + esc(m.id)}" data-a="menu-item" data-item="${esc(m.id)}" data-fk="mi-${esc(m.id)}">${esc(m.label)}<span>${esc(m.hint)}</span></button>`).join('')}
          </div>
        </div>`);
    }

    function paintBrand() {
      const logo = S.assets.find((a) => a && a.kind === 'logo' && safeUrl(a.url));
      const logoCount = S.assets.filter((a) => a && a.kind === 'logo').length;
      const colors = S.assets.filter((a) => a && a.kind === 'color' && safeHex(a.hex || a.url));
      const initials = initialsOf(deps.clientName);
      const logoCaption = logo ? `${labelOf(logo)}${logoCount > 1 ? `, and ${logoCount - 1} more` : ''}` : (S.loaded ? 'No logo yet' : 'Loading');
      $('#lb-brand').innerHTML = `
        <div class="lb-brand__logo">
          <span class="lb-logo" ${logo ? '' : 'aria-hidden="true"'}>${logo ? `<img src="${esc(safeUrl(logo.url))}" alt="Your logo" referrerpolicy="no-referrer">` : esc(initials)}</span>
          <span class="lb-brand__t"><b>Logo</b><span title="${esc(logoCaption)}">${esc(logoCaption)}</span></span>
        </div>
        <div class="lb-brand__colors">
          <span class="lb-brand__lbl">${!S.loaded ? 'Loading colors' : colors.length ? 'Colors. Click one to copy its code.' : 'No colors yet. Choose Import from website to pull in your logo and colors.'}</span>
          ${colors.length ? `<div class="lb-sw-row">${colors.map((c) => {
            const hex = safeHex(c.hex || c.url);
            return `<button type="button" class="lb-sw" data-a="copy" data-hex="${esc(hex)}" title="Copy ${esc(hex)}" aria-label="Copy color ${esc(hex)}"><span class="lb-sw__c" style="--lb-c:${hexToHsl(hex)}"></span>${esc(hex)}</button>`;
          }).join('')}</div>` : ''}
        </div>
        <span class="lb-brand__note">Create and Coach can use these when you say yes.</span>`;
    }

    function navBtn(view, label, count, opts) {
      const o = opts || {};
      const on = S.view === view;
      return `<button type="button" class="lb-nav ${o.cls || ''}" data-a="view" data-view="${esc(view)}" data-fk="v-${esc(view)}" aria-current="${on}">
        <span class="lb-nav__l">${o.pip ? `<span class="lb-pip ${count ? '' : 'lb-pip--off'}" aria-hidden="true"></span>` : (o.icon || '')}<span>${esc(label)}</span></span>
        <span class="lb-n ${o.warn && count ? 'lb-n--warn' : ''}${o.warn && !count ? 'lb-n--off' : ''}">${count}</span></button>`;
    }

    function paintSide() {
      const rows = typeCounts(S.assets, variant);
      const colls = collectionsOf(S.assets);
      renderInto($('#lb-side'), `
        <div class="lb-side__sec lb-side__sec--smart">
          ${navBtn('smart:label', 'Needs a label', needsLabelCount(), { cls: 'lb-nav--smart', pip: true, warn: true })}
          ${navBtn('smart:review', 'To review', keep.drafts.length, { cls: 'lb-nav--smart', pip: true, warn: true })}
        </div>
        <div class="lb-side__sec"><h3 class="lb-side__h">Type</h3>
          <div class="lb-side__list">${rows.map((r) => navBtn(r.id === 'all' ? 'all' : `g:${r.id}`, r.label, r.count, { icon: groupIcon(r.id === 'all' ? 'scenes' : r.id) })).join('')}</div></div>
        <div class="lb-side__sec"><h3 class="lb-side__h">Collections</h3>
          <div class="lb-side__list">${colls.length
            ? colls.map((c) => navBtn(`c:${c.name}`, c.name, c.count, { cls: 'lb-nav--col' })).join('')
            : '<p class="lb-meta" style="padding:0 10px">None yet. Name one when you upload.</p>'}</div></div>`);
      const dl = $('#lb-colls');
      if (dl) dl.innerHTML = colls.map((c) => `<option value="${esc(c.name)}"></option>`).join('');
    }

    function paintCards() {
      $('#lb-up').hidden = !S.cards.up;
      $('#lb-past').hidden = !S.cards.past;
      $('#lb-gen').hidden = !(S.cards.gen && variant === 'charity');
      $('#lb-up-err').textContent = S.upErr;
      const up = $('#brand-lib-upload');
      if (up) { up.disabled = !!S.busy.upload; up.innerHTML = S.busy.upload ? '<span class="lb-spin" aria-hidden="true"></span>Uploading' : 'Choose files'; }
      paintGenCount();
      if (S.cards.past) paintPast();
    }

    function stillTicked() {
      return [...S.checked].map(byId).filter((a) => a && isStill(a.kind));
    }

    function paintGenCount() {
      const n = stillTicked().length;
      const el = $('#lb-gen-count'); if (el) el.textContent = genStatus(n);
      const btn = $('#brand-lib-generate');
      if (btn) { btn.disabled = !!S.busy.gen; btn.innerHTML = S.busy.gen ? '<span class="lb-spin" aria-hidden="true"></span>Generating' : 'Generate'; }
    }

    function paintPast() {
      const body = $('#lb-past-body');
      if (!body) return;
      if (S.pastBusy) { body.innerHTML = '<p class="lb-hint"><span class="lb-spin" aria-hidden="true"></span> Loading your past posts</p>'; return; }
      const cards = (keep.pastItems || []).filter((it) => safeUrl(it.image_url)).map((it) => `
        <label class="lb-pastcard">
          <span class="lb-thumb lb-c-k"><img src="${esc(safeUrl(it.image_url))}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
          <span class="lb-pastcard__t"><input type="checkbox" data-past-pick data-past-url="${esc(safeUrl(it.image_url))}" data-past-title="${esc(it.title || 'Past post')}" data-past-id="${esc(it.id || '')}"><span>${esc(it.title || 'Past post')}</span></span>
        </label>`).join('');
      body.innerHTML = cards
        ? `<div class="lb-past">${cards}</div><div style="margin-top:12px"><button type="button" class="lb-btn lb-btn--signal" id="brand-lib-past-add" data-a="past-add" data-fk="past-add" ${S.busy.pastAdd ? 'disabled' : ''}>Add selected as Style</button></div>`
        : '<p class="lb-hint">No past stills yet. Publish or generate a post with an image first.</p>';
    }

    function tileThumb(a) {
      const fam = previewFamily(a, persistFamily);
      const tint = tintOf(a.kind);
      if (fam === 'color') {
        const hex = safeHex(a.hex || a.url);
        return `<span class="lb-thumb lb-thumb--color" style="--lb-c:${hexToHsl(hex) || 'hsl(220 10% 30%)'}"><span class="lb-kind">${esc(chip(a.kind))}</span><span class="lb-hex">${esc(hex)}</span></span>`;
      }
      const media = fam === 'image' ? `<img src="${esc(safeUrl(a.url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : fam === 'video' ? `<video src="${esc(safeUrl(a.url))}" muted preload="metadata" playsinline></video>` : '';
      return `<span class="lb-thumb lb-c-${tint} ${a.kind === 'logo' ? 'lb-thumb--logo' : ''}">${kindIcon(a.kind, 46, 1.2)}${media}<span class="lb-kind">${esc(chip(a.kind))}</span></span>`;
    }

    function tileHtml(a) {
      const id = String(a.id);
      const name = labelOf(a);
      const ticked = S.checked.has(id);
      const on = ticked || (!S.checked.size && S.focus === id);
      const ls = labelState(a, isStill);
      return `<div class="lb-tile" role="listitem" data-id="${esc(id)}" data-sel="${on ? 1 : 0}">
        <button type="button" class="lb-tile__main" data-a="pick" data-id="${esc(id)}" data-fk="t-${esc(id)}" aria-current="${on}" aria-label="${esc(name)}, ${esc(chip(a.kind))}${ls === 'unlabeled' ? ', needs a label' : ''}">
          ${tileThumb(a)}
          <span class="lb-cap"><span class="lb-name">${esc(name)}</span>${ls === 'none' ? '' : `<span class="lb-dot lb-dot--${ls === 'labeled' ? 'ok' : 'warn'}" title="${ls === 'labeled' ? 'Labeled' : 'Needs a label'}"></span>`}</span>
        </button>
        <label class="lb-chk"><input type="checkbox" data-a="check" data-asset-select="${esc(id)}" data-fk="c-${esc(id)}" aria-label="Select ${esc(name)}" ${ticked ? 'checked' : ''}><span class="lb-chk__box" aria-hidden="true">${ICON.check}</span></label>
      </div>`;
    }

    function draftTile(d) {
      const id = draftId(d);
      const url = safeUrl(d.url);
      return `<div class="lb-tile lb-draft" role="listitem" data-draft-id="${esc(id)}">
        <span class="lb-thumb lb-c-k">${kindIcon(d.kind || 'scene', 46, 1.2)}${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="lb-kind">Draft</span></span>
        <span class="lb-cap"><span class="lb-name" title="${esc(d.name || 'Draft')}">${esc(d.name || 'Draft')}</span>
          <span class="lb-draft__acts">
            <button type="button" class="lb-btn lb-btn--sm lb-btn--signal" data-a="draft-accept" data-id="${esc(id)}" data-draft-accept="${esc(id)}" data-fk="da-${esc(id)}">Add to library</button>
            <button type="button" class="lb-btn lb-btn--sm" data-a="draft-use" data-id="${esc(id)}" data-draft-use="${esc(id)}" data-fk="du-${esc(id)}">Use in a post</button>
            <button type="button" class="lb-btn lb-btn--sm" data-a="draft-reject" data-id="${esc(id)}" data-draft-reject="${esc(id)}" data-fk="dr-${esc(id)}">Reject</button>
          </span></span>
      </div>`;
    }

    function paintListing() {
      const review = reviewView();
      const shown = review ? [] : visible();
      reconcile(shown);
      const rows = typeCounts(S.assets, variant);
      const title = viewTitle(S.view, rows);
      const total = S.assets.length;
      const unl = needsLabelCount();
      let body = '';
      if (!S.loaded && !S.loadErr) {
        body = `<div class="lb-skel" aria-hidden="true">${'<div></div>'.repeat(8)}</div><p class="lb-sr">Loading the Library</p>`;
      } else if (S.loadErr && !S.assets.length) {
        body = `<div class="lb-banner" role="alert"><span class="lb-banner__t">${esc(S.loadErr)}</span><button type="button" class="lb-btn" data-a="reload" data-fk="reload">Try again</button></div>`;
      } else if (review) {
        body = keep.drafts.length
          ? `<div class="lb-grid" role="list">${keep.drafts.map(draftTile).join('')}</div>`
          : emptyHtml(emptyCopy(S.view, S.query, total, variant), false);
      } else if (!shown.length) {
        body = emptyHtml(emptyCopy(S.view, S.query, total, variant), !total);
      } else {
        body = `<div class="lb-grid" role="list" aria-label="${esc(title)}">${shown.map(tileHtml).join('')}</div>`;
      }
      const hint = !S.loaded || (S.loadErr && !total) ? '' : review ? `${pluralize(keep.drafts.length, 'draft')}. Not saved until you add them.` : countLine(shown.length, total, S.sort);
      const canLabelAll = S.loaded && !review && unl > 0;
      renderInto($('#lb-listing'), `
        <div class="lb-hd">
          <div class="lb-hd__l"><h2 class="lb-h2">${esc(title)}</h2><span class="lb-meta">${esc(hint)}</span></div>
          ${canLabelAll ? `<button type="button" class="lb-btn lb-btn--sm" id="brand-lib-label-missing" data-a="label-missing" data-fk="label-missing" ${S.busy.labelAll ? 'disabled' : ''}>${S.busy.labelAll ? '<span class="lb-spin" aria-hidden="true"></span>Labeling' : `Label ${unl} with AI`}</button>` : ''}
        </div>
        ${body}
        ${S.loaded && total && !review ? '<p class="lb-legend">A green dot means the picture has an AI label that Create and Coach can search. An amber dot means it has no label yet. Video, music and colors are not labeled.</p>' : ''}`);
      paintAside(shown);
      paintSelbar();
      paintGenCount();
      const msg = !S.loaded ? '' : review ? `To review, ${pluralize(keep.drafts.length, 'draft')}` : `${title}. ${countLine(shown.length, total, S.sort)}`;
      if (msg) live(msg);
    }

    function emptyHtml(c, offerAdd) {
      return `<div class="lb-empty"><h3 class="lb-h3">${esc(c.title)}</h3><p>${esc(c.body)}</p>
        ${offerAdd ? `<div class="lb-empty__acts"><button type="button" class="lb-btn lb-btn--signal" data-a="menu-item" data-item="upload" data-fk="e-up">Upload files</button><button type="button" class="lb-btn" data-a="harvest" data-fk="e-harvest">Import from website</button></div>`
          : (clean(S.query) || S.view !== 'all') && S.assets.length ? '<div class="lb-empty__acts"><button type="button" class="lb-btn" data-a="clear-filters" data-fk="e-clear">Show everything</button></div>' : ''}</div>`;
    }

    function paintSelbar() {
      const n = selectedIds(S.focus, S.checked).length;
      const bar = $('#lb-selbar');
      if (!S.checked.size) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
      bar.style.display = '';
      bar.innerHTML = `<span>${pluralize(n, 'item')} selected</span><button type="button" class="lb-btn lb-btn--sm lb-btn--signal" data-a="open-panel" data-fk="open-panel">See actions</button>`;
    }

    /* ── the panel on the right ── */
    function previewHtml(a) {
      const fam = previewFamily(a, persistFamily);
      const label = labelOf(a);
      if (fam === 'color') {
        const hex = safeHex(a.hex || a.url);
        return `<div class="lb-prev lb-prev--color" style="--lb-c:${hexToHsl(hex)}"><span class="lb-hex">${esc(hex)}</span></div>`;
      }
      const tint = tintOf(a.kind);
      const media = fam === 'image' ? `<img src="${esc(safeUrl(a.url))}" alt="${esc(label)}" referrerpolicy="no-referrer">`
        : fam === 'video' ? `<video src="${esc(safeUrl(a.url))}" controls playsinline preload="metadata"></video>`
          : fam === 'audio' ? `<audio controls src="${esc(safeUrl(a.url))}"></audio>` : '';
      return `<div class="lb-prev lb-c-${tint} ${fam === 'audio' ? 'lb-prev--audio' : ''}">${fam === 'video' ? '' : kindIcon(a.kind, fam === 'audio' ? 64 : 84, 0.9)}${media}</div>`;
    }

    function sheetHtml(a) {
      const info = sheetInfo(a, !!keep.busySheet[a.id]);
      if (!info.show) return '';
      return `<div class="lb-sheet" data-asset-views-of="${esc(a.id)}">
        <div class="lb-sheet__hd"><span class="lb-sheet__t">Turnaround sheet</span><span class="lb-meta">${esc(info.meta)}</span></div>
        ${info.url ? `<a class="lb-sheet__img" href="${esc(info.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open the turnaround sheet in a new tab"><img src="${esc(info.url)}" alt="Turnaround sheet for ${esc(labelOf(a))}" loading="lazy" referrerpolicy="no-referrer"></a>` : '<div class="lb-sheet__wait" aria-hidden="true"></div>'}
        ${info.busy ? '<div class="lb-bar" role="progressbar" aria-busy="true" aria-label="Making sheet"><span></span></div>' : ''}
      </div>`;
    }

    function singleHtml(a) {
      const id = String(a.id);
      const name = labelOf(a);
      const still = isStill(a.kind);
      const an = analysisOf(a);
      const ls = labelState(a, isStill);
      const busy = !!keep.busySheet[id];
      const info = sheetInfo(a, busy);
      const kinds = (retagKinds(a.kind, a.url) || [a.kind]).filter(Boolean);
      const kindOpts = (kinds.includes(a.kind) ? kinds : [a.kind, ...kinds]).map((k) => `<option value="${esc(k)}" ${k === a.kind ? 'selected' : ''}>${esc(chip(k))}</option>`).join('');
      const sheetable = ['character', 'item'].includes(a.kind);
      const extra = [
        still ? `<button type="button" class="lb-btn" data-a="more" data-id="${esc(id)}" data-asset-more="${esc(id)}" data-fk="more">More like this</button>` : '',
        sheetable ? `<button type="button" class="lb-btn" data-a="views" data-id="${esc(id)}" data-asset-views="${esc(id)}" data-fk="views" ${busy ? 'disabled' : ''}>${busy ? 'Making sheet…' : (info.canRemake ? 'Remake sheet' : 'Turnaround sheet')}</button>` : '',
      ].filter(Boolean).join('');
      const labelBtn = `<button type="button" class="lb-btn lb-btn--sm" data-a="analyze" data-id="${esc(id)}" data-asset-analyze="${esc(id)}" data-fk="analyze" ${S.busy['an:' + id] ? 'disabled' : ''}>${S.busy['an:' + id] ? '<span class="lb-spin" aria-hidden="true"></span>Labeling' : (ls === 'unlabeled' ? 'Label with AI' : 'Label again')}</button>`;
      const aiBox = still ? `<div class="lb-ai">
          <span class="lb-ai__k">What the AI sees.</span>
          ${ls === 'unlabeled'
            ? '<p>No label yet. Label it so Create and Coach can find it when you name it.</p>'
            : `${an.summary ? `<p>${esc(an.summary)}</p>` : ''}
               ${an.subjects.length ? `<div class="lb-tags">${an.subjects.map((t) => `<span class="lb-tag">${esc(t)}</span>`).join('')}</div>` : ''}
               ${an.aliases.length ? `<span class="lb-ai__k">Also called: ${esc(an.aliases.join(', '))}</span>` : ''}
               ${an.place ? `<span class="lb-ai__k">Place: ${esc(an.place)}</span>` : ''}`}
          ${labelBtn}
        </div>` : '';
      return `<section class="lb-panel" tabindex="-1" id="lb-panel" aria-label="Details for ${esc(name)}">
        <button type="button" class="lb-btn lb-btn--sm lb-back" data-a="close-panel" data-fk="back">Back to the grid</button>
        ${previewHtml(a)}
        <div class="lb-panel__body">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div class="lb-panel__top"><h2 class="lb-h2">${esc(name)}</h2><span class="lb-badge">${esc(chip(a.kind))}</span></div>
            ${metaLine(a) ? `<span class="lb-meta">${esc(metaLine(a))}</span>` : ''}
          </div>
          ${aiBox}
          ${info.show ? sheetHtml(a) : ''}
          ${still || extra ? `<div class="lb-acts">
            ${still ? `<button type="button" class="lb-btn lb-btn--signal lb-btn--lg lb-btn--block" data-a="use" data-id="${esc(id)}" data-asset-use="${esc(id)}" data-fk="use">Use in a post</button>` : ''}
            ${extra ? `<div class="lb-acts__row">${extra}</div>` : ''}
          </div>` : ''}
          <div class="lb-foot">
            <span class="lb-foot__l">
              <button type="button" class="lb-link" data-a="rename" data-id="${esc(id)}" data-asset-rename="${esc(id)}" data-fk="rename">Rename</button>
              <span class="lb-kindsel"><span aria-hidden="true">Change type</span><select data-asset-kind="${esc(id)}" data-a="kind" aria-label="Change type of ${esc(name)}" data-fk="kind">${kindOpts}</select></span>
            </span>
            <button type="button" class="lb-link lb-link--quiet" data-a="delete" data-id="${esc(id)}" data-asset-delete="${esc(id)}" data-fk="delete">Delete</button>
          </div>
        </div>
      </section>`;
    }

    function bulkHtml(ids) {
      const items = ids.map(byId).filter(Boolean);
      const n = items.length;
      const stills = items.filter((a) => isStill(a.kind));
      const unl = items.filter((a) => labelState(a, isStill) === 'unlabeled');
      const kinds = commonKinds(items, retagKinds);
      const thumbs = items.slice(0, 4).map((a) => {
        const fam = previewFamily(a, persistFamily);
        if (fam === 'color') return `<span style="--lb-c:${hexToHsl(safeHex(a.hex || a.url))};background:var(--lb-c)"></span>`;
        return `<span class="lb-c-${tintOf(a.kind)}">${fam === 'image' ? `<img src="${esc(safeUrl(a.url))}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
      }).join('') + (n > 4 ? `<span class="lb-more">+${n - 4}</span>` : '');
      return `<section class="lb-panel lb-bulk" tabindex="-1" id="lb-panel" aria-label="Selected items">
        <button type="button" class="lb-btn lb-btn--sm lb-back" style="margin:0" data-a="close-panel" data-fk="back">Back to the grid</button>
        <div class="lb-bulk__top"><h2 class="lb-h2">${n} selected</h2><button type="button" class="lb-link lb-link--quiet" data-a="clear" data-fk="clear">Clear</button></div>
        <div class="lb-thumbs">${thumbs}</div>
        <div class="lb-acts">
          ${stills.length ? `<button type="button" class="lb-btn lb-btn--signal lb-btn--lg lb-btn--block" data-a="bulk-label" data-fk="bulk-label" ${unl.length && !S.busy.bulk ? '' : 'disabled'} title="${unl.length ? '' : 'Every picture selected already has a label'}">${S.busy.bulk === 'label' ? '<span class="lb-spin" aria-hidden="true"></span>Labeling' : (unl.length ? `Label ${unl.length} with AI` : 'Already labeled')}</button>` : ''}
          ${variant === 'charity' && stills.length ? `<button type="button" class="lb-btn lb-btn--lg lb-btn--block" data-a="open-gen" data-fk="open-gen" ${genReady(stills.length) ? '' : 'disabled'} title="${genReady(stills.length) ? '' : 'Tick 2 to 8 pictures'}">Make diagrams</button>` : ''}
          ${kinds.length > 1 ? `<label class="lb-field"><span class="lb-sr">Change type of all ${n}</span><select class="lb-sel" data-a="bulk-kind" data-fk="bulk-kind"><option value="">Change type of all ${n}</option>${kinds.map((k) => `<option value="${esc(k)}">${esc(chip(k))}</option>`).join('')}</select></label>` : ''}
          <button type="button" class="lb-btn lb-btn--lg lb-btn--block lb-btn--quiet" data-a="bulk-delete" data-fk="bulk-delete" ${S.busy.bulk ? 'disabled' : ''}>Delete ${n}</button>
        </div>
      </section>`;
    }

    function paintAside(shown) {
      const host = $('#lb-aside');
      if (!host) return;
      host.setAttribute('data-open', S.panelOpen ? '1' : '0');
      if (!S.loaded || (S.loadErr && !S.assets.length)) { host.innerHTML = ''; return; }
      if (reviewView()) {
        host.innerHTML = keep.drafts.length ? '<p class="lb-note">These pictures are drafts. Nothing is saved until you choose Add to library. Rejecting one tells the next run what to avoid.</p>' : '';
        return;
      }
      const ids = selectedIds(S.focus, S.checked).filter((id) => byId(id));
      if (!ids.length) { host.innerHTML = ''; return; }
      renderInto(host, ids.length > 1 ? bulkHtml(ids) : singleHtml(byId(ids[0])));
    }

    /* ── actions ── */
    const setBusy = (k, v) => { if (v) S.busy[k] = v; else delete S.busy[k]; };

    async function loadAssets() {
      S.loaded = false; S.loadErr = '';
      paintAll();
      try {
        const fetcher = typeof deps.fetchAssets === 'function' ? deps.fetchAssets : async () => (await call('/api/assets', 'GET', undefined, 'Could not load the library')).assets || [];
        const assets = await fetcher();
        if (!alive()) return;
        S.assets = Array.isArray(assets) ? assets : [];
        S.loaded = true;
        paintAll();
      } catch (e) {
        if (!alive()) return;
        S.loaded = true; S.loadErr = (e && e.message) || 'Could not load the library';
        paintAll();
      }
    }

    function afterRemoval(idx) {
      const shown = visible();
      S.focus = shown.length ? String(shown[Math.min(Math.max(idx, 0), shown.length - 1)].id) : null;
    }

    async function harvest() {
      if (S.busy.harvest) return;
      setBusy('harvest', true); paintActions();
      try {
        const d = await call('/api/assets/harvest', 'POST', '{}', 'Harvest failed');
        setBusy('harvest', false);
        setAssets(d.assets || []);
        const n = (d.added || []).length;
        toast(n ? `Imported ${pluralize(n, 'logo or color', 'logos and colors')}` : 'Nothing new to import', 'success');
      } catch (err) {
        setBusy('harvest', false); paintActions();
        toast(err.message || 'Harvest failed', 'error');
      }
    }

    async function labelMissing() {
      if (S.busy.labelAll) return;
      setBusy('labelAll', true); paintListing();
      try {
        const d = await call('/api/assets/analyze-missing', 'POST', '{}', 'Could not label stills');
        setBusy('labelAll', false);
        setAssets(d.assets || S.assets);
        toast(d.labeled ? `Labeled ${pluralize(d.labeled, 'still')}${d.remaining ? `, ${d.remaining} still unlabeled` : ''}` : 'Nothing left to label', 'success');
      } catch (err) {
        setBusy('labelAll', false); paintListing();
        toast(err.message || 'Label failed', 'error');
      }
    }

    async function uploadFiles(files) {
      const kind = ($('#brand-lib-kind') || {}).value || 'scene';
      const collection = clean(($('#brand-lib-collection') || {}).value);
      let last = null; let saved = 0; let lastErr = null;
      S.upErr = '';
      setBusy('upload', true); paintCards();
      for (const file of files) {
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('name', file.name.replace(/\.[^.]+$/, ''));
        fd.append('collection', collection);
        fd.append('file', file);
        try {
          const d = await call('/api/assets', 'POST', fd, 'Upload failed');
          last = d.assets || last; saved += 1;
        } catch (err) { lastErr = err; }
      }
      setBusy('upload', false);
      if (!alive()) return;
      if (lastErr) S.upErr = saved ? `Saved ${saved} of ${files.length}. ${lastErr.message}` : (lastErr.message || 'Upload failed');
      if (saved) { S.view = 'all'; S.query = ''; const q = $('#brand-lib-filter'); if (q) q.value = ''; setAssets(last || S.assets); } else paintCards();
      if (saved) toast(saved === 1 ? 'Saved to the library' : `Saved ${saved} files to the library`, 'success');
      if (lastErr) toast(lastErr.message || 'Upload failed', 'error', lastErr.request_id ? { ref: lastErr.request_id } : undefined);
    }

    async function togglePast() {
      S.cards.past = !S.cards.past;
      paintCards();
      if (S.cards.past && !keep.pastLoaded) {
        S.pastBusy = true; paintPast();
        try {
          const d = await call('/api/studio/media-library?type=image&limit=80', 'GET', undefined, 'Could not load past content');
          keep.pastItems = Array.isArray(d.items) ? d.items : [];
          keep.pastLoaded = true;
        } catch (err) {
          S.cards.past = false;
          toast(err.message || 'Could not load past content', 'error');
        }
        S.pastBusy = false;
        if (alive()) paintCards();
      }
    }

    async function pastAdd() {
      const picks = [...root.querySelectorAll('[data-past-pick]:checked')];
      if (!picks.length) { toast('Select at least one past still', 'error'); return; }
      setBusy('pastAdd', true); paintPast();
      let last = S.assets; let saved = 0; let lastErr = null;
      for (const el of picks) {
        const url = clean(el.getAttribute('data-past-url'));
        if (!safeUrl(url)) continue;
        try {
          const d = await call('/api/assets/from-url', 'POST', { url, kind: 'style', name: clean(el.getAttribute('data-past-title')) || 'Past post', source: 'content', created_from_id: clean(el.getAttribute('data-past-id')) }, 'Could not save style');
          last = d.assets || last; saved += 1;
        } catch (err) { lastErr = err; }
      }
      setBusy('pastAdd', false);
      if (!alive()) return;
      setAssets(last);
      if (saved) toast(`Saved ${pluralize(saved, 'style still')}`, 'success');
      if (lastErr) toast(lastErr.message || 'Some stills did not save', 'error');
    }

    async function generate() {
      const ids = stillTicked().map((a) => String(a.id));
      if (!genReady(ids.length)) { toast('Select 2–8 library stills as references.', 'error'); return; }
      const prompt = clean(($('#brand-lib-gen-prompt') || {}).value);
      const kind = ($('#brand-lib-gen-kind') || {}).value || 'scene';
      const col = parseView(S.view);
      const collection = col.type === 'collection' ? col.name : clean(($('#brand-lib-collection') || {}).value);
      setBusy('gen', true); paintGenCount();
      try {
        const d = await call('/api/assets/generate', 'POST', { asset_ids: ids, prompt, kind, collection }, 'Generate failed');
        setBusy('gen', false);
        if (!alive()) return;
        keep.drafts = d.drafts || [];
        S.view = 'smart:review';
        paintAll();
        toast(`${pluralize((d.drafts || []).length, 'draft')} ready. Add, use, or reject`, 'success');
      } catch (err) {
        setBusy('gen', false); paintGenCount();
        toast(err.message || 'Generate failed', 'error');
      }
    }

    const findDraft = (id) => keep.drafts.find((d) => draftId(d) === String(id));

    async function draftAccept(id) {
      const draft = findDraft(id); if (!draft) return;
      try {
        const d = await call('/api/assets/drafts/accept', 'POST', { url: draft.url, name: draft.name, kind: draft.kind, collection: draft.collection }, 'Could not add that still');
        keep.drafts = keep.drafts.filter((x) => x !== draft);
        if (alive()) setAssets(d.assets || S.assets);
        toast('Added to library', 'success');
      } catch (err) { toast(err.message || 'Accept failed', 'error'); }
    }

    async function draftReject(id) {
      const draft = findDraft(id); if (!draft) return;
      const reason = promptFn('Why reject this still? (optional)', '') || '';
      try {
        await call('/api/assets/drafts/reject', 'POST', { reason, collection: draft.collection, prompt: draft.prompt }, 'Reject failed');
        keep.drafts = keep.drafts.filter((x) => x !== draft);
        if (alive()) paintAll();
        toast('Rejected. That reason is remembered for the next generate', 'success');
      } catch (err) { toast(err.message || 'Reject failed', 'error'); }
    }

    async function makeSheet(id) {
      if (!id || keep.busySheet[id]) return;
      const current = byId(id);
      keep.busySheet[id] = true;
      if (alive()) paintAside();
      toast(`Making sheet for ${current ? (current.name || current.kind) : 'this still'}…`, 'success');
      try {
        const d = await call(`/api/assets/${encodeURIComponent(id)}/generate-views`, 'POST', '{}', 'Could not make multiview');
        delete keep.busySheet[id];
        if (alive()) setAssets(d.assets || S.assets);
        toast('Multiview sheet ready', 'success');
      } catch (err) {
        delete keep.busySheet[id];
        if (alive()) paintAside();
        toast(err.message || 'Make Multiview failed', 'error');
      }
    }

    async function moreLikeThis(id, btn) {
      const current = byId(id);
      const prompt = promptFn('Create more like this. Describe what to add', current ? `more ${current.kind}s like ${current.name || current.kind}` : '');
      if (prompt == null) return;
      if (btn) btn.disabled = true;
      try {
        const d = await call(`/api/assets/${encodeURIComponent(id)}/more-like-this`, 'POST', { prompt, count: 3 }, 'Could not generate more');
        keep.drafts = d.drafts || [];
        if (alive()) { S.view = 'smart:review'; paintAll(); }
        toast(`${pluralize((d.drafts || []).length, 'draft')} ready`, 'success');
      } catch (err) {
        if (btn) btn.disabled = false;
        toast(err.message || 'More like this failed', 'error');
      }
    }

    async function retag(id, kind, sel) {
      const current = byId(id);
      if (!kind || (current && current.kind === kind)) return;
      try {
        const d = await call(`/api/assets/${encodeURIComponent(id)}`, 'PATCH', { kind }, 'Retag failed');
        if (alive()) setAssets(d.assets || []);
        toast('Tag updated', 'success');
      } catch (err) {
        if (current && sel) sel.value = current.kind;
        toast(err.message || 'Retag failed', 'error');
      }
    }

    async function rename(id) {
      const current = byId(id);
      const name = promptFn('Rename asset', current ? labelOf(current) : '');
      if (name == null) return;
      try {
        const d = await call(`/api/assets/${encodeURIComponent(id)}`, 'PATCH', { name }, 'Rename failed');
        if (alive()) setAssets(d.assets || []);
      } catch (err) { toast(err.message || 'Rename failed', 'error'); }
    }

    async function remove(id) {
      if (!confirmFn('Remove this from the library? Existing projects keep the file they already attached.')) return;
      const idx = visible().findIndex((a) => String(a.id) === String(id));
      try {
        const d = await call(`/api/assets/${encodeURIComponent(id)}`, 'DELETE', undefined, 'Delete failed');
        S.checked.delete(String(id));
        if (S.focus === String(id)) S.focus = null;
        if (alive()) { S.assets = d.assets || []; afterRemoval(idx); S.panelOpen = false; paintAll(); live('Removed from the library'); }
      } catch (err) { toast(err.message || 'Delete failed', 'error'); }
    }

    async function analyze(id) {
      setBusy('an:' + id, true); paintAside();
      try {
        const d = await call(`/api/assets/${encodeURIComponent(id)}/analyze`, 'POST', '{}', 'Could not label that still');
        setBusy('an:' + id, false);
        if (alive()) setAssets(d.assets || S.assets);
        toast('Labeled', 'success');
      } catch (err) {
        setBusy('an:' + id, false); if (alive()) paintAside();
        toast(err.message || 'Label failed', 'error');
      }
    }

    async function bulkLabel() {
      const ids = selectedIds(S.focus, S.checked).map(byId).filter((a) => a && labelState(a, isStill) === 'unlabeled').map((a) => String(a.id));
      if (!ids.length || S.busy.bulk) return;
      setBusy('bulk', 'label'); paintAside();
      let last = null; let done = 0; let lastErr = null;
      for (const id of ids) {
        try { const d = await call(`/api/assets/${encodeURIComponent(id)}/analyze`, 'POST', '{}', 'Could not label that still'); last = d.assets || last; done += 1; } catch (err) { lastErr = err; }
      }
      setBusy('bulk', false);
      if (!alive()) return;
      setAssets(last || S.assets);
      if (done) toast(`Labeled ${pluralize(done, 'still')}`, 'success');
      if (lastErr) toast(lastErr.message || 'Some stills did not get a label', 'error');
    }

    async function bulkKind(kind, sel) {
      const ids = selectedIds(S.focus, S.checked);
      if (!kind || !ids.length) return;
      setBusy('bulk', 'kind');
      let last = null; let done = 0; let lastErr = null;
      for (const id of ids) {
        const cur = byId(id);
        if (cur && cur.kind === kind) continue;
        try { const d = await call(`/api/assets/${encodeURIComponent(id)}`, 'PATCH', { kind }, 'Retag failed'); last = d.assets || last; done += 1; } catch (err) { lastErr = err; }
      }
      setBusy('bulk', false);
      if (!alive()) return;
      if (last) setAssets(last); else if (sel) sel.value = '';
      if (done) toast(`Changed ${pluralize(done, 'item')} to ${chip(kind)}`, 'success');
      if (lastErr) toast(lastErr.message || 'Some items did not change', 'error');
    }

    async function bulkDelete() {
      const ids = selectedIds(S.focus, S.checked);
      if (!ids.length) return;
      if (!confirmFn(`Remove ${pluralize(ids.length, 'item')} from the library? Existing projects keep the files they already attached.`)) return;
      const idx = visible().findIndex((a) => String(a.id) === String(ids[0]));
      setBusy('bulk', 'delete'); paintAside();
      let last = null; let done = 0; let lastErr = null;
      for (const id of ids) {
        try { const d = await call(`/api/assets/${encodeURIComponent(id)}`, 'DELETE', undefined, 'Delete failed'); last = d.assets || last; done += 1; } catch (err) { lastErr = err; }
      }
      setBusy('bulk', false);
      if (!alive()) return;
      S.checked.clear(); S.focus = null;
      if (last) S.assets = last;
      afterRemoval(idx); S.panelOpen = false; paintAll();
      live(`Removed ${pluralize(done, 'item')}`);
      if (lastErr) toast(lastErr.message || 'Some items were not removed', 'error');
    }

    async function copyHex(hex, btn) {
      try {
        await global.navigator.clipboard.writeText(hex);
        toast(`Copied ${hex}`, 'success');
        live(`Copied ${hex}`);
      } catch (_) {
        toast(`Could not copy. The code is ${hex}`, 'error');
      }
    }

    /* ── events ── */
    function closeMenu(returnFocus) {
      if (!S.menu) return;
      S.menu = false; paintActions();
      if (returnFocus) { const b = $('#lb-add'); if (b) b.focus(); }
    }

    function openCard(which) {
      S.cards[which] = true;
      paintCards();
      const target = which === 'up' ? $('#brand-lib-kind') : which === 'gen' ? $('#brand-lib-gen-prompt') : null;
      if (target) { target.focus(); target.scrollIntoView && target.scrollIntoView({ block: 'nearest' }); }
    }

    function setView(view) {
      S.view = view; S.checked.clear(); S.panelOpen = false;
      paintSide(); paintListing();
    }

    function pick(id) {
      S.focus = String(id); S.explicit = true; S.checked.clear(); S.panelOpen = true;
      paintListing();
      const n = global.matchMedia && global.matchMedia('(max-width: 899px)').matches;
      if (n) { const p = $('#lb-panel'); if (p) { p.scrollIntoView({ block: 'start' }); p.focus({ preventScroll: true }); } }
      else { const b = root.querySelector(`[data-fk="t-${CSS.escape(String(id))}"]`); if (b) b.focus({ preventScroll: true }); }
    }

    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-a]');
      if (!t || !root.contains(t)) return;
      const a = t.getAttribute('data-a');
      const id = t.getAttribute('data-id');
      if (a === 'check' || a === 'kind' || a === 'bulk-kind') return; // handled on change
      if (a === 'menu') { S.menu = !S.menu; paintActions(); if (S.menu) { const f = root.querySelector('.lb-menu__i'); if (f) f.focus(); } return; }
      if (a === 'menu-item') {
        const item = t.getAttribute('data-item');
        S.menu = false; paintActions();
        if (item === 'upload') openCard('up'); else if (item === 'gen') openCard('gen'); else if (item === 'past') togglePast();
        return;
      }
      if (a === 'view') return setView(t.getAttribute('data-view') || 'all');
      if (a === 'pick') return pick(id);
      if (a === 'harvest') return harvest();
      if (a === 'label-missing') return labelMissing();
      if (a === 'choose') { const f = $('#brand-lib-file'); const k = $('#brand-lib-kind'); if (f) { f.accept = acceptFor(k ? k.value : 'scene'); f.click(); } return; }
      if (a === 'close-card') { const w = t.getAttribute('data-card'); S.cards[w] = false; paintCards(); const b = $('#lb-add'); if (b) b.focus(); return; }
      if (a === 'past-add') return pastAdd();
      if (a === 'generate') return generate();
      if (a === 'open-gen') return openCard('gen');
      if (a === 'reload') return loadAssets();
      if (a === 'clear-filters') { S.view = 'all'; S.query = ''; const q = $('#brand-lib-filter'); if (q) q.value = ''; paintSide(); paintListing(); return; }
      if (a === 'clear') { S.checked.clear(); paintListing(); return; }
      if (a === 'copy') return copyHex(t.getAttribute('data-hex'), t);
      if (a === 'close-panel') { S.panelOpen = false; paintAside(); const b = root.querySelector(`[data-fk="t-${CSS.escape(String(S.focus || ''))}"]`); if (b) { b.focus(); b.scrollIntoView({ block: 'center' }); } return; }
      if (a === 'open-panel') { S.panelOpen = true; paintAside(); const p = $('#lb-panel'); if (p) { p.scrollIntoView({ block: 'start' }); p.focus({ preventScroll: true }); } return; }
      if (a === 'use') { const asset = byId(id); if (asset && typeof deps.useStill === 'function') deps.useStill(asset); return; }
      if (a === 'draft-use') { const d = findDraft(id); if (d && typeof deps.useStill === 'function') deps.useStill(d); return; }
      if (a === 'draft-accept') return draftAccept(id);
      if (a === 'draft-reject') return draftReject(id);
      if (a === 'views') return makeSheet(id);
      if (a === 'more') return moreLikeThis(id, t);
      if (a === 'rename') return rename(id);
      if (a === 'delete') return remove(id);
      if (a === 'analyze') return analyze(id);
      if (a === 'bulk-label') return bulkLabel();
      if (a === 'bulk-delete') return bulkDelete();
    });

    root.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!t || !t.getAttribute) return;
      const a = t.getAttribute('data-a');
      if (a === 'check') {
        const id = t.getAttribute('data-asset-select');
        S.checked = toggleChecked(S.focus, S.checked, String(id), S.explicit);
        if (S.checked.size === 1) { S.focus = [...S.checked][0]; S.explicit = true; }
        if (!S.checked.size) { S.focus = String(id); S.explicit = true; }
        if (S.checked.size > 1) S.panelOpen = true;
        paintListing();
        return;
      }
      if (a === 'kind') return retag(t.getAttribute('data-asset-kind'), clean(t.value), t);
      if (a === 'bulk-kind') return bulkKind(clean(t.value), t);
      if (t.id === 'lb-sort') { S.sort = t.value; paintListing(); return; }
      if (t.id === 'brand-lib-kind') { const f = $('#brand-lib-file'); if (f) f.accept = acceptFor(t.value); return; }
      if (t.id === 'brand-lib-file') {
        const files = [...(t.files || [])];
        t.value = '';
        if (files.length) uploadFiles(files);
      }
    });

    $('#brand-lib-filter').addEventListener('input', (ev) => { S.query = ev.target.value; S.checked.clear(); paintSide(); paintListing(); });

    // A broken picture falls back to the tinted placeholder underneath it.
    root.addEventListener('error', (ev) => {
      const el = ev.target;
      if (el && el.tagName && /^(IMG|VIDEO)$/.test(el.tagName) && el.closest('.lb-thumb, .lb-prev, .lb-thumbs')) el.style.display = 'none';
    }, true);

    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (S.menu) { ev.preventDefault(); closeMenu(true); return; }
        if (S.checked.size && ev.target.closest && ev.target.closest('.lb-main')) { S.checked.clear(); paintListing(); }
        return;
      }
      const menuItem = ev.target.closest && ev.target.closest('.lb-menu__i');
      if (menuItem && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        const all = [...root.querySelectorAll('.lb-menu__i')];
        const i = all.indexOf(menuItem);
        all[(i + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
        return;
      }
      if (menuItem && ev.key === 'Tab') { closeMenu(false); return; }
      const tile = ev.target.closest && ev.target.closest('.lb-tile__main');
      if (tile && /^Arrow(Left|Right|Up|Down)$/.test(ev.key)) {
        const mains = [...root.querySelectorAll('.lb-tile__main')];
        const grid = root.querySelector('.lb-grid');
        const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 1;
        const i = mains.indexOf(tile);
        const next = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'ArrowDown' ? i + cols : i - cols;
        if (next >= 0 && next < mains.length) { ev.preventDefault(); mains[next].focus(); }
      }
    });

    onDocClick = (ev) => {
      if (!root.isConnected) { destroy(); return; }
      if (S.menu && !ev.target.closest('.lb-addwrap')) closeMenu(false);
    };
    document.addEventListener('click', onDocClick);

    function destroy() {
      dead = true;
      if (onDocClick) document.removeEventListener('click', onDocClick);
      if (active && active.destroy === destroy) active = null;
    }
    active = { destroy };

    loadAssets();
  }

  if (typeof window !== 'undefined') {
    global.renderLibraryUI = mount;
    global.seLibrary = { helpers };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
})(typeof window !== 'undefined' ? window : globalThis);
