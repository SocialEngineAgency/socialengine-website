/* Brand Design (Design Studio v2): learn the brand's carousel system from approved slides, then
   design finished carousels in it. Create → Design (#create/design).
   window.seDesignStudio:
     render(container)                              → draws the screen into container
     openWith({ brief, slides, source_image_url, autostart }) → Coach handoff: prefill and optionally start */
(function (global) {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function apiBase() { return global.API || global._seAPI || ''; }
  function headers(extra) {
    const a = global.seApi;
    return Object.assign({}, a && typeof a.headers === 'function' ? a.headers() : {}, extra || {});
  }
  function toast(msg, kind) { if (typeof global.showToast === 'function') global.showToast(msg, kind); }
  async function call(method, path, body) {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }
  async function uploadFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name || 'Image'} is over 10 MB`);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${apiBase()}/api/studio/upload-image`, { method: 'POST', headers: headers(), body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  const STAGES = {
    queued: 'Waiting for a free designer…',
    draft: 'Studying your example slides…',
    review: 'Comparing layouts with your examples',
    final: 'Saving your design system…',
    research: 'Checking facts on official sources…',
    plan: 'Planning slides and writing copy…',
    art: 'Drawing illustrations in your style…',
    render: 'Laying out slides',
    critic: 'Creative director review',
    fix: 'Fixing weak slides',
    saving: 'Saving slides…',
  };
  const STEPS = {
    build: [['draft', 'Study examples'], ['review', 'Match layouts'], ['final', 'Save system']],
    carousel: [['research', 'Facts'], ['plan', 'Plan & copy'], ['art', 'Illustrations'], ['critic', 'Review'], ['fix', 'Polish'], ['saving', 'Save']],
  };
  const STEP_OF = { render: 'critic', queued: '' };
  function stageText(p) {
    if (!p) return 'Working…';
    const base = STAGES[p.stage] || 'Working…';
    const bits = [];
    if (p.round) bits.push(`round ${p.round}`);
    if (p.stage === 'art' && p.count) bits.push(`${p.count} image${p.count === 1 ? '' : 's'}`);
    if (p.stage === 'art' && p.scientific) bits.push(`${p.scientific} medical via FigureLabs`);
    if (p.stage === 'fix' && Array.isArray(p.slides)) bits.push(`slide ${p.slides.join(', ')}`);
    return bits.length ? `${base} (${bits.join(', ')})` : base;
  }

  function clientKey() {
    const c = global._studioClientData || global.clientData || {};
    return String(c.id || c.client_id || (c.fields && c.fields.contact_email) || 'me');
  }
  const store = {
    get(name) { try { return JSON.parse(localStorage.getItem(`se_dsv2_${name}_${clientKey()}`) || 'null'); } catch (_) { return null; } },
    set(name, v) { try { if (v == null) localStorage.removeItem(`se_dsv2_${name}_${clientKey()}`); else localStorage.setItem(`se_dsv2_${name}_${clientKey()}`, JSON.stringify(v)); } catch (_) {} },
  };

  const state = {
    root: null,
    info: null,
    examples: [],
    source: '',
    rebuild: false,
    pending: null,
    pollTimer: null,
    clock: null,
  };

  function injectStyles() {
    if (document.getElementById('dsv2-styles')) return;
    const st = document.createElement('style');
    st.id = 'dsv2-styles';
    st.textContent = `
      .dsv2-scroll { flex:1 1 auto; min-height:0; height:100%; overflow-y:auto; overscroll-behavior:contain; scroll-behavior:smooth; -webkit-overflow-scrolling:touch; }
      .dsv2 { max-width:1080px; margin:0 auto; padding:24px 24px 64px; color:#E2E8F0; font-family:var(--font-body); box-sizing:border-box; }
      .dsv2 *, .dsv2 *::before, .dsv2 *::after { box-sizing:border-box; }
      .dsv2-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
      .dsv2 h2 { font-family:var(--font-display); font-size:1.4rem; margin:0 0 4px; color:#fff; letter-spacing:-0.01em; }
      .dsv2 h3 { font-family:var(--font-display); font-size:1rem; margin:0; color:#fff; }
      .dsv2-sub { font-size:0.82rem; color:rgba(255,255,255,0.55); margin:0; line-height:1.55; max-width:640px; }
      .dsv2-card { background:linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015)); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:20px 22px; margin-bottom:16px; }
      .dsv2-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .dsv2-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .dsv2-grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; }
      .dsv2-label { font-size:0.68rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:rgba(255,255,255,0.5); margin:16px 0 7px; display:block; }
      .dsv2 textarea, .dsv2 input[type=text], .dsv2 select, .dsv2 input[type=number] { width:100%; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.12); border-radius:10px; color:#F8FAFC; padding:10px 12px; font-size:0.85rem; font-family:var(--font-body); transition:border-color .15s, box-shadow .15s; }
      .dsv2 textarea:focus, .dsv2 input:focus, .dsv2 select:focus { outline:none; border-color:rgba(167,139,250,0.7); box-shadow:0 0 0 3px rgba(124,58,237,0.18); }
      .dsv2 textarea { min-height:96px; resize:vertical; line-height:1.55; }
      .dsv2-check { display:flex; align-items:center; gap:8px; font-size:0.8rem; color:rgba(255,255,255,0.8); cursor:pointer; min-height:42px; }
      .dsv2-check input { width:16px; height:16px; accent-color:#8B5CF6; }
      .dsv2-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:10px 16px; border-radius:10px; border:1px solid rgba(124,58,237,0.45); background:rgba(124,58,237,0.14); color:#E9D5FF; font-size:0.8rem; font-weight:700; cursor:pointer; font-family:var(--font-body); transition:background .15s, transform .1s, opacity .15s; white-space:nowrap; }
      .dsv2-btn:hover:not(:disabled) { background:rgba(124,58,237,0.26); }
      .dsv2-btn:active:not(:disabled) { transform:translateY(1px); }
      .dsv2-btn--primary { background:linear-gradient(135deg,#7C3AED,#A855F7); color:#fff; border:none; box-shadow:0 4px 16px rgba(124,58,237,0.35); padding:12px 22px; font-size:0.86rem; }
      .dsv2-btn--primary:hover:not(:disabled) { background:linear-gradient(135deg,#6D28D9,#9333EA); }
      .dsv2-btn:disabled { opacity:0.45; cursor:not-allowed; box-shadow:none; }
      .dsv2-link { background:none; border:none; color:#A78BFA; font-size:0.78rem; font-weight:600; cursor:pointer; padding:4px 0; font-family:var(--font-body); }
      .dsv2-link:hover { color:#C4B5FD; }
      .dsv2-drop { border:1.5px dashed rgba(167,139,250,0.35); border-radius:12px; padding:16px; margin-top:12px; background:rgba(124,58,237,0.04); transition:background .15s, border-color .15s; }
      .dsv2-drop.is-over { background:rgba(124,58,237,0.12); border-color:#A78BFA; }
      .dsv2-drop-hint { font-size:0.76rem; color:rgba(255,255,255,0.5); }
      .dsv2-thumbs { display:grid; grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); gap:8px; }
      .dsv2-thumbs:not(:empty) { margin-top:12px; }
      .dsv2-thumb { position:relative; border-radius:9px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); background:#0B0F1A; }
      .dsv2-thumb img { width:100%; display:block; aspect-ratio:4/5; object-fit:cover; }
      .dsv2-thumb button { position:absolute; top:5px; right:5px; width:22px; height:22px; border-radius:50%; border:none; background:rgba(0,0,0,0.75); color:#fff; cursor:pointer; font-size:0.85rem; line-height:1; }
      .dsv2-swatch { width:20px; height:20px; border-radius:6px; border:1px solid rgba(255,255,255,0.18); display:inline-block; }
      .dsv2-chip { font-size:0.7rem; padding:4px 9px; border-radius:999px; background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.78); white-space:nowrap; }
      .dsv2-chip--ok { background:rgba(16,185,129,0.14); color:#6EE7B7; }
      .dsv2-chip--med { background:rgba(56,189,248,0.12); color:#7DD3FC; }
      .dsv2-med-set { display:flex; align-items:center; gap:10px; margin-top:14px; font-size:0.8rem; color:rgba(255,255,255,0.8); flex-wrap:wrap; }
      .dsv2-med-set select { width:auto; min-width:220px; }
      .dsv2-ask { margin-top:14px; padding:14px; border-radius:12px; background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.25); font-size:0.84rem; color:rgba(255,255,255,0.88); }
      .dsv2-ask p { margin:0 0 10px; line-height:1.45; }
      .dsv2-sys summary { list-style:none; cursor:pointer; }
      .dsv2-sys summary::-webkit-details-marker { display:none; }
      .dsv2-sys .dsv2-caret { transition:transform .2s; display:inline-block; }
      .dsv2-sys[open] .dsv2-caret { transform:rotate(90deg); }
      .dsv2-patterns { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:12px; margin-top:16px; }
      .dsv2-patterns figure { margin:0; }
      .dsv2-patterns img { width:100%; border-radius:9px; display:block; border:1px solid rgba(255,255,255,0.08); background:#0B0F1A; cursor:zoom-in; }
      .dsv2-patterns figcaption { font-size:0.68rem; color:rgba(255,255,255,0.55); margin-top:5px; }
      .dsv2-source { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .dsv2-source img { height:52px; border-radius:7px; border:1px solid rgba(255,255,255,0.12); }
      .dsv2-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:20px; }
      .dsv2-hint { font-size:0.74rem; color:rgba(255,255,255,0.45); }
      .dsv2-progress { margin-top:16px; padding:14px 16px; border-radius:12px; background:rgba(124,58,237,0.09); border:1px solid rgba(124,58,237,0.25); }
      .dsv2-progress-top { display:flex; align-items:center; gap:10px; font-size:0.84rem; color:#E9D5FF; font-weight:600; }
      .dsv2-progress-top .dsv2-time { margin-left:auto; font-weight:500; color:rgba(233,213,255,0.6); font-variant-numeric:tabular-nums; }
      .dsv2-steps { display:flex; gap:6px; margin-top:12px; flex-wrap:wrap; }
      .dsv2-step { flex:1 1 70px; font-size:0.66rem; color:rgba(255,255,255,0.4); padding-top:7px; border-top:3px solid rgba(255,255,255,0.1); transition:color .3s, border-color .3s; }
      .dsv2-step.is-done { color:rgba(167,139,250,0.85); border-color:rgba(167,139,250,0.55); }
      .dsv2-step.is-now { color:#fff; border-color:#A78BFA; }
      .dsv2-progress-note { font-size:0.7rem; color:rgba(233,213,255,0.5); margin-top:10px; }
      .dsv2-spin { width:15px; height:15px; border:2px solid rgba(233,213,255,0.3); border-top-color:#E9D5FF; border-radius:50%; animation:dsv2spin 0.7s linear infinite; flex-shrink:0; }
      @keyframes dsv2spin { to { transform:rotate(360deg); } }
      .dsv2-error { color:#FCA5A5; font-size:0.82rem; margin-top:14px; padding:10px 12px; border-radius:10px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); }
      .dsv2-slides { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; margin-top:16px; }
      .dsv2-slide { margin:0; }
      .dsv2-slide button { display:block; width:100%; padding:0; border:none; background:none; cursor:zoom-in; border-radius:11px; overflow:hidden; }
      .dsv2-slide img { width:100%; display:block; border-radius:11px; border:1px solid rgba(255,255,255,0.08); background:#0B0F1A; transition:transform .2s; }
      .dsv2-slide button:hover img { transform:scale(1.02); }
      .dsv2-slide-meta { font-size:0.68rem; color:rgba(255,255,255,0.55); margin-top:6px; line-height:1.45; }
      .dsv2-score { font-weight:700; color:#6EE7B7; }
      .dsv2-score--low { color:#FBBF24; }
      .dsv2-sources { margin-top:6px; }
      .dsv2-sources a { color:#A78BFA; font-size:0.74rem; word-break:break-all; display:block; margin-top:3px; }
      .dsv2-fade { animation:dsv2fade .35s ease both; }
      @keyframes dsv2fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
      .dsv2-lb { position:fixed; inset:0; z-index:10000; background:rgba(3,6,14,0.9); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:44px 64px; }
      .dsv2-lb img { max-width:100%; max-height:100%; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.6); }
      .dsv2-lb button { position:absolute; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; width:42px; height:42px; border-radius:50%; cursor:pointer; font-size:1.2rem; }
      .dsv2-lb .dsv2-lb-prev { left:14px; top:50%; transform:translateY(-50%); }
      .dsv2-lb .dsv2-lb-next { right:14px; top:50%; transform:translateY(-50%); }
      .dsv2-lb .dsv2-lb-close { right:14px; top:14px; }
      .dsv2-lb-count { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); font-size:0.75rem; color:rgba(255,255,255,0.7); }
      @media (max-width: 640px) {
        .dsv2 { padding:16px 14px 48px; }
        .dsv2-card { padding:16px; border-radius:14px; }
        .dsv2-slides { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
        .dsv2-actions .dsv2-btn--primary { width:100%; }
        .dsv2-lb { padding:56px 10px; }
      }
    `;
    document.head.appendChild(st);
  }

  function el(id) { return state.root ? state.root.querySelector(`#${id}`) : null; }
  function reveal(node) {
    if (!node || !node.scrollIntoView) return;
    requestAnimationFrame(() => node.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
  function ratioCss() {
    const r = (state.info && state.info.system && state.info.system.ratio) || '4:5';
    return r.replace(':', ' / ');
  }

  async function render(container) {
    injectStyles();
    state.root = container;
    container.innerHTML = '<div class="dsv2-scroll"><div class="dsv2"><div class="dsv2-progress"><div class="dsv2-progress-top"><span class="dsv2-spin"></span>Loading your brand design…</div></div></div></div>';
    try {
      state.info = await call('GET', '/api/design/system');
    } catch (e) {
      if (state.root === container) container.innerHTML = `<div class="dsv2-scroll"><div class="dsv2"><div class="dsv2-error">${esc(e.message)}</div></div></div>`;
      return;
    }
    if (state.root !== container) return;
    draw();
    const job = store.get('job');
    if (job && job.id) poll(job.id, job.kind);
    if (state.pending) {
      const p = state.pending;
      state.pending = null;
      applyHandoff(p);
    }
  }

  function draw() {
    const info = state.info || {};
    const sys = info.system;
    const root = state.root;
    if (!root) return;
    if (!info.enabled) {
      root.innerHTML = '<div class="dsv2-scroll"><div class="dsv2"><h2>Brand Design</h2><p class="dsv2-sub">Brand Design is not switched on for this account yet.</p></div></div>';
      return;
    }
    const showSetup = !sys || state.rebuild;
    root.innerHTML = `<div class="dsv2-scroll"><div class="dsv2">
      <div class="dsv2-head"><div>
        <h2>Brand Design</h2>
        <p class="dsv2-sub">Carousels designed in your exact brand style: your layouts, fonts, colours and illustration style, with facts checked and every slide reviewed before you see it.</p>
      </div></div>
      ${sys ? systemCard(sys, info) : ''}
      ${showSetup ? setupCard(!!sys) : ''}
      ${sys && !state.rebuild ? makeCard() : ''}
      <div id="dsv2-result"></div>
    </div></div>`;
    wire();
    const last = store.get('last');
    if (sys && !state.rebuild && last && !store.get('job')) showResult(last, false);
  }

  function systemCard(sys, info) {
    const colors = Object.entries(sys.colors || {}).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(String(v)));
    const fonts = sys.fonts || {};
    const previews = (info.previews || []).filter((p) => p && p.url);
    const names = new Map((sys.patterns || []).map((p) => [p.id, p.name || p.id]));
    return `<details class="dsv2-card dsv2-sys" id="dsv2-system"${state.rebuild ? ' open' : ''}>
      <summary class="dsv2-card-head">
        <div class="dsv2-row" style="gap:12px;">
          <span class="dsv2-caret" aria-hidden="true">›</span>
          <h3>${esc(sys.name || 'Your brand')} design system</h3>
          <span class="dsv2-chip dsv2-chip--ok">Ready</span>
        </div>
        <div class="dsv2-row" style="gap:6px;">
          ${colors.slice(0, 6).map(([k, v]) => `<span class="dsv2-swatch" title="${esc(k)} ${esc(v)}" style="background:${esc(v)}"></span>`).join('')}
          <span class="dsv2-chip">${esc(sys.ratio || '4:5')}</span>
          <span class="dsv2-chip">${(sys.patterns || []).length} layouts</span>
        </div>
      </summary>
      <div class="dsv2-row" style="margin-top:14px;justify-content:space-between;">
        <div class="dsv2-row" style="gap:6px;">
          ${['heading', 'body'].map((k) => (fonts[k] && fonts[k].family ? `<span class="dsv2-chip">${esc(k)}: ${esc(fonts[k].family)}</span>` : '')).join('')}
          ${sys.handle ? `<span class="dsv2-chip">${esc(sys.handle)}</span>` : ''}
        </div>
        <div class="dsv2-row" style="gap:16px;">
          ${previews.length && !state.rebuild ? '<button type="button" class="dsv2-link" id="dsv2-refresh">Refresh previews</button>' : ''}
          <button type="button" class="dsv2-link" id="dsv2-rebuild">${state.rebuild ? 'Cancel rebuild' : 'Rebuild from new examples'}</button>
        </div>
      </div>
      ${info.figurelabs ? `<label class="dsv2-med-set">Medical &amp; scientific accuracy
        <select id="dsv2-medical">
          <option value="ask"${medicalMode() === 'ask' ? ' selected' : ''}>Ask when the topic is medical or scientific</option>
          <option value="always"${medicalMode() === 'always' ? ' selected' : ''}>Always on</option>
          <option value="off"${medicalMode() === 'off' ? ' selected' : ''}>Off</option>
        </select>
        <span class="dsv2-hint">On: anatomy, medical and scientific pictures by FigureLabs, every number checked against official sources.</span>
      </label>` : ''}
      ${previews.length ? `<div class="dsv2-patterns">${previews.map((p, i) => `<figure><img src="${esc(p.url)}" alt="${esc(names.get(p.pattern) || p.pattern)}" loading="lazy" data-zoom="${i}"><figcaption>${esc(names.get(p.pattern) || p.pattern)}</figcaption></figure>`).join('')}</div>` : ''}
    </details>`;
  }

  function setupCard(isRebuild) {
    return `<div class="dsv2-card" id="dsv2-setup">
      <h3>${isRebuild ? 'Rebuild your design system' : 'Step 1: teach it your brand'}</h3>
      <p class="dsv2-sub" style="margin-top:6px;">Add 2–10 finished slides you've already posted and liked. A mix of slide types (cover, big number, list, comparison, call to action) teaches it the most. Takes about 10 minutes.</p>
      <div class="dsv2-drop" id="dsv2-drop">
        <div class="dsv2-row">
          <label class="dsv2-btn" style="cursor:pointer;">Upload slides<input type="file" id="dsv2-files" accept="image/*" multiple hidden></label>
          <button type="button" class="dsv2-btn" id="dsv2-lib">From Library</button>
          <span class="dsv2-chip" id="dsv2-count">${state.examples.length} / 10</span>
          <span class="dsv2-drop-hint">or drop images here</span>
        </div>
        <div class="dsv2-thumbs" id="dsv2-thumbs"></div>
      </div>
      <label class="dsv2-label" for="dsv2-notes">Anything it should know (optional)</label>
      <textarea id="dsv2-notes" placeholder="e.g. UK spelling, calm and factual tone, always end with our website"></textarea>
      <div class="dsv2-grid2">
        <div><label class="dsv2-label" for="dsv2-ratio">Slide shape</label>
          <select id="dsv2-ratio"><option value="4:5">4:5 portrait (Instagram feed)</option><option value="9:16">9:16 tall (Stories, TikTok)</option><option value="1:1">1:1 square</option></select></div>
        <div><label class="dsv2-label" for="dsv2-handle">Handle or website on slides</label>
          <input type="text" id="dsv2-handle" placeholder="@yourbrand"></div>
      </div>
      <div class="dsv2-actions">
        <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-build">Build my design system</button>
        <span class="dsv2-hint">You can leave this page while it builds.</span>
      </div>
      <div id="dsv2-build-status"></div>
    </div>`;
  }

  function medicalMode() {
    const s = state.info && state.info.settings;
    return (s && s.medical) || 'off';
  }
  function medicalChip() {
    const mode = medicalMode();
    if (mode === 'always') return '<span class="dsv2-chip dsv2-chip--med">Medical accuracy: on (FigureLabs)</span>';
    if (mode === 'ask') return '<span class="dsv2-chip dsv2-chip--med">Medical accuracy: asks for medical or scientific topics</span>';
    return '';
  }

  function makeCard() {
    return `<div class="dsv2-card" id="dsv2-make">
      <div class="dsv2-row" style="justify-content:space-between;"><h3>Make a carousel</h3><span id="dsv2-medical-chip">${medicalChip()}</span></div>
      <label class="dsv2-label" for="dsv2-brief">What is it about?</label>
      <textarea id="dsv2-brief" placeholder="Topic, who it's for, the key points, and what people should do at the end"></textarea>
      <div class="dsv2-grid2">
        <div><label class="dsv2-label" for="dsv2-slides">Slides</label>
          <select id="dsv2-slides"><option value="auto">Auto (up to 10)</option>${[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
        <div><label class="dsv2-label">Facts</label>
          <label class="dsv2-check"><input type="checkbox" id="dsv2-research" checked> Check on official sources</label></div>
      </div>
      <label class="dsv2-label">Start from a poster or infographic (optional)</label>
      <div class="dsv2-source" id="dsv2-source-row">
        <label class="dsv2-btn" style="cursor:pointer;">Upload<input type="file" id="dsv2-source-file" accept="image/*" hidden></label>
        <button type="button" class="dsv2-btn" id="dsv2-source-lib">From Library</button>
        <span id="dsv2-source-view" class="dsv2-source"></span>
      </div>
      <div class="dsv2-actions">
        <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-go">Design carousel</button>
        <span class="dsv2-hint">About 5 minutes. You can leave this page.</span>
      </div>
      <div id="dsv2-medical-ask"></div>
      <div id="dsv2-make-status"></div>
    </div>`;
  }

  function drawExamples() {
    const box = el('dsv2-thumbs');
    if (!box) return;
    box.innerHTML = state.examples.map((u, i) => `<div class="dsv2-thumb dsv2-fade"><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      state.examples.splice(Number(b.dataset.rm), 1);
      drawExamples();
    }));
    const count = el('dsv2-count');
    if (count) count.textContent = `${state.examples.length} / 10`;
  }

  function drawSource() {
    const view = el('dsv2-source-view');
    if (!view) return;
    view.innerHTML = state.source
      ? `<img src="${esc(state.source)}" alt="Source poster"><button type="button" class="dsv2-link" id="dsv2-source-clear">Remove</button>`
      : '';
    const clear = el('dsv2-source-clear');
    if (clear) clear.addEventListener('click', () => { state.source = ''; drawSource(); });
  }

  function pickFromLibrary(title, onUrls) {
    if (typeof global.openLibraryPicker !== 'function') { toast('Library is not available here', 'warning'); return; }
    global.openLibraryPicker({
      title,
      kinds: [],
      onPick: (picked) => onUrls((picked || []).map((a) => a && a.url).filter((u) => /^https:\/\//i.test(String(u || '')))),
    });
  }

  async function addExampleFiles(fileList) {
    const room = 10 - state.examples.length;
    const list = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    if (!room) { toast('10 slides is the maximum', 'warning'); return; }
    const take = list.slice(0, room);
    if (list.length > room) toast(`Only the first ${room} were added (10 max)`, 'info');
    const count = el('dsv2-count');
    if (count) count.textContent = `Uploading ${take.length}…`;
    const urls = await Promise.all(take.map((f) => uploadFile(f).catch((e) => { toast(e.message, 'error'); return ''; })));
    for (const u of urls) if (u && state.examples.length < 10) state.examples.push(u);
    drawExamples();
  }

  function wire() {
    const rebuild = el('dsv2-rebuild');
    if (rebuild) rebuild.addEventListener('click', (ev) => {
      ev.preventDefault();
      state.rebuild = !state.rebuild;
      draw();
      if (state.rebuild) reveal(el('dsv2-setup'));
    });
    const refresh = el('dsv2-refresh');
    if (refresh) refresh.addEventListener('click', async (ev) => {
      ev.preventDefault();
      refresh.disabled = true;
      refresh.textContent = 'Refreshing…';
      try {
        const r = await call('POST', '/api/design/system/previews');
        state.info = Object.assign({}, state.info, { previews: r.previews || [] });
        draw();
        const card = el('dsv2-system');
        if (card) card.open = true;
        toast('Previews refreshed', 'success');
      } catch (e) {
        toast(e.message || 'Could not refresh previews', 'error');
        refresh.disabled = false;
        refresh.textContent = 'Refresh previews';
      }
    });
    const med = el('dsv2-medical');
    if (med) med.addEventListener('change', async () => {
      const prev = medicalMode();
      med.disabled = true;
      try {
        const r = await call('PUT', '/api/design/settings', { medical: med.value });
        state.info = Object.assign({}, state.info, { settings: r.settings });
        const chip = el('dsv2-medical-chip');
        if (chip) chip.innerHTML = medicalChip();
        toast(med.value === 'always' ? 'Medical accuracy is on for every carousel' : med.value === 'ask' ? 'It will ask when a topic is medical or scientific' : 'Medical accuracy is off', 'success');
      } catch (e) {
        med.value = prev;
        toast(e.message || 'Could not save', 'error');
      }
      med.disabled = false;
    });
    state.root.querySelectorAll('.dsv2-patterns img[data-zoom]').forEach((img) => img.addEventListener('click', () => {
      const urls = [...state.root.querySelectorAll('.dsv2-patterns img[data-zoom]')].map((n) => n.getAttribute('src'));
      lightbox(urls, Number(img.dataset.zoom));
    }));

    const files = el('dsv2-files');
    if (files) {
      drawExamples();
      files.addEventListener('change', async () => {
        const picked = [...files.files];
        files.value = '';
        await addExampleFiles(picked);
      });
      const drop = el('dsv2-drop');
      drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (ev) => {
        ev.preventDefault();
        drop.classList.remove('is-over');
        addExampleFiles(ev.dataTransfer ? ev.dataTransfer.files : []);
      });
      el('dsv2-lib').addEventListener('click', () => pickFromLibrary('Pick approved slides', (urls) => {
        for (const u of urls) if (state.examples.length < 10 && !state.examples.includes(u)) state.examples.push(u);
        drawExamples();
      }));
      el('dsv2-build').addEventListener('click', startBuild);
      const sys = state.info && state.info.system;
      if (sys) {
        el('dsv2-ratio').value = sys.ratio || '4:5';
        el('dsv2-handle').value = sys.handle || '';
      }
    }

    const go = el('dsv2-go');
    if (go) {
      drawSource();
      go.addEventListener('click', () => startCarousel());
      el('dsv2-brief').addEventListener('input', () => { state.handoffMedical = undefined; setStatus('dsv2-medical-ask', ''); });
      el('dsv2-brief').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); startCarousel(); }
      });
      el('dsv2-source-file').addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!f) return;
        const view = el('dsv2-source-view');
        if (view) view.innerHTML = '<span class="dsv2-hint">Uploading…</span>';
        try { state.source = await uploadFile(f); } catch (e) { toast(e.message, 'error'); }
        drawSource();
      });
      el('dsv2-source-lib').addEventListener('click', () => pickFromLibrary('Pick a poster or infographic', (urls) => {
        if (urls[0]) { state.source = urls[0]; drawSource(); }
      }));
    }
  }

  function setStatus(id, html) {
    const box = el(id);
    if (box) box.innerHTML = html;
  }

  function progressHtml(kind, job) {
    const p = job.progress || {};
    const steps = STEPS[kind] || [];
    const now = STEP_OF[p.stage] !== undefined ? STEP_OF[p.stage] : p.stage;
    const at = steps.findIndex(([id]) => id === now);
    const started = Date.parse(job.created_at || '') || Date.now();
    return `<div class="dsv2-progress dsv2-fade" data-started="${started}">
      <div class="dsv2-progress-top"><span class="dsv2-spin"></span><span>${esc(stageText(p))}</span><span class="dsv2-time"></span></div>
      <div class="dsv2-steps">${steps.map(([id, label], i) => `<div class="dsv2-step${at > i ? ' is-done' : ''}${at === i ? ' is-now' : ''}">${esc(label)}</div>`).join('')}</div>
      <div class="dsv2-progress-note">You can leave this page. It keeps going and shows here when you come back.</div>
    </div>`;
  }

  function tickClock() {
    clearInterval(state.clock);
    state.clock = setInterval(() => {
      const box = state.root && state.root.querySelector('.dsv2-progress[data-started]');
      if (!box || !box.isConnected) { clearInterval(state.clock); return; }
      const s = Math.max(0, Math.round((Date.now() - Number(box.dataset.started)) / 1000));
      const t = box.querySelector('.dsv2-time');
      if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }

  async function startBuild() {
    if (state.examples.length < 2) { toast('Add at least 2 approved slides', 'warning'); return; }
    const btn = el('dsv2-build');
    if (btn) btn.disabled = true;
    try {
      const r = await call('POST', '/api/design/system/build', {
        example_urls: state.examples,
        notes: el('dsv2-notes').value.trim(),
        ratio: el('dsv2-ratio').value,
        handle: el('dsv2-handle').value.trim(),
      });
      store.set('job', { id: r.job_id, kind: 'build' });
      poll(r.job_id, 'build');
    } catch (e) {
      if (btn) btn.disabled = false;
      setStatus('dsv2-build-status', `<div class="dsv2-error">${esc(e.message)}</div>`);
    }
  }

  function askMedical() {
    setStatus('dsv2-medical-ask', `<div class="dsv2-ask dsv2-fade">
      <p><strong>This looks like a medical or scientific topic.</strong> Use medical &amp; scientific accuracy? Anatomy, medical and scientific pictures are drawn by FigureLabs, every number must come from an official source, and slides with unsourced figures are rewritten. It takes a few minutes longer.</p>
      <div class="dsv2-row"><button type="button" class="dsv2-btn dsv2-btn--primary" data-medical="yes">Use medical accuracy</button><button type="button" class="dsv2-btn" data-medical="no">Standard</button></div>
    </div>`);
    const box = el('dsv2-medical-ask');
    if (box) {
      box.querySelectorAll('[data-medical]').forEach((b) => b.addEventListener('click', () => {
        setStatus('dsv2-medical-ask', '');
        startCarousel({ medical: b.dataset.medical === 'yes' });
      }));
      reveal(box);
    }
  }

  async function startCarousel(opts) {
    const briefEl = el('dsv2-brief');
    const brief = briefEl ? briefEl.value.trim() : '';
    if (brief.length < 10) { toast('Describe the carousel in a sentence or two', 'warning'); if (briefEl) briefEl.focus(); return; }
    const btn = el('dsv2-go');
    if (!btn || btn.disabled) return;
    let medical = opts && typeof opts.medical === 'boolean' ? opts.medical : undefined;
    if (medical === undefined && medicalMode() === 'ask') {
      if (state.handoffMedical === true || state.handoffMedical === false) medical = state.handoffMedical;
      else if (state.handoffMedical === 'ask') { askMedical(); return; }
      else {
        btn.disabled = true;
        btn.textContent = 'Checking topic…';
        let isMedical = false;
        try { isMedical = !!(await call('POST', '/api/design/classify', { brief })).medical; } catch (_) { isMedical = true; }
        btn.disabled = false;
        btn.textContent = 'Design carousel';
        if (isMedical) { askMedical(); return; }
        medical = false;
      }
    }
    setStatus('dsv2-medical-ask', '');
    btn.disabled = true;
    try {
      const r = await call('POST', '/api/design/carousel', {
        brief,
        medical,
        count: el('dsv2-slides').value === 'auto' ? undefined : Math.max(3, Math.min(10, Number(el('dsv2-slides').value))),
        research: !!el('dsv2-research').checked,
        source_image_url: state.source || undefined,
      });
      store.set('job', { id: r.job_id, kind: 'carousel', brief });
      setStatus('dsv2-result', '');
      poll(r.job_id, 'carousel');
    } catch (e) {
      btn.disabled = false;
      setStatus('dsv2-make-status', `<div class="dsv2-error">${esc(e.message)}</div>`);
    }
  }

  function poll(id, kind) {
    clearTimeout(state.pollTimer);
    const statusId = kind === 'build' ? 'dsv2-build-status' : 'dsv2-make-status';
    const btnId = kind === 'build' ? 'dsv2-build' : 'dsv2-go';
    const root = state.root;
    let first = true;
    const tick = async () => {
      if (state.root !== root || !root.isConnected) return;
      let job;
      try {
        job = (await call('GET', `/api/design/jobs/${encodeURIComponent(id)}`)).job;
      } catch (e) {
        if (/not found/i.test(e.message)) {
          store.set('job', null);
          setStatus(statusId, '');
          const b = el(btnId);
          if (b) b.disabled = false;
          return;
        }
        state.pollTimer = setTimeout(tick, 5000);
        return;
      }
      if (state.root !== root || !root.isConnected) return;
      if (job.status === 'done') {
        const meta = store.get('job') || {};
        store.set('job', null);
        clearInterval(state.clock);
        if (kind === 'build') {
          toast('Your design system is ready', 'success');
          state.rebuild = false;
          state.examples = [];
          state.info = await call('GET', '/api/design/system').catch(() => state.info);
          store.set('last', null);
          draw();
          const sysCard = el('dsv2-system');
          if (sysCard) sysCard.open = true;
        } else {
          setStatus(statusId, '');
          const b = el(btnId);
          if (b) b.disabled = false;
          store.set('last', Object.assign({}, job.result, { brief: meta.brief || '' }));
          showResult(job.result, true);
          toast('Carousel ready', 'success');
        }
        return;
      }
      if (job.status === 'failed') {
        store.set('job', null);
        clearInterval(state.clock);
        setStatus(statusId, `<div class="dsv2-error">${esc(job.error || 'Design failed. Try again.')}</div>`);
        const b = el(btnId);
        if (b) b.disabled = false;
        return;
      }
      const box = el(statusId);
      if (box) {
        const live = box.querySelector('.dsv2-progress');
        if (live) {
          const fresh = document.createElement('div');
          fresh.innerHTML = progressHtml(kind, job);
          live.querySelector('.dsv2-progress-top span:nth-child(2)').textContent = fresh.querySelector('.dsv2-progress-top span:nth-child(2)').textContent;
          live.querySelector('.dsv2-steps').innerHTML = fresh.querySelector('.dsv2-steps').innerHTML;
        } else {
          box.innerHTML = progressHtml(kind, job);
        }
        if (first) { reveal(box); tickClock(); first = false; }
      }
      const b = el(btnId);
      if (b) b.disabled = true;
      state.pollTimer = setTimeout(tick, 3000);
    };
    tick();
  }

  function captionWithTags(result) {
    const tags = (result.hashtags || []).join(' ');
    return [String(result.caption || '').trim(), tags].filter(Boolean).join('\n\n');
  }

  function showResult(result, scroll) {
    const box = el('dsv2-result');
    if (!box || !result || !Array.isArray(result.slides)) return;
    const slides = result.slides.filter((s) => s && s.url);
    const ratio = ratioCss();
    box.innerHTML = `<div class="dsv2-card dsv2-fade" id="dsv2-done">
      <div class="dsv2-card-head">
        <div><h3>${esc(result.title || 'Your carousel')}</h3>${result.angle ? `<p class="dsv2-sub" style="margin-top:4px;">${esc(result.angle)}</p>` : ''}</div>
        <div class="dsv2-row">
          <button type="button" class="dsv2-btn" id="dsv2-zip">Download</button>
          <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-queue">Add to queue</button>
        </div>
      </div>
      <div class="dsv2-hint" id="dsv2-posts-to" style="margin:-6px 0 12px;text-align:right;">${queuePlatforms().length ? `Posts to ${queuePlatforms().join(' + ')}` : 'Connect Instagram or Facebook in Settings to post'}
      </div>
      <div class="dsv2-slides">${slides.map((s, i) => {
        const c = s.critic || {};
        const score = Number(c.score) || 0;
        const notes = (c.problems || []).slice(0, 2).join('; ');
        return `<figure class="dsv2-slide"><button type="button" data-open="${i}" aria-label="View slide ${i + 1}"><img src="${esc(s.url)}" alt="Slide ${i + 1}" loading="lazy" style="aspect-ratio:${ratio};object-fit:cover;"></button>
          <figcaption class="dsv2-slide-meta">Slide ${i + 1}${score ? ` · review <span class="dsv2-score${score < 4 ? ' dsv2-score--low' : ''}">${score}/5</span>` : ''}${notes ? `<br>${esc(notes)}` : ''}</figcaption></figure>`;
      }).join('')}</div>
      <label class="dsv2-label" for="dsv2-caption">Caption</label>
      <textarea id="dsv2-caption" style="min-height:130px;">${esc(captionWithTags(result))}</textarea>
      ${(result.sources || []).length ? `<div class="dsv2-sources"><label class="dsv2-label">Facts checked against</label>${result.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('')}</div>` : ''}
    </div>`;
    const urls = slides.map((s) => s.url);
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => lightbox(urls, Number(b.dataset.open))));
    el('dsv2-zip').addEventListener('click', () => downloadZip(urls));
    el('dsv2-queue').addEventListener('click', () => queue(urls, result));
    if (scroll) reveal(box.firstElementChild);
  }

  function lightbox(urls, start) {
    if (!urls.length) return;
    let i = Math.max(0, Math.min(urls.length - 1, start || 0));
    const lb = document.createElement('div');
    lb.className = 'dsv2-lb';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = `<img alt=""><button type="button" class="dsv2-lb-close" aria-label="Close">×</button>${urls.length > 1 ? '<button type="button" class="dsv2-lb-prev" aria-label="Previous">‹</button><button type="button" class="dsv2-lb-next" aria-label="Next">›</button>' : ''}<div class="dsv2-lb-count"></div>`;
    const img = lb.querySelector('img');
    const count = lb.querySelector('.dsv2-lb-count');
    const show = () => { img.src = urls[i]; count.textContent = `${i + 1} / ${urls.length}`; };
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); };
    const step = (d) => { i = (i + d + urls.length) % urls.length; show(); };
    function onKey(ev) {
      if (ev.key === 'Escape') close();
      else if (ev.key === 'ArrowRight') step(1);
      else if (ev.key === 'ArrowLeft') step(-1);
    }
    lb.addEventListener('click', (ev) => { if (ev.target === lb) close(); });
    lb.querySelector('.dsv2-lb-close').addEventListener('click', close);
    const prev = lb.querySelector('.dsv2-lb-prev');
    if (prev) {
      prev.addEventListener('click', () => step(-1));
      lb.querySelector('.dsv2-lb-next').addEventListener('click', () => step(1));
    }
    document.addEventListener('keydown', onKey);
    show();
    document.body.appendChild(lb);
  }

  async function downloadZip(urls) {
    const btn = el('dsv2-zip');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const res = await fetch(`${apiBase()}/api/studio/carousel-zip`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ image_urls: urls }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'carousel-slides.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toast(e.message || 'Download failed', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Download'; }
    }
  }

  function queuePlatforms() {
    const data = global.__clientData || global.clientData || global._studioClientData || {};
    const c = data.client || data.fields || data;
    const raw = c.social_connected_platforms;
    const lower = (Array.isArray(raw) ? raw : String(raw || '').split(',')).map((p) => String(p || '').trim().toLowerCase());
    const fbFlag = String(c.facebook_connected || '').toLowerCase();
    const fbOff = fbFlag === 'false' || fbFlag === '0' || fbFlag === 'no';
    const out = [];
    if (lower.includes('instagram') || String(c.instagram_user_id || '').trim()) out.push('Instagram');
    if (lower.includes('facebook') || (!fbOff && c.meta_page_id && c.meta_page_token)) out.push('Facebook');
    return out;
  }

  async function queue(urls, result) {
    const btn = el('dsv2-queue');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
      const ready = global.studioQueueReady || {};
      const caption = (el('dsv2-caption') && el('dsv2-caption').value.trim()) || captionWithTags(result);
      const r = await call('POST', '/api/studio/design-queue', {
        image_urls: urls,
        brief: result.brief || result.title || '',
        caption,
        platform: queuePlatforms().join(',') || 'Instagram,Facebook',
        status: typeof ready.queueReviewStatus === 'function' ? ready.queueReviewStatus() : 'Pending',
      });
      if (!(r.ok || r.success)) throw new Error(r.error || 'Queue failed');
      toast('Added to content queue', 'success');
      if (btn) btn.textContent = 'Added ✓';
      if (typeof ready.openContentReviewAfterQueue === 'function') ready.openContentReviewAfterQueue();
    } catch (e) {
      toast(e.message || 'Queue failed', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Add to queue'; }
    }
  }

  function applyHandoff(p) {
    const brief = el('dsv2-brief');
    if (!brief) {
      if (!(state.info && state.info.system)) toast('Set up your brand design first, then Coach can design carousels in it', 'info');
      return;
    }
    brief.value = String(p.brief || '');
    el('dsv2-slides').value = Number(p.slides) >= 3 ? String(Math.min(10, Math.round(Number(p.slides)))) : 'auto';
    if (/^https:\/\//i.test(String(p.source_image_url || ''))) { state.source = p.source_image_url; drawSource(); }
    state.handoffMedical = p.medical === true || p.medical === false || p.medical === 'ask' ? p.medical : undefined;
    reveal(brief);
    if (p.autostart && !store.get('job')) startCarousel();
  }

  function openWith(p) {
    state.pending = Object.assign({}, p || {});
    if (typeof global.switchNav === 'function') global.switchNav('brand-design');
  }

  global.seDesignStudio = { render, openWith, stageText };
})(typeof window !== 'undefined' ? window : globalThis);
