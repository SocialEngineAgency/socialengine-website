/* ============================================
   SocialEngine audit result page (audit.html)

   Renders the report returned by POST /api/audit (or GET /api/audit/report/:id).
   Safety rules this file keeps:
     - every piece of API data goes in through text nodes / setAttribute, never as markup
     - an image or link is used only when its URL starts with https://
     - a section is drawn only when it has items; nothing is invented
   The render helpers are plain functions that take a `document`, so
   audit-page.test.js can run them in node against a small fake DOM.
   ============================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SEAudit = api;
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('audit-root')) {
    api.boot(document, root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Same API origin as app.js and signup.html.
  const API_BASE = 'https://socialengine-api-production-18e0.up.railway.app';
  const POLL_INTERVAL_MS = 5000;
  const POLL_MAX_MS = 5 * 60 * 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RING_CIRCUMFERENCE = 301.6;
  const NOT_AVAILABLE = 'Not available';
  const ID_RE = /^[A-Za-z0-9_-]{6,128}$/;

  // ---------- pure helpers ----------

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  // An https:// URL that parses, or ''. Used for every image and link from the API.
  function safeHttps(u) {
    if (typeof u !== 'string') return '';
    const s = u.trim();
    if (!/^https:\/\//i.test(s)) return '';
    try { return new URL(s).protocol === 'https:' ? s : ''; } catch (_) { return ''; }
  }

  function hostOf(u) {
    const s = safeHttps(u) || safeHttps('https://' + String(u || '').replace(/^https?:\/\//i, ''));
    try { return new URL(s).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  function clampScore(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.min(100, Math.max(0, Math.round(x)));
  }

  function ringOffset(score) {
    return Math.round(RING_CIRCUMFERENCE * (1 - score / 100) * 10) / 10;
  }

  function arr(v, max) { return Array.isArray(v) ? v.slice(0, max || 12) : []; }

  function scorePartsText(parts) {
    const bits = arr(parts, 8)
      .filter((p) => p && str(p.label) && Number.isFinite(Number(p.value)))
      .map((p) => str(p.label) + ' ' + Number(p.value));
    return bits.length ? bits.join(', ') + ' (out of 10)' : '';
  }

  function bestTimesText(bt) {
    const out = [];
    if (bt && str(bt.instagram)) out.push('Instagram ' + str(bt.instagram));
    if (bt && str(bt.tiktok)) out.push('TikTok ' + str(bt.tiktok));
    return out.length ? 'Best times: ' + out.join(', ') : '';
  }

  function themesText(themes) {
    const t = arr(themes, 12).map(str).filter(Boolean);
    return t.length ? 'Themes: ' + t.join(', ') : '';
  }

  function brandLabel(brand) {
    return str(brand && brand.name) || hostOf(brand && brand.website);
  }

  // A defensive copy of the report: right types, bounded sizes, empty where missing.
  function normalizeReport(r) {
    r = r && typeof r === 'object' ? r : {};
    const weeks = arr(r.plan_30, 4)
      .filter((w) => w && Array.isArray(w.slots) && w.slots.length)
      .map((w, i) => ({
        week: Number.isFinite(Number(w.week)) ? Number(w.week) : i + 1,
        theme: str(w.theme),
        slots: arr(w.slots, 7).map((s) => ({ day: str(s && s.day), format: str(s && s.format) })).filter((s) => s.day || s.format),
      }))
      .sort((a, b) => a.week - b.week);
    return {
      brand: { name: str(r.brand && r.brand.name), website: str(r.brand && r.brand.website) },
      score: clampScore(r.score),
      score_parts: arr(r.score_parts, 8),
      headline: str(r.headline),
      summary: str(r.summary),
      fix_first: arr(r.fix_first, 3).filter((f) => f && str(f.title)).map((f) => ({ title: str(f.title), detail: str(f.detail) })),
      push_first: arr(r.push_first, 5).filter((p) => p && str(p.title)).map((p) => ({
        title: str(p.title),
        price: typeof p.price === 'number' ? String(p.price) : str(p.price),
        image_url: safeHttps(p.image_url),
        url: safeHttps(p.url),
        reasons: arr(p.reasons, 4).map(str).filter(Boolean),
      })),
      sample_posts: arr(r.sample_posts, 3).filter((p) => p && str(p.text)).map((p) => ({
        label: str(p.label) || (str(p.platform) ? str(p.platform) + ' post' : 'Post'),
        text: str(p.text),
        image_url: safeHttps(p.image_url),
        product_title: str(p.product_title),
      })),
      plan_30: weeks,
      best_times: { instagram: str(r.best_times && r.best_times.instagram), tiktok: str(r.best_times && r.best_times.tiktok) },
      themes: arr(r.themes, 12).map(str).filter(Boolean),
      competitors: arr(r.competitors, 8).filter((c) => c && (str(c.name) || str(c.site_title))).map((c) => ({
        name: str(c.name) || str(c.site_title),
        instagram: str(c.instagram),
        tiktok: str(c.tiktok),
        posting: str(c.posting),
        site_url: safeHttps(c.site_url),
      })),
      sources: arr(r.sources, 12).map(safeHttps).filter(Boolean),
      portal_created: !!(r.portal && r.portal.created === true),
    };
  }

  // ---------- DOM helpers (document is passed in so tests can fake it) ----------

  function el(doc, tag, style, kids, attrs) {
    const node = doc.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (attrs) Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
    (kids || []).forEach((k) => {
      if (k == null || k === false) return;
      node.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    });
    return node;
  }

  function svg(doc, tag, attrs) {
    const node = doc.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
    return node;
  }

  const CARD = 'border-radius: 18px; border: 1px solid #1E2127; background: #101216;';
  const H2 = 'margin: 0; font-size: 30px; line-height: 1.1; font-weight: 500; letter-spacing: -0.03em';
  const SUB = 'margin: 0; color: #A3A09A';
  const PILL = 'height: 28px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 999px; font-size: 12.5px;';
  const PILL_ACCENT = PILL + ' background: rgba(157,140,255,0.16); color: #B9AEFF';
  const PILL_PLAIN = PILL + ' border: 1px solid #282C34; color: #A3A09A';
  const SECTION = 'display: flex; flex-direction: column; gap: 24px';

  function heading(doc, id, title, sub) {
    return el(doc, 'div', 'display: flex; flex-direction: column; gap: 8px', [
      el(doc, 'h2', H2, [title], { id }),
      sub ? el(doc, 'p', SUB, [sub]) : null,
    ]);
  }

  function section(doc, id, kids, style) {
    return el(doc, 'section', style || SECTION, kids, { 'aria-labelledby': id });
  }

  // ---------- sections ----------

  function renderHero(doc, r) {
    const copy = el(doc, 'div', 'flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 14px', [
      el(doc, 'span', 'font-size: 12.5px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: #9D8CFF', ['Free audit']),
      el(doc, 'h1', 'margin: 0; font-size: clamp(34px, 4.4vw, 56px); line-height: 1.05; font-weight: 500; letter-spacing: -0.035em', [r.headline || 'Your audit'], { id: 'ar-title' }),
      r.summary ? el(doc, 'p', 'margin: 0; max-width: 520px; font-size: 17px; color: #A3A09A', [r.summary]) : null,
    ]);
    const kids = [copy];
    if (r.score !== null) {
      const ring = svg(doc, 'svg', { width: '112', height: '112', viewBox: '0 0 112 112', role: 'img', 'aria-label': 'Score ' + r.score + ' out of 100', fill: 'none' });
      ring.appendChild(svg(doc, 'circle', { cx: '56', cy: '56', r: '48', fill: 'none', stroke: '#1E2127', 'stroke-width': '8' }));
      ring.appendChild(svg(doc, 'circle', {
        cx: '56', cy: '56', r: '48', fill: 'none', transform: 'rotate(-90 56 56)', stroke: '#9D8CFF', 'stroke-width': '8',
        'stroke-linecap': 'round', 'stroke-dasharray': String(RING_CIRCUMFERENCE), 'stroke-dashoffset': String(ringOffset(r.score)),
      }));
      const parts = scorePartsText(r.score_parts);
      kids.push(el(doc, 'div', 'flex: 0 1 380px; min-width: 260px; border-radius: 22px; border: 1px solid #1E2127; background: #101216; padding: 28px; display: flex; align-items: center; gap: 24px', [
        el(doc, 'div', 'position: relative; width: 112px; height: 112px; flex: 0 0 auto', [
          ring,
          el(doc, 'span', 'position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 500; letter-spacing: -0.03em', [String(r.score)], { 'aria-hidden': 'true' }),
        ]),
        el(doc, 'div', 'display: flex; flex-direction: column; gap: 6px; min-width: 0', [
          el(doc, 'span', 'font-size: 15px; font-weight: 500', ['Social readiness']),
          parts ? el(doc, 'span', 'font-size: 14px; color: #A3A09A', [parts]) : null,
        ]),
      ]));
    }
    return el(doc, 'section', 'display: flex; flex-wrap: wrap; align-items: center; gap: 32px 56px', kids, { 'aria-labelledby': 'ar-title' });
  }

  function renderFixFirst(doc, r) {
    if (!r.fix_first.length) return null;
    const cards = r.fix_first.map((f, i) => el(doc, 'div', 'flex: 1 1 300px; min-width: 0; ' + CARD + ' padding: 24px; display: flex; flex-direction: column; gap: 10px', [
      el(doc, 'span', 'font-size: 13px; color: #9D8CFF', ['0' + (i + 1)]),
      el(doc, 'h3', 'margin: 0; font-size: 19px; font-weight: 500', [f.title]),
      f.detail ? el(doc, 'p', 'margin: 0; color: #A3A09A; font-size: 15px', [f.detail]) : null,
    ]));
    return section(doc, 'ar-fix', [
      el(doc, 'h2', H2, ['Fix these first'], { id: 'ar-fix' }),
      el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 16px', cards),
    ]);
  }

  function renderPushFirst(doc, r) {
    if (!r.push_first.length) return null;
    const last = r.push_first.length - 1;
    const rows = r.push_first.map((p, i) => {
      const thumbStyle = 'flex: 0 0 44px; height: 44px; width: 44px; border-radius: 10px; background: #191C22; border: 1px solid #282C34; object-fit: cover; display: block';
      const thumb = p.image_url
        ? el(doc, 'img', thumbStyle, [], { src: p.image_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : el(doc, 'span', thumbStyle, [], { 'aria-hidden': 'true' });
      const name = p.url
        ? el(doc, 'a', 'color: #E8E6E1; text-decoration: none', [p.title], { href: p.url, target: '_blank', rel: 'noopener noreferrer' })
        : p.title;
      return el(doc, 'div', 'display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 14px 16px;' + (i === last ? '' : ' border-bottom: 1px solid #1E2127'), [
        thumb,
        el(doc, 'span', 'flex: 1 1 200px; min-width: 0; font-weight: 500', [name]),
        p.price ? el(doc, 'span', 'flex: 0 0 auto; min-width: 70px; color: #A3A09A; font-size: 14px', [p.price]) : null,
        p.reasons.length
          ? el(doc, 'span', 'display: inline-flex; gap: 8px; flex-wrap: wrap', p.reasons.map((reason, j) => el(doc, 'span', j === 0 ? PILL_ACCENT : PILL_PLAIN, [reason])))
          : null,
      ]);
    });
    return section(doc, 'ar-push', [
      heading(doc, 'ar-push', 'Post these products first', 'Ranked from your own catalog, with the reasons we picked each one.'),
      el(doc, 'div', CARD + ' padding: 8px; display: flex; flex-direction: column', rows),
    ]);
  }

  function renderSamplePosts(doc, r) {
    if (!r.sample_posts.length) return null;
    const title = r.sample_posts.length === 3 ? 'Three posts, already written' : 'Sample posts, already written';
    const sub = 'Written for your brand.' + (r.portal_created ? ' They are waiting in your preview portal.' : '');
    const cards = r.sample_posts.map((p) => {
      const media = p.image_url
        ? el(doc, 'img', 'height: 200px; width: 100%; box-sizing: border-box; border-radius: 12px; background: #14161B; border: 1px solid #1E2127; object-fit: cover; display: block', [], { src: p.image_url, alt: p.product_title, loading: 'lazy', referrerpolicy: 'no-referrer' })
        : el(doc, 'div', 'height: 200px; border-radius: 12px; background: #14161B; border: 1px solid #1E2127; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 16px; font-size: 13px; color: #8D8A83', [p.product_title || 'No image for this post']);
      return el(doc, 'div', 'flex: 1 1 300px; min-width: 0; ' + CARD + ' padding: 16px; display: flex; flex-direction: column; gap: 14px', [
        media,
        el(doc, 'span', 'font-size: 12.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #9D8CFF', [p.label]),
        el(doc, 'p', 'margin: 0; font-size: 15px; color: #E8E6E1; white-space: pre-line', [p.text]),
      ]);
    });
    return section(doc, 'ar-posts', [
      heading(doc, 'ar-posts', title, sub),
      el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 16px', cards),
    ]);
  }

  function renderPlan(doc, r) {
    const meta = [bestTimesText(r.best_times), themesText(r.themes)].filter(Boolean);
    const metaRow = meta.length
      ? el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 10px 24px; color: #A3A09A; font-size: 14.5px', meta.map((m) => el(doc, 'span', '', [m])))
      : null;
    if (!r.plan_30.length) {
      if (!metaRow) return null;
      return section(doc, 'ar-30', [el(doc, 'h2', H2, ['When to post'], { id: 'ar-30' }), metaRow]);
    }
    const weeks = r.plan_30.map((w) => el(doc, 'div', 'flex: 1 1 230px; min-width: 0; ' + CARD + ' padding: 20px; display: flex; flex-direction: column; gap: 12px', [
      el(doc, 'span', 'font-size: 14px; font-weight: 500', ['Week ' + w.week]),
      w.theme ? el(doc, 'span', 'font-size: 13.5px; color: #A3A09A', [w.theme]) : null,
      el(doc, 'div', 'display: flex; flex-direction: column; gap: 8px; font-size: 14px', w.slots.map((s) =>
        el(doc, 'span', 'display: flex; justify-content: space-between; gap: 8px; padding: 8px 12px; border-radius: 10px; background: #14161B', [
          el(doc, 'span', '', [s.day]),
          el(doc, 'span', 'color: #A3A09A; text-align: right', [s.format]),
        ]))),
    ]));
    return section(doc, 'ar-30', [
      heading(doc, 'ar-30', 'Your first 30 days', 'A week-by-week posting plan built around your content themes.'),
      el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 16px', weeks),
      metaRow,
    ]);
  }

  function renderCompetitors(doc, r) {
    if (!r.competitors.length) return null;
    const showPosting = r.competitors.some((c) => c.posting);
    const colHead = 'flex: 0 0 130px';
    const cell = (v) => el(doc, 'span', 'flex: 0 0 130px;' + (v ? ' color: #E8E6E1' : ' color: #8D8A83'), [v || NOT_AVAILABLE]);
    const head = el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 12px 16px; border-bottom: 1px solid #1E2127; font-size: 12.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #8D8A83', [
      el(doc, 'span', 'flex: 1 1 200px', ['Brand']),
      el(doc, 'span', colHead, ['Instagram']),
      el(doc, 'span', colHead, ['TikTok']),
      showPosting ? el(doc, 'span', colHead, ['Posting']) : null,
    ]);
    const last = r.competitors.length - 1;
    const rows = r.competitors.map((c, i) => {
      const name = c.site_url
        ? el(doc, 'a', 'color: #E8E6E1; text-decoration: none', [c.name], { href: c.site_url, target: '_blank', rel: 'noopener noreferrer' })
        : c.name;
      return el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 14px 16px; font-size: 15px;' + (i === last ? '' : ' border-bottom: 1px solid #1E2127'), [
        el(doc, 'span', 'flex: 1 1 200px; min-width: 0', [name]),
        cell(c.instagram),
        cell(c.tiktok),
        showPosting ? cell(c.posting) : null,
      ]);
    });
    return section(doc, 'ar-comp', [
      heading(doc, 'ar-comp', 'Where competitors stand', 'Public numbers from each brand’s own pages. Anything we could not find says so.'),
      el(doc, 'div', CARD + ' padding: 8px; display: flex; flex-direction: column', [head].concat(rows)),
    ]);
  }

  function renderSources(doc, r) {
    if (!r.sources.length) return null;
    const links = r.sources.map((u) => el(doc, 'a', 'color: #A3A09A', [hostOf(u) || u], { href: u, target: '_blank', rel: 'noopener noreferrer' }));
    const kids = [el(doc, 'span', '', ['Sources:'])];
    links.forEach((a) => kids.push(a));
    return el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13.5px; color: #8D8A83', kids, { 'aria-label': 'Sources' });
  }

  function renderNext(doc, r) {
    const btnPrimary = 'height: 54px; box-sizing: border-box; padding: 0 26px; display: inline-flex; align-items: center; border-radius: 999px; background: #E8E6E1; color: #0D0E11; text-decoration: none; font-weight: 600; font-size: 15.5px';
    const btnGhost = 'height: 54px; box-sizing: border-box; padding: 0 24px; display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid #282C34; color: #E8E6E1; text-decoration: none; font-weight: 500; font-size: 15.5px';
    const copy = r.portal_created
      ? ['Your preview portal is ready', 'Posts written for your brand are waiting for your approval. Nothing goes out until you say so.']
      : ['Want to see these in a portal?', 'Run a free preview and approve posts written for your brand. Nothing goes out until you say so.'];
    const primary = r.portal_created
      ? el(doc, 'a', btnPrimary, ['Open my portal'], { href: '/portal.html' })
      : el(doc, 'a', btnPrimary, ['Create your free preview'], { href: '/#ai-audit' });
    return el(doc, 'section', 'border-radius: 26px; border: 1px solid #1E2127; background: #101216; padding: 44px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px 40px', [
      el(doc, 'div', 'flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 10px', [
        el(doc, 'h2', H2, [copy[0]], { id: 'ar-next' }),
        el(doc, 'p', SUB, [copy[1]]),
      ]),
      el(doc, 'div', 'display: flex; flex-wrap: wrap; gap: 12px', [
        primary,
        el(doc, 'a', btnGhost, ['See plans'], { href: '/#pricing' }),
      ]),
    ], { 'aria-labelledby': 'ar-next' });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Draw the whole report into `container`. Returns the normalized report.
  function renderReport(doc, container, report) {
    const r = normalizeReport(report);
    clear(container);
    [renderHero(doc, r), renderFixFirst(doc, r), renderPushFirst(doc, r), renderSamplePosts(doc, r),
      renderPlan(doc, r), renderCompetitors(doc, r), renderNext(doc, r), renderSources(doc, r)]
      .forEach((node) => { if (node) container.appendChild(node); });
    return r;
  }

  // ---------- waiting / error states ----------

  function renderNotice(doc, container, opts) {
    clear(container);
    const kids = [];
    if (opts.busy) kids.push(el(doc, 'span', '', [], { class: 'ar-pulse', 'aria-hidden': 'true' }));
    kids.push(el(doc, 'h1', 'margin: 0; font-size: clamp(30px, 4vw, 44px); line-height: 1.08; font-weight: 500; letter-spacing: -0.03em', [opts.title], { id: 'ar-title' }));
    if (opts.text) kids.push(el(doc, 'p', 'margin: 0; max-width: 520px; font-size: 17px; color: #A3A09A', [opts.text]));
    if (opts.link) {
      kids.push(el(doc, 'a', 'height: 54px; box-sizing: border-box; padding: 0 26px; display: inline-flex; align-items: center; border-radius: 999px; background: #E8E6E1; color: #0D0E11; text-decoration: none; font-weight: 600; font-size: 15.5px', [opts.link.label], { href: opts.link.href }));
    }
    container.appendChild(el(doc, 'section', 'display: flex; flex-direction: column; align-items: flex-start; gap: 18px; padding: 48px 0',
      kids, { role: opts.busy ? 'status' : 'alert', 'aria-live': opts.busy ? 'polite' : 'assertive', 'aria-labelledby': 'ar-title' }));
  }

  const TEXT = {
    pending: { title: 'Still working.', text: 'We will email you when it is ready.', busy: true },
    timeout: { title: 'Still working.', text: 'This is taking longer than usual. We will email you when it is ready.', busy: false },
    failed: { title: 'We could not finish your audit.', text: 'Something went wrong on our side. Please try again.', link: { label: 'Try again', href: '/#ai-audit' } },
    notFound: { title: 'We could not find that audit.', text: 'The link may be incomplete or out of date. You can run a new one.', link: { label: 'Run a free audit', href: '/#ai-audit' } },
  };

  // ---------- loading ----------

  // Fetch one report status. Resolves { state: 'done'|'pending'|'failed'|'notFound'|'error', report? }.
  async function fetchStatus(fetchImpl, id) {
    let res;
    try {
      res = await fetchImpl(API_BASE + '/api/audit/report/' + encodeURIComponent(id), { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (_) { return { state: 'error' }; }
    if (res.status === 404) return { state: 'notFound' };
    let body = null;
    try { body = await res.json(); } catch (_) { return { state: 'error' }; }
    if (!res.ok || !body || typeof body !== 'object') return { state: 'error' };
    if (body.status === 'done' && body.report && typeof body.report === 'object') return { state: 'done', report: body.report };
    if (body.status === 'failed') return { state: 'failed' };
    if (body.status === 'pending') return { state: 'pending' };
    return { state: 'error' };
  }

  // Show the stashed report if there is one, otherwise ask the API and poll while it is pending.
  // `deps`: { id, storage, fetch, sleep(ms), now(), ui: { report, pending, timeout, failed, notFound } }
  async function loadAudit(deps) {
    const { id, ui } = deps;
    if (!ID_RE.test(id || '')) { ui.notFound(); return 'notFound'; }
    try {
      const stashed = deps.storage && deps.storage.getItem('se_audit_' + id);
      if (stashed) {
        const parsed = JSON.parse(stashed);
        if (parsed && typeof parsed === 'object') { ui.report(parsed); return 'done'; }
      }
    } catch (_) { /* fall through to the API */ }

    const startedAt = deps.now();
    let showedPending = false;
    for (;;) {
      const result = await fetchStatus(deps.fetch, id);
      if (result.state === 'done') { ui.report(result.report); return 'done'; }
      if (result.state === 'failed') { ui.failed(); return 'failed'; }
      if (result.state === 'notFound') { ui.notFound(); return 'notFound'; }
      // pending, or a passing network/parse error: keep waiting, keep the calm state on screen
      if (!showedPending) { ui.pending(); showedPending = true; }
      if (deps.now() - startedAt >= POLL_MAX_MS) { ui.timeout(); return 'timeout'; }
      await deps.sleep(POLL_INTERVAL_MS);
    }
  }

  function boot(doc, win) {
    const container = doc.getElementById('audit-root');
    const pill = doc.getElementById('audit-pill');
    let id = '';
    try { id = new URLSearchParams(win.location.search).get('id') || ''; } catch (_) { id = ''; }
    let storage = null;
    try { storage = win.sessionStorage; } catch (_) { storage = null; }

    loadAudit({
      id,
      storage,
      fetch: (u, o) => win.fetch(u, o),
      sleep: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
      now: () => Date.now(),
      ui: {
        report(report) {
          const r = renderReport(doc, container, report);
          const label = brandLabel(r.brand);
          if (pill && label) { pill.textContent = label; pill.hidden = false; }
          if (doc.title !== undefined) doc.title = (label ? label + ' audit' : 'Your audit') + ' | SocialEngine';
          container.removeAttribute('aria-busy');
        },
        pending() { renderNotice(doc, container, TEXT.pending); },
        timeout() { renderNotice(doc, container, TEXT.timeout); },
        failed() { renderNotice(doc, container, TEXT.failed); },
        notFound() { renderNotice(doc, container, TEXT.notFound); },
      },
    }).catch((err) => {
      if (win.console) win.console.error('Audit page error', err);
      renderNotice(doc, container, TEXT.failed);
    });
  }

  return {
    safeHttps, hostOf, clampScore, ringOffset, scorePartsText, bestTimesText, themesText, brandLabel,
    normalizeReport, renderReport, renderNotice, fetchStatus, loadAudit, boot,
    TEXT, POLL_INTERVAL_MS, POLL_MAX_MS, API_BASE,
  };
});
