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
  // Requests that are made in one of the brand's styles carry its id (slides being edited use the style they were made in).
  const STYLED = /^\/api\/design\/(carousel|posts|slide|slides|recipes|system\/previews)/;
  function styleFor(path) {
    return /^\/api\/design\/slides?\b/.test(path) ? (state.resultStyle || state.styleId || '') : (state.styleId || '');
  }
  async function call(method, path, body) {
    const sid = STYLED.test(path) ? styleFor(path) : '';
    if (sid) {
      if (body && typeof body === 'object' && !body.style_id) body = Object.assign({ style_id: sid }, body);
      else if (!body) path += `${path.includes('?') ? '&' : '?'}style=${encodeURIComponent(sid)}`;
    }
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = json.code || '';
      err.fix = json.fix || null;
      err.canOverride = json.can_override === true;
      throw err;
    }
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
    queued: 'In line for a free designer…',
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
    // Only a couple of designs are made at a time. Others wait their turn, and this says where yours is.
    if (p.stage === 'queued' && Number.isFinite(Number(p.ahead))) {
      const n = Number(p.ahead);
      return n > 0 ? `In line: ${n} design${n === 1 ? '' : 's'} ahead of yours, starting when a designer is free…` : 'Next in line, starting as soon as a designer is free…';
    }
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
    newStyle: false,
    styleId: '',
    resultStyle: '',
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
      .dsv2-styles { margin:0 0 14px; }
      .dsv2-stylechip { display:inline-flex; align-items:center; gap:7px; min-height:36px; padding:0 13px; border-radius:999px; border:1px solid rgba(255,255,255,0.16); background:transparent; color:inherit; font:inherit; font-size:0.82rem; font-weight:600; cursor:pointer; }
      .dsv2-stylechip i { width:11px; height:11px; border-radius:50%; display:inline-block; border:1px solid rgba(255,255,255,0.25); }
      .dsv2-stylechip em { font-style:normal; font-size:0.68rem; font-weight:700; opacity:0.65; text-transform:uppercase; letter-spacing:0.04em; }
      .dsv2-stylechip.is-on { border-color:#8B5CF6; background:rgba(139,92,246,0.16); }
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
      .dsv2-opt { text-transform:none; letter-spacing:0; font-weight:500; color:rgba(255,255,255,0.35); margin-left:6px; }
      .dsv2-rcps { display:flex; gap:10px; overflow-x:auto; padding:2px 2px 6px; scrollbar-width:thin; }
      .dsv2-rcp { flex:0 0 auto; width:184px; text-align:left; padding:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.22); color:#F8FAFC; cursor:pointer; font-family:var(--font-body); display:flex; flex-direction:column; gap:6px; transition:border-color .15s, background .15s, box-shadow .15s; }
      .dsv2-rcp:hover { border-color:rgba(167,139,250,0.5); }
      .dsv2-rcp.is-on { border-color:#A78BFA; background:rgba(124,58,237,0.16); box-shadow:0 0 0 3px rgba(124,58,237,0.18); }
      .dsv2-rcp-strip { display:flex; gap:3px; height:46px; align-items:stretch; }
      .dsv2-rcp-strip img, .dsv2-rcp-strip i { height:100%; border-radius:4px; object-fit:cover; background:#0B0F1A; border:1px solid rgba(255,255,255,0.08); display:block; }
      .dsv2-rcp-strip em { font-style:normal; font-size:0.66rem; color:rgba(255,255,255,0.5); align-self:center; padding-left:2px; }
      .dsv2-rcp-name { font-size:0.84rem; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dsv2-rcp-meta { font-size:0.7rem; color:rgba(255,255,255,0.5); }
      .dsv2-rcp-on { margin-top:10px; padding:12px 14px; border-radius:12px; background:rgba(124,58,237,0.09); border:1px solid rgba(124,58,237,0.3); font-size:0.82rem; color:rgba(255,255,255,0.88); line-height:1.5; }
      .dsv2-rcp-on .dsv2-row { margin-top:8px; }
      .dsv2-rcp-rules { margin-top:6px; color:rgba(233,213,255,0.78); white-space:pre-wrap; }
      .dsv2-rcp-tip { font-size:0.76rem; color:rgba(255,255,255,0.5); padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.12); margin-top:14px; line-height:1.5; }
      .dsv2-rcp-tip strong { color:rgba(255,255,255,0.8); }
      .dsv2-rcp-form { margin:14px 0 4px; padding:14px 16px; border-radius:12px; background:rgba(124,58,237,0.08); border:1px solid rgba(124,58,237,0.3); }
      .dsv2-rcp-form textarea { min-height:70px; }
      .dsv2-rcp-form .dsv2-actions { margin-top:14px; }
      .dsv2-btn--danger { border-color:rgba(239,68,68,0.45); background:rgba(239,68,68,0.1); color:#FCA5A5; }
      .dsv2-btn--danger:hover:not(:disabled) { background:rgba(239,68,68,0.2); }
      .dsv2-btn--sm { padding:7px 12px; font-size:0.74rem; }
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
      .dsv2-slide-meta .dsv2-link { font-size:0.72rem; margin-right:6px; }
      .dsv2-ed { position:fixed; inset:0; z-index:10000; background:rgba(3,6,14,0.84); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:18px; font-family:var(--font-body); color:#E2E8F0; }
      .dsv2-ed *, .dsv2-ed *::before { box-sizing:border-box; }
      .dsv2-ed-box { background:#111726; border:1px solid rgba(255,255,255,0.1); border-radius:18px; width:min(1240px,100%); height:min(920px,100%); display:flex; flex-direction:column; box-shadow:0 30px 80px rgba(0,0,0,0.55); overflow:hidden; }
      .dsv2-ed-head { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:14px 20px; border-bottom:1px solid rgba(255,255,255,0.07); }
      .dsv2-ed-head h3 { margin:0; font-size:1.02rem; font-weight:800; color:#F8FAFC; }
      .dsv2-ed-head h3 span { color:rgba(255,255,255,0.5); font-weight:600; }
      .dsv2-ed-head p { margin:3px 0 0; font-size:0.75rem; color:rgba(255,255,255,0.5); }
      .dsv2-ed-close { width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:#fff; cursor:pointer; font-size:1.15rem; line-height:1; }
      .dsv2-ed-close:hover { background:rgba(255,255,255,0.12); }
      .dsv2-ed-body { flex:1; min-height:0; display:grid; grid-template-columns:minmax(260px,400px) 1fr; gap:22px; padding:18px 20px; overflow:auto; }
      .dsv2-ed-left { align-self:start; position:sticky; top:0; }
      .dsv2-ed-stage { position:relative; width:100%; border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,0.12); background:#0B0F1A; box-shadow:0 14px 44px rgba(0,0,0,0.45); }
      .dsv2-ed-still { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; transition:opacity .2s; }
      .dsv2-ed-stage iframe { position:absolute; left:0; top:0; border:0; transform-origin:0 0; opacity:0; pointer-events:none; background:transparent; }
      .dsv2-ed-stage.is-live iframe.is-on { opacity:1; pointer-events:auto; }
      .dsv2-ed-stage.is-live .dsv2-ed-still { opacity:0; }
      .dsv2-ed-badge { position:absolute; left:10px; top:10px; font-size:0.66rem; font-weight:700; padding:4px 9px; border-radius:999px; background:rgba(17,23,38,0.82); color:#C4B5FD; border:1px solid rgba(167,139,250,0.35); pointer-events:none; }
      .dsv2-ed-badge.is-dirty { color:#FCD34D; border-color:rgba(245,158,11,0.45); }
      .dsv2-ed-hist { display:flex; gap:8px; align-items:center; margin-top:12px; flex-wrap:wrap; }
      .dsv2-ed-hist .dsv2-link { margin-left:auto; }
      .dsv2-ed-warn { margin-top:12px; padding:10px 12px; border-radius:10px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.28); font-size:0.76rem; color:#FCD34D; line-height:1.5; }
      .dsv2-ed-panel { min-width:0; display:flex; flex-direction:column; }
      .dsv2-ed-tabs { display:flex; gap:4px; padding:4px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; margin-bottom:14px; flex-wrap:wrap; }
      .dsv2-ed-tab { flex:1; background:none; border:none; color:rgba(255,255,255,0.65); font-family:var(--font-body); font-size:0.8rem; font-weight:700; padding:9px 10px; border-radius:9px; cursor:pointer; white-space:nowrap; }
      .dsv2-ed-tab:hover { color:#fff; }
      .dsv2-ed-tab.is-on { background:linear-gradient(135deg,#7C3AED,#A855F7); color:#fff; box-shadow:0 3px 12px rgba(124,58,237,0.35); }
      .dsv2-ed-field { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.08); border-radius:13px; padding:12px 14px; transition:border-color .2s, box-shadow .2s; }
      .dsv2-ed-field + .dsv2-ed-field { margin-top:10px; }
      .dsv2-ed-field.is-sel, .dsv2-ed-field.is-flash { border-color:rgba(167,139,250,0.7); box-shadow:0 0 0 3px rgba(124,58,237,0.16); }
      .dsv2-ed-field.is-hidden input, .dsv2-ed-field.is-hidden textarea { opacity:0.45; }
      .dsv2-ed-field label { display:flex; align-items:baseline; gap:6px; font-size:0.78rem; font-weight:700; color:#F1F5F9; margin-bottom:7px; }
      .dsv2-ed-field label em { font-style:normal; font-weight:500; color:rgba(255,255,255,0.45); }
      .dsv2-ed-sub { display:block; font-size:0.72rem; font-weight:700; color:rgba(255,255,255,0.6); margin:14px 0 7px; }
      .dsv2-ed input[type=text], .dsv2-ed textarea { width:100%; background:#0A0F1E; border:1px solid rgba(255,255,255,0.14); border-radius:10px; color:#F8FAFC; padding:10px 12px; font-size:0.92rem; font-family:var(--font-body); line-height:1.5; transition:border-color .15s, box-shadow .15s; }
      .dsv2-ed textarea { resize:vertical; min-height:0; }
      .dsv2-ed input[type=text]::placeholder, .dsv2-ed textarea::placeholder { color:rgba(255,255,255,0.35); }
      .dsv2-ed input[type=text]:focus, .dsv2-ed textarea:focus { outline:none; border-color:rgba(167,139,250,0.75); box-shadow:0 0 0 3px rgba(124,58,237,0.2); }
      .dsv2-ed-count { margin-left:auto; font-weight:600; font-size:0.7rem; color:rgba(255,255,255,0.4); font-variant-numeric:tabular-nums; }
      .dsv2-ed-count.is-over { color:#FCA5A5; }
      .dsv2-ed-tools { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:9px; }
      .dsv2-ed-seg { display:inline-flex; align-items:center; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:9px; overflow:hidden; }
      .dsv2-ed-seg button { background:none; border:none; color:#E2E8F0; font-size:0.78rem; font-weight:700; padding:6px 9px; cursor:pointer; font-family:var(--font-body); }
      .dsv2-ed-seg button:hover { background:rgba(255,255,255,0.08); }
      .dsv2-ed-seg button.is-on { background:rgba(124,58,237,0.45); color:#fff; }
      .dsv2-ed-seg span { font-size:0.7rem; color:rgba(255,255,255,0.6); min-width:40px; text-align:center; font-variant-numeric:tabular-nums; }
      .dsv2-ed-swatches { display:inline-flex; gap:5px; align-items:center; flex-wrap:wrap; }
      .dsv2-ed-sw { width:24px; height:24px; border-radius:7px; border:2px solid rgba(255,255,255,0.18); cursor:pointer; padding:0; }
      .dsv2-ed-sw--none { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.55); font-size:0.66rem; line-height:1; }
      .dsv2-ed-sw.is-on { border-color:#fff; box-shadow:0 0 0 2px #7C3AED; }
      .dsv2-ed-hide { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:9px; color:#E2E8F0; font-size:0.74rem; font-weight:700; padding:6px 10px; cursor:pointer; font-family:var(--font-body); }
      .dsv2-ed-hide.is-on { background:rgba(245,158,11,0.18); border-color:rgba(245,158,11,0.5); color:#FCD34D; }
      .dsv2-ed-tip, .dsv2-ed-note { margin:12px 0 0; font-size:0.75rem; color:rgba(255,255,255,0.45); line-height:1.5; }
      .dsv2-ed-note { margin:0; color:#C4B5FD; }
      .dsv2-ed-layouts { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:12px; }
      .dsv2-ed-lay { background:none; border:2px solid transparent; border-radius:12px; padding:3px; cursor:pointer; color:rgba(255,255,255,0.7); font-family:var(--font-body); font-size:0.68rem; font-weight:600; text-align:center; }
      .dsv2-ed-lay img, .dsv2-ed-lay-blank { width:100%; display:block; object-fit:cover; border-radius:9px; background:rgba(255,255,255,0.06); }
      .dsv2-ed-lay span:last-child { display:block; margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dsv2-ed-lay:hover { border-color:rgba(167,139,250,0.4); }
      .dsv2-ed-lay.is-on { border-color:#A78BFA; color:#fff; background:rgba(124,58,237,0.14); }
      .dsv2-ed-picrow { display:flex; gap:16px; align-items:center; }
      .dsv2-ed-pic-now { width:110px; height:110px; flex:none; object-fit:contain; border-radius:12px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); display:block; }
      .dsv2-ed-range { display:grid; grid-template-columns:96px 1fr; align-items:center; gap:10px; font-size:0.74rem; color:rgba(255,255,255,0.7); }
      .dsv2-ed-range + .dsv2-ed-range { margin-top:8px; }
      .dsv2-ed-range input { width:100%; accent-color:#8B5CF6; }
      .dsv2-ed-chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
      .dsv2-ed-chip { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:#E2E8F0; border-radius:999px; padding:7px 13px; font-size:0.76rem; font-weight:600; cursor:pointer; font-family:var(--font-body); }
      .dsv2-ed-chip:hover { border-color:rgba(167,139,250,0.5); }
      .dsv2-ed-chip.is-on { background:rgba(124,58,237,0.28); border-color:#A78BFA; color:#fff; }
      .dsv2-ed .dsv2-check { color:rgba(255,255,255,0.8); margin-top:8px; min-height:0; }
      .dsv2-ed-strip { border-top:1px solid rgba(255,255,255,0.07); padding:12px 20px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; background:rgba(0,0,0,0.12); }
      .dsv2-ed-thumbs { display:flex; gap:8px; overflow-x:auto; flex:1; min-width:0; padding:2px; }
      .dsv2-ed-thumb { position:relative; flex:none; width:52px; padding:0; border:2px solid transparent; border-radius:9px; background:none; cursor:pointer; }
      .dsv2-ed-thumb img { width:100%; display:block; object-fit:cover; border-radius:7px; }
      .dsv2-ed-thumb > span:last-child { position:absolute; right:3px; bottom:3px; font-size:0.6rem; font-weight:800; background:rgba(0,0,0,0.65); color:#fff; padding:1px 5px; border-radius:6px; }
      .dsv2-ed-thumb.is-on { border-color:#A78BFA; box-shadow:0 0 0 2px rgba(124,58,237,0.35); }
      .dsv2-ed-add { min-height:70px; border:2px dashed rgba(255,255,255,0.2); color:rgba(255,255,255,0.7); display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:var(--font-body); }
      .dsv2-ed-add > span:last-child { position:static; background:none; font-size:0.62rem; }
      .dsv2-ed-plus { font-size:1.3rem; line-height:1; }
      .dsv2-ed-ops { display:flex; gap:6px; flex-wrap:wrap; }
      .dsv2-ed-ops .dsv2-btn { padding:7px 11px; font-size:0.74rem; }
      .dsv2-ed-addbox { flex-basis:100%; display:flex; gap:8px; }
      .dsv2-ed-addbox[hidden] { display:none; }
      .dsv2-ed-addbox input { flex:1; }
      .dsv2-ed-foot { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:12px 20px; border-top:1px solid rgba(255,255,255,0.07); background:rgba(0,0,0,0.2); }
      .dsv2-ed-foot .dsv2-hint { display:flex; align-items:center; gap:8px; }
      .dsv2-ed-busy .dsv2-ed-panel, .dsv2-ed-busy .dsv2-ed-thumbs { opacity:0.5; pointer-events:none; }
      @media (max-width: 860px) {
        .dsv2-ed { padding:0; }
        .dsv2-ed-box { border-radius:0; height:100%; }
        .dsv2-ed-body { grid-template-columns:1fr; padding:12px; }
        .dsv2-ed-left { position:static; max-width:300px; width:100%; margin:0 auto; }
        .dsv2-ed-foot { flex-direction:column; align-items:stretch; }
      }
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
      state.info = await call('GET', `/api/design/system${state.styleId ? `?style=${encodeURIComponent(state.styleId)}` : ''}`);
      state.styleId = (state.info.style && state.info.style.id) || '';
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
      root.innerHTML = '<div class="dsv2-scroll"><div class="dsv2"><h2>Carousels</h2><p class="dsv2-sub">Brand template carousels are not switched on for this account yet. You can still turn an infographic into slides, or post finished slides.</p><div class="dsv2-actions"><button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-open-slides">Infographic or finished slides →</button></div></div></div>';
      const openSlides = el('dsv2-open-slides');
      if (openSlides) openSlides.addEventListener('click', () => { if (typeof global.seOpenCarousels === 'function') global.seOpenCarousels('slides'); });
      return;
    }
    const showSetup = !sys || state.rebuild;
    root.innerHTML = `<div class="dsv2-scroll"><div class="dsv2">
      <div class="dsv2-head"><div>
        <h2>Carousels</h2>
        <p class="dsv2-sub">Carousels designed in your exact brand style: your layouts, fonts, colours and illustration style, with facts checked and every slide reviewed before you see it.</p>
      </div><button type="button" class="dsv2-btn" id="dsv2-open-slides" title="Split a tall infographic into slides, or post finished slides as they are">Infographic or finished slides →</button></div>
      ${sys ? stylesStrip(info) : ''}
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
          <h3>${esc((info.style && info.style.name) || sys.name || 'Your brand')}${(info.styles || []).length > 1 ? '' : ' design system'}</h3>
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
          <button type="button" class="dsv2-link" id="dsv2-rebuild">${state.rebuild ? (state.newStyle ? 'Cancel' : 'Cancel rebuild') : 'Rebuild from new examples'}</button>
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

  function stylesStrip(info) {
    const styles = info.styles || [];
    const cur = (info.style && info.style.id) || '';
    const room = styles.length < (info.max_styles || 6);
    const viewed = styles.find((st) => st.id === cur);
    return `<div class="dsv2-styles" id="dsv2-styles">
      <div class="dsv2-row" style="gap:8px;flex-wrap:wrap;">
        <span class="dsv2-label" style="margin:0;">Style</span>
        ${styles.map((st) => `<button type="button" class="dsv2-stylechip${st.id === cur ? ' is-on' : ''}" data-style="${esc(st.id)}" aria-pressed="${st.id === cur}">${st.colors.slice(0, 3).map((c) => `<i style="background:${esc(c)}"></i>`).join('')}${esc(st.name)}${st.active ? '<em>default</em>' : ''}</button>`).join('')}
        ${room ? '<button type="button" class="dsv2-btn" id="dsv2-newstyle">+ New style</button>' : ''}
      </div>
      ${viewed && styles.length > 1 ? `<div class="dsv2-row" style="gap:14px;margin-top:8px;">
        ${viewed.active ? '<span class="dsv2-hint">New carousels use this style unless you pick another.</span>' : '<button type="button" class="dsv2-link" id="dsv2-style-default">Use as my default</button>'}
        <button type="button" class="dsv2-link" id="dsv2-style-rename">Rename</button>
        <button type="button" class="dsv2-link" id="dsv2-style-delete">Delete</button>
      </div>` : (viewed ? '<div class="dsv2-row" style="margin-top:8px;"><button type="button" class="dsv2-link" id="dsv2-style-rename">Rename</button></div>' : '')}
    </div>`;
  }

  function setupCard(isRebuild) {
    const adding = state.newStyle;
    return `<div class="dsv2-card" id="dsv2-setup">
      <h3>${adding ? 'Add a new style' : isRebuild ? 'Rebuild this style' : 'Step 1: teach it your brand'}</h3>
      <p class="dsv2-sub" style="margin-top:6px;">${adding ? 'Your other styles stay exactly as they are. ' : ''}Add 1–10 finished slides, posters or posts in the look you want. One is enough to start; a mix of slide types (cover, big number, list, comparison, call to action) teaches it the most. Takes about 10 minutes.</p>
      ${adding ? '<label class="dsv2-label" for="dsv2-stylename">Name this style</label><input type="text" id="dsv2-stylename" maxlength="60" placeholder="e.g. Mint and purple">' : ''}
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
          <select id="dsv2-ratio"><option value="9:16">9:16 tall (carousels, Reels, Stories)</option><option value="4:5">4:5 portrait (feed posts only)</option><option value="1:1">1:1 square (feed posts only)</option></select>
          <p class="dsv2-hint" id="dsv2-ratio-hint"></p></div>
        <div><label class="dsv2-label" for="dsv2-handle">Handle or website on slides</label>
          <input type="text" id="dsv2-handle" placeholder="@yourbrand"></div>
      </div>
      <div class="dsv2-actions">
        <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-build">${adding ? 'Build this style' : 'Build my design system'}</button>
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
      <div id="dsv2-recipes"></div>
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

  function recipes() { return (state.info && state.info.recipes) || []; }
  function activeRecipe() { return recipes().find((r) => r.id === state.recipeId) || null; }

  function recipeStrip(r) {
    const previews = new Map(((state.info && state.info.previews) || []).filter((p) => p && p.url).map((p) => [p.pattern, p.url]));
    const ratio = `aspect-ratio:${ratioCss()}`;
    const shown = r.slides.slice(0, 6).map((s) => (previews.get(s.pattern) ? `<img src="${esc(previews.get(s.pattern))}" alt="" style="${ratio}">` : `<i style="${ratio}"></i>`)).join('');
    return `<span class="dsv2-rcp-strip">${shown}${r.slides.length > 6 ? `<em>+${r.slides.length - 6}</em>` : ''}</span>`;
  }

  function recipeForm(prefix, r, saveLabel) {
    return `<div class="dsv2-rcp-form dsv2-fade" id="${prefix}-form">
      <label class="dsv2-label" for="${prefix}-name">Recipe name</label>
      <input type="text" id="${prefix}-name" maxlength="60" value="${esc(r.name || '')}" placeholder="e.g. Myth vs fact">
      <label class="dsv2-label" for="${prefix}-notes">Rules for every carousel from this recipe <span class="dsv2-opt">optional</span></label>
      <textarea id="${prefix}-notes" maxlength="800" placeholder="e.g. Always 3 myths. End with &quot;Book a free call&quot;. Friendly, no jargon.">${esc(r.notes || '')}</textarea>
      <div class="dsv2-actions"><button type="button" class="dsv2-btn dsv2-btn--primary" id="${prefix}-ok">${esc(saveLabel)}</button><button type="button" class="dsv2-btn" id="${prefix}-cancel">Cancel</button></div>
    </div>`;
  }

  function setRecipes(list) {
    state.info = Object.assign({}, state.info, { recipes: list || [] });
    drawRecipes();
  }

  function drawRecipes() {
    const box = el('dsv2-recipes');
    if (!box) return;
    const list = recipes();
    const on = activeRecipe();
    if (!on) state.recipeId = null;
    if (!list.length) {
      box.innerHTML = '<div class="dsv2-rcp-tip">Tip: when a carousel works, click <strong>Save as recipe</strong> on it. Next time pick the recipe, type a new topic, and get the same structure and look.</div>';
    } else {
      box.innerHTML = `<label class="dsv2-label">Start from a recipe <span class="dsv2-opt">optional</span></label>
        <div class="dsv2-rcps">${list.map((r) => `<button type="button" class="dsv2-rcp${r.id === state.recipeId ? ' is-on' : ''}" data-rcp="${esc(r.id)}" aria-pressed="${r.id === state.recipeId}">${recipeStrip(r)}<span class="dsv2-rcp-name">${esc(r.name)}</span><span class="dsv2-rcp-meta">${r.slides.length} slides${r.medical ? ' · medical accuracy' : ''}</span></button>`).join('')}</div>
        ${on ? `<div class="dsv2-rcp-on dsv2-fade" id="dsv2-rcp-on">
          <div><strong>Using “${esc(on.name)}”.</strong> Same ${on.slides.length} layouts in the same order, with their saved looks. New words and pictures for your topic.</div>
          ${on.notes ? `<div class="dsv2-rcp-rules">Rules: ${esc(on.notes)}</div>` : ''}
          <div class="dsv2-row"><button type="button" class="dsv2-btn dsv2-btn--sm" id="dsv2-rcp-edit">Edit recipe</button><button type="button" class="dsv2-btn dsv2-btn--sm dsv2-btn--danger" id="dsv2-rcp-del">Delete</button><button type="button" class="dsv2-link" id="dsv2-rcp-off">Don't use a recipe</button></div>
          <div id="dsv2-rcp-editbox"></div>
        </div>` : ''}`;
      box.querySelectorAll('[data-rcp]').forEach((b) => b.addEventListener('click', () => {
        state.recipeId = state.recipeId === b.dataset.rcp ? null : b.dataset.rcp;
        drawRecipes();
        if (state.recipeId) { const brief = el('dsv2-brief'); if (brief) brief.focus(); }
      }));
      if (on) wireActiveRecipe(on);
    }
    syncRecipeFields();
  }

  function wireActiveRecipe(on) {
    el('dsv2-rcp-off').addEventListener('click', () => { state.recipeId = null; drawRecipes(); });
    el('dsv2-rcp-del').addEventListener('click', async (ev) => {
      if (!global.confirm(`Delete the recipe “${on.name}”? Carousels you already made stay as they are.`)) return;
      ev.target.disabled = true;
      try {
        const r = await call('DELETE', `/api/design/recipes/${encodeURIComponent(on.id)}`);
        state.recipeId = null;
        setRecipes(r.recipes);
        toast('Recipe deleted', 'success');
      } catch (e) {
        ev.target.disabled = false;
        toast(e.message || 'Could not delete', 'error');
      }
    });
    el('dsv2-rcp-edit').addEventListener('click', () => {
      const box = el('dsv2-rcp-editbox');
      if (el('dsv2-rcpe-form')) { box.innerHTML = ''; return; }
      box.innerHTML = recipeForm('dsv2-rcpe', on, 'Save changes');
      el('dsv2-rcpe-cancel').addEventListener('click', () => { box.innerHTML = ''; });
      el('dsv2-rcpe-ok').addEventListener('click', async () => {
        const btn = el('dsv2-rcpe-ok');
        btn.disabled = true;
        try {
          const r = await call('PATCH', `/api/design/recipes/${encodeURIComponent(on.id)}`, { name: el('dsv2-rcpe-name').value.trim(), notes: el('dsv2-rcpe-notes').value.trim() });
          setRecipes(r.recipes);
          toast('Recipe saved', 'success');
        } catch (e) {
          btn.disabled = false;
          toast(e.message || 'Could not save', 'error');
        }
      });
      el('dsv2-rcpe-name').focus();
    });
  }

  function syncRecipeFields() {
    const on = activeRecipe();
    const count = el('dsv2-slides');
    const research = el('dsv2-research');
    const brief = el('dsv2-brief');
    const go = el('dsv2-go');
    if (count) {
      const old = count.querySelector('option[value="recipe"]');
      if (old) old.remove();
      if (on) {
        count.insertAdjacentHTML('afterbegin', `<option value="recipe">${on.slides.length} (from recipe)</option>`);
        count.value = 'recipe';
      } else if (count.value === 'recipe' || !count.value) {
        count.value = 'auto';
      }
      count.disabled = !!on;
    }
    if (research && on) research.checked = on.research !== false;
    if (research) research.disabled = !!on;
    if (brief) brief.placeholder = on ? `New topic for “${on.name}”: what it's about and who it's for` : "Topic, who it's for, the key points, and what people should do at the end";
    if (go && !go.disabled) go.textContent = on ? 'Design from recipe' : 'Design carousel';
  }

  function openSaveRecipe(result) {
    const box = el('dsv2-rcp-savebox');
    if (!box) return;
    if (el('dsv2-rcp-form')) { box.innerHTML = ''; return; }
    box.innerHTML = `${recipeForm('dsv2-rcp', { name: result.title || '' }, 'Save recipe')}`;
    box.querySelector('.dsv2-rcp-form').insertAdjacentHTML('afterbegin', '<div class="dsv2-hint" style="margin-bottom:-4px;">Saves the slide order, layouts and looks, plus your rules. Not the words or pictures. Next time pick it and type a new topic.</div>');
    el('dsv2-rcp-cancel').addEventListener('click', () => { box.innerHTML = ''; });
    el('dsv2-rcp-ok').addEventListener('click', async () => {
      const btn = el('dsv2-rcp-ok');
      const name = el('dsv2-rcp-name').value.trim();
      if (!name) { toast('Give the recipe a name', 'warning'); el('dsv2-rcp-name').focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const research = el('dsv2-research');
        const r = await call('POST', '/api/design/recipes', {
          name,
          notes: el('dsv2-rcp-notes').value.trim(),
          caption: result.caption || '',
          medical: !!result.medical,
          research: (result.sources || []).length > 0 || !!(research && research.checked),
          slides: (result.slides || []).map((s) => ({ pattern: s.pattern, slots: s.slots, style: s.style })),
        });
        box.innerHTML = '';
        setRecipes(r.recipes);
        const save = el('dsv2-rcp-save');
        if (save) { save.textContent = 'Saved as recipe ✓'; save.disabled = true; }
        toast(`Saved “${r.recipe.name}”. Pick it under Make a carousel next time.`, 'success');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Save recipe';
        toast(e.message || 'Could not save the recipe', 'error');
      }
    });
    reveal(box);
    el('dsv2-rcp-name').select();
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

  async function loadStyle(id) {
    state.styleId = id;
    state.recipeId = null;
    state.info = await call('GET', `/api/design/system?style=${encodeURIComponent(id)}`);
    state.styleId = (state.info.style && state.info.style.id) || id;
  }

  function root_wireStyles() {
    const info = state.info || {};
    state.root.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.style === state.styleId || store.get('job')) return;
      try { await loadStyle(b.dataset.style); state.rebuild = false; state.newStyle = false; draw(); } catch (e) { toast(e.message || 'Could not open that style', 'error'); }
    }));
    const add = el('dsv2-newstyle');
    if (add) add.addEventListener('click', () => { state.rebuild = true; state.newStyle = true; state.examples = []; draw(); reveal(el('dsv2-setup')); });
    const mk = (id, fn) => { const b = el(id); if (b) b.addEventListener('click', async (ev) => { ev.preventDefault(); b.disabled = true; try { await fn(); } catch (e) { toast(e.message || 'Could not do that', 'error'); } b.disabled = false; }); };
    mk('dsv2-style-default', async () => {
      const r = await call('PUT', '/api/design/styles/active', { id: state.styleId });
      state.info = Object.assign({}, state.info, { styles: r.styles, default_style: r.default_style });
      draw();
      toast('New carousels will use this style', 'success');
    });
    mk('dsv2-style-rename', async () => {
      const cur = (info.style && info.style.name) || '';
      const name = global.prompt('Name this style', cur);
      if (!name || !name.trim() || name.trim() === cur) return;
      const r = await call('PATCH', `/api/design/styles/${encodeURIComponent(state.styleId)}`, { name: name.trim() });
      state.info = Object.assign({}, state.info, { styles: r.styles, style: Object.assign({}, info.style, { name: (r.styles.find((st) => st.id === state.styleId) || {}).name || name.trim() }) });
      draw();
    });
    mk('dsv2-style-delete', async () => {
      const cur = (info.style && info.style.name) || 'this style';
      if (!global.confirm(`Delete the style “${cur}”? Carousels you already made stay as they are.`)) return;
      const r = await call('DELETE', `/api/design/styles/${encodeURIComponent(state.styleId)}`);
      await loadStyle(r.default_style);
      draw();
      toast('Style deleted', 'success');
    });
  }

  function wire() {
    const openSlides = el('dsv2-open-slides');
    if (openSlides) openSlides.addEventListener('click', () => { if (typeof global.seOpenCarousels === 'function') global.seOpenCarousels('slides'); });
    root_wireStyles();
    const rebuild = el('dsv2-rebuild');
    if (rebuild) rebuild.addEventListener('click', (ev) => {
      ev.preventDefault();
      state.rebuild = !state.rebuild;
      if (!state.rebuild) state.newStyle = false;
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
        el('dsv2-ratio').value = state.newStyle ? '9:16' : (sys.ratio || '9:16');
        el('dsv2-handle').value = sys.handle || '';
      }
      const hintRatio = () => {
        const hint = el('dsv2-ratio-hint');
        if (hint) hint.textContent = el('dsv2-ratio').value === '9:16' ? '' : 'Carousels are 9:16. Carousels can only be made in a 9:16 style unless you choose to make one anyway.';
      };
      el('dsv2-ratio').addEventListener('change', hintRatio);
      hintRatio();
    }

    const go = el('dsv2-go');
    if (go) {
      drawSource();
      drawRecipes();
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
    if (state.examples.length < 1) { toast('Add at least one slide or poster in the look you want', 'warning'); return; }
    const btn = el('dsv2-build');
    if (btn) btn.disabled = true;
    try {
      const nameEl = el('dsv2-stylename');
      const r = await call('POST', '/api/design/system/build', {
        add: state.newStyle || undefined,
        style_id: state.newStyle ? undefined : (state.styleId || undefined),
        style_name: state.newStyle && nameEl ? nameEl.value.trim() || undefined : undefined,
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
    const recipe = activeRecipe();
    let medical = opts && typeof opts.medical === 'boolean' ? opts.medical : undefined;
    if (medical === undefined && recipe && recipe.medical && medicalMode() === 'ask') medical = true;
    if (medical === undefined && medicalMode() === 'ask') {
      if (state.handoffMedical === true || state.handoffMedical === false) medical = state.handoffMedical;
      else if (state.handoffMedical === 'ask') { askMedical(); return; }
      else {
        btn.disabled = true;
        btn.textContent = 'Checking topic…';
        let isMedical = false;
        try { isMedical = !!(await call('POST', '/api/design/classify', { brief })).medical; } catch (_) { isMedical = true; }
        btn.disabled = false;
        btn.textContent = recipe ? 'Design from recipe' : 'Design carousel';
        if (isMedical) { askMedical(); return; }
        medical = false;
      }
    }
    setStatus('dsv2-medical-ask', '');
    btn.disabled = true;
    try {
      const count = el('dsv2-slides').value;
      const r = await call('POST', '/api/design/carousel', {
        brief,
        medical,
        recipe_id: recipe ? recipe.id : undefined,
        count: recipe || count === 'auto' ? undefined : Math.max(3, Math.min(10, Number(count))),
        research: !!el('dsv2-research').checked,
        source_image_url: state.source || undefined,
        format_override: state.formatOverride ? true : undefined,
      });
      state.formatOverride = false;
      store.set('job', { id: r.job_id, kind: 'carousel', brief });
      setStatus('dsv2-result', '');
      poll(r.job_id, 'carousel');
    } catch (e) {
      state.formatOverride = false;
      btn.disabled = false;
      if (e.code === 'DESIGN_FORMAT') { askFormat(e); return; }
      setStatus('dsv2-make-status', `<div class="dsv2-error">${esc(e.message)}</div>`);
    }
  }

  // The rulebook said no before any work was paid for: this style is the wrong size for a carousel. Offer the way out.
  function askFormat(e) {
    const fits = e.fix && e.fix.use_style && (state.info.styles || []).find((st) => st.id === e.fix.use_style);
    setStatus('dsv2-make-status', `<div class="dsv2-ask dsv2-fade">
      <p>${esc(e.message)}</p>
      <div class="dsv2-row">${fits ? `<button type="button" class="dsv2-btn dsv2-btn--primary" data-format="use">Use ${esc(fits.name)}</button>` : ''}${e.canOverride ? `<button type="button" class="dsv2-btn${fits ? '' : ' dsv2-btn--primary'}" data-format="anyway">Make it anyway</button>` : ''}</div>
    </div>`);
    const box = el('dsv2-make-status');
    if (!box) return;
    box.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', async () => {
      setStatus('dsv2-make-status', '');
      if (b.dataset.format === 'anyway') { state.formatOverride = true; startCarousel(); return; }
      const brief = el('dsv2-brief') ? el('dsv2-brief').value : '';
      const slides = el('dsv2-slides') ? el('dsv2-slides').value : 'auto';
      try { await loadStyle(e.fix.use_style); state.rebuild = false; state.newStyle = false; draw(); } catch (_) { return; }
      if (el('dsv2-brief')) el('dsv2-brief').value = brief;
      if (el('dsv2-slides')) el('dsv2-slides').value = slides;
      startCarousel();
    }));
    reveal(box);
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
          toast(state.newStyle ? 'Your new style is ready' : 'Your design system is ready', 'success');
          const made = job.result && job.result.style && job.result.style.id;
          state.rebuild = false;
          state.newStyle = false;
          state.examples = [];
          state.info = await call('GET', `/api/design/system${made ? `?style=${encodeURIComponent(made)}` : ''}`).catch(() => state.info);
          state.styleId = (state.info.style && state.info.style.id) || state.styleId;
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
    state.resultStyle = (result && result.style && result.style.id) || '';
    const box = el('dsv2-result');
    if (!box || !result || !Array.isArray(result.slides)) return;
    const slides = result.slides.filter((s) => s && s.url);
    const ratio = ratioCss();
    box.innerHTML = `<div class="dsv2-card dsv2-fade" id="dsv2-done">
      <div class="dsv2-card-head">
        <div><h3>${esc(result.title || 'Your carousel')}</h3>${result.angle ? `<p class="dsv2-sub" style="margin-top:4px;">${esc(result.angle)}</p>` : ''}${result.recipe ? `<span class="dsv2-chip" style="display:inline-block;margin-top:8px;">From recipe: ${esc(result.recipe.name)}</span>` : ''}</div>
        <div class="dsv2-row">
          <button type="button" class="dsv2-btn" id="dsv2-rcp-save">Save as recipe</button>
          <button type="button" class="dsv2-btn" id="dsv2-zip">Download</button>
          <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-queue">Add to queue</button>
        </div>
      </div>
      <div id="dsv2-rcp-savebox"></div>
      <div class="dsv2-hint" id="dsv2-posts-to" style="margin:-6px 0 12px;text-align:right;">${queuePlatforms().length ? `Posts to ${queuePlatforms().join(' + ')}` : 'Connect Instagram or Facebook in Settings to post'}
      </div>
      <div class="dsv2-slides">${slides.map((s, i) => {
        const c = s.critic || {};
        const score = Number(c.score) || 0;
        const notes = (c.problems || []).slice(0, 2).join('; ');
        return `<figure class="dsv2-slide"><button type="button" data-open="${i}" aria-label="View slide ${i + 1}"><img src="${esc(s.url)}" alt="Slide ${i + 1}" loading="lazy" style="aspect-ratio:${ratio};object-fit:cover;"></button>
          <figcaption class="dsv2-slide-meta"><button type="button" class="dsv2-link" data-edit="${i}">Edit</button>Slide ${i + 1}${score ? ` · review <span class="dsv2-score${score < 4 ? ' dsv2-score--low' : ''}">${score}/5</span>` : ''}${notes ? `<br>${esc(notes)}` : ''}</figcaption></figure>`;
      }).join('')}</div>
      <label class="dsv2-label" for="dsv2-caption">Caption</label>
      <textarea id="dsv2-caption" style="min-height:130px;">${esc(captionWithTags(result))}</textarea>
      ${(result.sources || []).length ? `<div class="dsv2-sources"><label class="dsv2-label">Facts checked against</label>${result.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('')}</div>` : ''}
    </div>`;
    const urls = slides.map((s) => s.url);
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => lightbox(urls, Number(b.dataset.open))));
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editSlide(result, result.slides.indexOf(slides[Number(b.dataset.edit)]))));
    el('dsv2-zip').addEventListener('click', () => downloadZip(urls));
    el('dsv2-rcp-save').addEventListener('click', () => openSaveRecipe(result));
    el('dsv2-queue').addEventListener('click', () => queue(urls, result));
    if (scroll) reveal(box.firstElementChild);
  }

  function waitJob(id, onProgress) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const job = (await call('GET', `/api/design/jobs/${encodeURIComponent(id)}`)).job;
          if (job.status === 'done') return resolve(job.result);
          if (job.status === 'failed') return reject(new Error(job.error || 'Edit failed. Try again.'));
          if (onProgress) onProgress(job.progress || {});
        } catch (e) {
          if (/not found/i.test(e.message)) return reject(e);
        }
        setTimeout(tick, 2000);
      };
      tick();
    });
  }

  const EDIT_STAGES = { edit: 'Rewriting with AI…', art: 'Drawing the new picture (about 30–60 seconds)…', render: 'Redrawing the slide…' };

  function warningsHtml(issues) {
    const list = (issues || []).filter((x) => x.severity === 'hard' || x.type === 'too_long' || x.type === 'unsourced_number');
    return list.length ? `<div class="dsv2-ed-warn">${list.slice(0, 4).map((x) => `<div>⚠ ${esc(x.detail || x.type)}</div>`).join('')}</div>` : '';
  }

  const FIELD_NAMES = {
    kicker: 'Small label', eyebrow: 'Small label', label: 'Small label', title: 'Headline', heading: 'Headline', headline: 'Headline',
    subtitle: 'Subheading', subheading: 'Subheading', body: 'Body text', text: 'Body text', points: 'Points', items: 'Points',
    note: 'Note', source: 'Source', sources: 'Source', cta: 'Call to action', action: 'Call to action', stat: 'Big number', number: 'Big number',
  };
  function fieldName(name) {
    if (FIELD_NAMES[name]) return FIELD_NAMES[name];
    const t = String(name).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const QUICK_ASKS = [['Shorter', 'Make the words shorter and easier to read on a phone.'], ['Warmer', 'Say it more warmly and kindly.'], ['Punchier headline', 'Make the headline punchier.'], ['Simpler words', 'Use simpler, everyday words.']];
  const COLOR_NAMES = { bg: 'Background', surface: 'Surface', ink: 'Text', muted: 'Muted', primary: 'Primary', accent: 'Accent', border: 'Border', cta: 'Button' };
  const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
  const versionOf = (s) => ({ url: s.url, pattern: s.pattern, slots: clone(s.slots || {}), style: clone(s.style || {}), issues: s.issues || [] });

  /** Move words and pictures into another layout by slot kind and order, so a layout switch previews instantly. */
  function mapToLayout(patterns, slide, toId) {
    const from = patterns.find((p) => p.id === slide.pattern) || { slots: {} };
    const to = patterns.find((p) => p.id === toId) || { slots: {} };
    const pools = { text: [], list: [], image: [] };
    for (const [name, sp] of Object.entries(from.slots || {})) {
      const v = slide.slots[name];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      (pools[sp.kind] || pools.text).push({ name, v });
    }
    const slots = {};
    const take = (kind, name) => {
      const pool = pools[kind];
      const same = pool.findIndex((x) => x.name === name);
      return pool.splice(same >= 0 ? same : 0, 1)[0];
    };
    for (const [name, sp] of Object.entries(to.slots || {})) {
      const kind = sp.kind === 'list' || sp.kind === 'image' ? sp.kind : 'text';
      let got = take(kind, name);
      if (!got && kind === 'list' && pools.text.length) got = { v: [take('text', name).v] };
      if (!got && kind === 'text' && pools.list.length) got = { v: [].concat(take('list', name).v).join(' · ') };
      if (got) slots[name] = got.v;
    }
    const style = clone(slide.style || {});
    if (style.slots) for (const n of Object.keys(style.slots)) if (!(to.slots || {})[n]) delete style.slots[n];
    return { pattern: toId, slots, style };
  }

  function editSlide(result, start) {
    const sys = (state.info && state.info.system) || {};
    const patterns = sys.patterns || [];
    const colors = Object.entries(sys.colors || {}).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(String(v)));
    const previews = new Map(((state.info && state.info.previews) || []).filter((p) => p && p.url).map((p) => [p.pattern, p.url]));
    if (!result.slides[start] || !result.slides[start].slots) { toast('This slide was made before editing existed. Make the carousel again to edit it.', 'info'); return; }
    let i = start;
    let tab = 'text';
    let draft = null;
    let dirty = false;
    let picUrl = '';
    let busy = false;
    let selected = '';
    let previewSeq = 0;
    let previewTimer = null;
    const ov = document.createElement('div');
    ov.className = 'dsv2-ed';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const q = (sel) => ov.querySelector(sel);

    function load(n) {
      i = n;
      const cur = result.slides[i];
      draft = { pattern: cur.pattern, slots: clone(cur.slots || {}), style: clone(cur.style || {}) };
      dirty = false;
      picUrl = '';
      selected = '';
    }
    function markDirty() {
      dirty = true;
      const badge = q('#dsv2-ed-badge');
      if (badge) { badge.textContent = 'Unsaved changes'; badge.classList.add('is-dirty'); }
      schedulePreview();
    }
    function close() {
      if (dirty && !window.confirm('Close without saving your changes to this slide?')) return;
      ov.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') close();
    }
    async function moveTo(n) {
      if (busy || n < 0 || n >= result.slides.length || n === i) return;
      if (dirty) {
        if (window.confirm('Save your changes to this slide first?')) { await save(); if (dirty) return; } else dirty = false;
      }
      load(n);
      draw();
    }

    // ── live preview (two frames, swapped when the next one has loaded, so typing never flashes) ──
    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 220);
    }
    async function renderPreview() {
      const seq = ++previewSeq;
      const stage = q('.dsv2-ed-stage');
      if (!stage) return;
      let r;
      try {
        r = await call('POST', '/api/design/slide/preview', { slide: draft, index: i, total: result.slides.length });
      } catch (e) {
        return;
      }
      if (seq !== previewSeq || !stage.isConnected) return;
      const frames = stage.querySelectorAll('iframe');
      const next = frames[0].classList.contains('is-on') ? frames[1] : frames[0];
      const scale = stage.clientWidth / r.width;
      [...frames].forEach((f) => { f.style.width = `${r.width}px`; f.style.height = `${r.height}px`; f.style.transform = `scale(${scale})`; });
      stage.style.height = `${Math.round(r.height * scale)}px`;
      next.onload = () => {
        if (seq !== previewSeq) return;
        wireFrame(next);
        frames.forEach((f) => f.classList.toggle('is-on', f === next));
        stage.classList.add('is-live');
      };
      next.srcdoc = r.html;
    }
    function wireFrame(frame) {
      const doc = frame.contentDocument;
      if (!doc) return;
      const st = doc.createElement('style');
      st.textContent = '[data-slot]{cursor:pointer;transition:outline-color .15s}[data-slot]:hover{outline:4px dashed rgba(124,58,237,.75);outline-offset:6px}[data-slot].se-sel{outline:5px solid #7C3AED;outline-offset:6px}';
      doc.head.appendChild(st);
      if (selected) doc.querySelectorAll(`[data-slot="${selected}"]`).forEach((n) => n.classList.add('se-sel'));
      doc.addEventListener('click', (ev) => {
        const hit = ev.target.closest && ev.target.closest('[data-slot]');
        ev.preventDefault();
        if (!hit) return;
        const name = hit.getAttribute('data-slot');
        const pattern = patterns.find((p) => p.id === draft.pattern) || { slots: {} };
        const kind = (pattern.slots[name] || {}).kind;
        selected = name;
        doc.querySelectorAll('.se-sel').forEach((n) => n.classList.remove('se-sel'));
        doc.querySelectorAll(`[data-slot="${name}"]`).forEach((n) => n.classList.add('se-sel'));
        tab = kind === 'image' ? 'picture' : 'text';
        drawPanel();
        const field = q(`[data-field="${name}"]`);
        if (field) {
          field.scrollIntoView({ block: 'center', behavior: 'smooth' });
          field.classList.add('is-flash');
          const input = field.querySelector('[data-slot]');
          if (input) input.focus();
        }
      });
    }

    // ── panel tabs ──
    function styleOf(name) {
      draft.style = draft.style || {};
      draft.style.slots = draft.style.slots || {};
      draft.style.slots[name] = draft.style.slots[name] || {};
      return draft.style.slots[name];
    }
    function swatches(attr, current, name) {
      return `<div class="dsv2-ed-swatches"><button type="button" class="dsv2-ed-sw dsv2-ed-sw--none${!current ? ' is-on' : ''}" ${attr}="" ${name ? `data-name="${esc(name)}"` : ''} title="Brand default">✕</button>${colors.map(([k, v]) => `<button type="button" class="dsv2-ed-sw${current === k ? ' is-on' : ''}" ${attr}="${esc(k)}" ${name ? `data-name="${esc(name)}"` : ''} title="${esc(COLOR_NAMES[k] || k)}" style="background:${esc(v)}"></button>`).join('')}</div>`;
    }
    function textTab(pattern) {
      const fields = Object.entries(pattern.slots || {}).filter(([, sp]) => sp && sp.kind !== 'image');
      if (!fields.length) return '<p class="dsv2-ed-note">This layout has no text.</p>';
      return fields.map(([name, sp]) => {
        const v = draft.slots[name];
        const text = sp.kind === 'list' ? (Array.isArray(v) ? v : String(v || '').split('\n')).join('\n') : String(v || '');
        const st = ((draft.style || {}).slots || {})[name] || {};
        const id = `dsv2-ed-f-${esc(name)}`;
        const attrs = `id="${id}" data-slot="${esc(name)}" data-kind="${esc(sp.kind)}" data-max="${Number(sp.max_chars) || 0}"`;
        const input = sp.kind !== 'list' && (Number(sp.max_chars) || 0) <= 60
          ? `<input type="text" ${attrs} value="${esc(text)}">`
          : `<textarea ${attrs} rows="${sp.kind === 'list' ? 4 : 3}">${esc(text)}</textarea>`;
        const size = Number(st.size) || 0;
        return `<div class="dsv2-ed-field${selected === name ? ' is-sel' : ''}${st.hide ? ' is-hidden' : ''}" data-field="${esc(name)}">
          <label for="${id}">${esc(fieldName(name))}${sp.kind === 'list' ? ' <em>one per line</em>' : ''}<span class="dsv2-ed-count" data-count="${esc(name)}"></span></label>
          ${input}
          <div class="dsv2-ed-tools">
            <div class="dsv2-ed-seg" title="Text size"><button type="button" data-size="-1" data-name="${esc(name)}" aria-label="Smaller">A−</button><span>${100 + size * 10}%</span><button type="button" data-size="1" data-name="${esc(name)}" aria-label="Bigger">A+</button></div>
            <div class="dsv2-ed-seg" title="Alignment">${['left', 'center', 'right'].map((a) => `<button type="button" data-align="${a}" data-name="${esc(name)}" class="${st.align === a ? 'is-on' : ''}" aria-label="Align ${a}">${a === 'left' ? '⇤' : a === 'center' ? '≡' : '⇥'}</button>`).join('')}</div>
            ${swatches('data-color', st.color || '', name)}
            <button type="button" class="dsv2-ed-hide${st.hide ? ' is-on' : ''}" data-hide="${esc(name)}">${st.hide ? 'Hidden' : 'Hide'}</button>
          </div>
        </div>`;
      }).join('') + '<p class="dsv2-ed-tip">Click any text on the slide to jump to it. Wrap a word in *stars* to highlight it.</p>';
    }
    function layoutTab() {
      return `<p class="dsv2-ed-note" style="color:rgba(255,255,255,0.6);margin-bottom:10px;">Your words and picture move into the new layout. Check the preview, then save.</p>
        <div class="dsv2-ed-layouts">${patterns.map((p) => `<button type="button" class="dsv2-ed-lay${p.id === draft.pattern ? ' is-on' : ''}" data-layout="${esc(p.id)}" title="${esc(p.name || p.id)}">
        ${previews.get(p.id) ? `<img src="${esc(previews.get(p.id))}" alt="" loading="lazy" style="aspect-ratio:${ratioCss()};">` : `<span class="dsv2-ed-lay-blank" style="aspect-ratio:${ratioCss()};"></span>`}
        <span>${esc(p.name || p.id)}</span></button>`).join('')}</div>`;
    }
    function pictureTab(pattern) {
      const slot = Object.entries(pattern.slots || {}).find(([, sp]) => sp && sp.kind === 'image');
      if (!slot) return '<p class="dsv2-ed-note">This layout has no picture. Pick another layout to add one.</p>';
      const url = draft.slots[slot[0]];
      const art = (draft.style || {}).art || { zoom: 1, x: 50, y: 50 };
      const medicalPic = result.medical && state.info && state.info.figurelabs;
      return `<div class="dsv2-ed-field" data-field="${esc(slot[0])}">
        <div class="dsv2-ed-picrow">
          ${url ? `<img class="dsv2-ed-pic-now" src="${esc(url)}" alt="">` : '<span class="dsv2-ed-pic-now"></span>'}
          <div style="flex:1;min-width:0;">
            <div class="dsv2-ed-range"><label>Zoom</label><input type="range" min="1" max="2.5" step="0.05" value="${art.zoom}" data-art="zoom"></div>
            <div class="dsv2-ed-range"><label>Left ↔ right</label><input type="range" min="0" max="100" step="1" value="${art.x}" data-art="x"></div>
            <div class="dsv2-ed-range"><label>Up ↕ down</label><input type="range" min="0" max="100" step="1" value="${art.y}" data-art="y"></div>
          </div>
        </div>
        <label class="dsv2-ed-sub">Replace it</label>
        <div class="dsv2-row" style="gap:8px;">
          <label class="dsv2-btn" style="cursor:pointer;">Upload<input type="file" id="dsv2-ed-upload" accept="image/*" hidden></label>
          <button type="button" class="dsv2-btn" id="dsv2-ed-lib">From Library</button>
          ${url ? `<button type="button" class="dsv2-btn" data-hide="${esc(slot[0])}">${(((draft.style || {}).slots || {})[slot[0]] || {}).hide ? 'Show picture' : 'Hide picture'}</button>` : ''}
        </div>
        <label class="dsv2-ed-sub" for="dsv2-ed-art">Or describe a new one (drawn when you save, 30–60 seconds)</label>
        <input type="text" id="dsv2-ed-art" placeholder="e.g. a mug of chamomile tea on a kitchen table">
        ${medicalPic ? '<label class="dsv2-check"><input type="checkbox" id="dsv2-ed-sci"> Medical or scientific illustration (FigureLabs)</label>' : ''}
      </div>`;
    }
    function backgroundTab() {
      return `<p class="dsv2-ed-note" style="color:rgba(255,255,255,0.6);margin-bottom:10px;">Background for this slide, from your brand colours.</p>${swatches('data-bg', (draft.style || {}).bg || '')}`;
    }
    function aiTab() {
      return `<div class="dsv2-ed-chips">${QUICK_ASKS.map(([label, text]) => `<button type="button" class="dsv2-ed-chip" data-ask="${esc(text)}">${esc(label)}</button>`).join('')}</div>
        <textarea id="dsv2-ed-ai" rows="3" placeholder="Tell AI what to change, e.g. swap the stat for the NHS figure, or add a line about seeing a GP"></textarea>
        <div class="dsv2-actions" style="margin-top:10px;"><button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-ed-ai-go">Apply with AI</button><span class="dsv2-hint">Rewrites this slide and saves it (about 10 seconds). Undo is one click.</span></div>`;
    }

    function drawPanel() {
      const pattern = patterns.find((p) => p.id === draft.pattern) || { slots: {} };
      const panel = q('.dsv2-ed-panel');
      const tabs = [['text', 'Text'], ['layout', 'Layout'], ['picture', 'Picture'], ['background', 'Background'], ['ai', 'Ask AI']];
      panel.innerHTML = `<div class="dsv2-ed-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" class="dsv2-ed-tab${tab === id ? ' is-on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div class="dsv2-ed-tabbody">${tab === 'text' ? textTab(pattern) : tab === 'layout' ? layoutTab() : tab === 'picture' ? pictureTab(pattern) : tab === 'background' ? backgroundTab() : aiTab()}</div>`;
      panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; drawPanel(); }));
      panel.querySelectorAll('[data-slot]').forEach((f) => {
        const count = () => {
          const max = Number(f.dataset.max) || 0;
          const tag = panel.querySelector(`[data-count="${f.dataset.slot}"]`);
          if (!tag || !max) return;
          const longest = f.dataset.kind === 'list' ? Math.max(0, ...f.value.split('\n').map((l) => l.replace(/\*/g, '').length)) : f.value.replace(/\*/g, '').length;
          tag.textContent = `${longest}/${max}`;
          tag.classList.toggle('is-over', longest > max);
        };
        f.addEventListener('input', () => {
          draft.slots[f.dataset.slot] = f.dataset.kind === 'list' ? f.value.split('\n').map((x) => x.trim()).filter(Boolean) : f.value;
          count();
          markDirty();
        });
        f.addEventListener('focus', () => { selected = f.dataset.slot; });
        count();
      });
      panel.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
        const st = styleOf(b.dataset.name);
        st.size = Math.max(-4, Math.min(6, (Number(st.size) || 0) + Number(b.dataset.size)));
        if (!st.size) delete st.size;
        markDirty();
        drawPanel();
      }));
      panel.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => {
        const st = styleOf(b.dataset.name);
        st.align = st.align === b.dataset.align ? undefined : b.dataset.align;
        markDirty();
        drawPanel();
      }));
      panel.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
        const st = styleOf(b.dataset.name);
        st.color = b.dataset.color || undefined;
        markDirty();
        drawPanel();
      }));
      panel.querySelectorAll('[data-hide]').forEach((b) => b.addEventListener('click', () => {
        const st = styleOf(b.dataset.hide);
        st.hide = !st.hide || undefined;
        markDirty();
        drawPanel();
      }));
      panel.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => {
        draft.style = draft.style || {};
        draft.style.bg = b.dataset.bg || undefined;
        markDirty();
        drawPanel();
      }));
      panel.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.layout === draft.pattern) return;
        draft = mapToLayout(patterns, draft, b.dataset.layout);
        markDirty();
        drawPanel();
      }));
      panel.querySelectorAll('[data-art]').forEach((r) => r.addEventListener('input', () => {
        draft.style = draft.style || {};
        draft.style.art = Object.assign({ zoom: 1, x: 50, y: 50 }, draft.style.art, { [r.dataset.art]: Number(r.value) });
        markDirty();
      }));
      const setPic = (url) => {
        const slot = Object.entries(pattern.slots || {}).find(([, sp]) => sp && sp.kind === 'image');
        if (!slot || !url) return;
        draft.slots[slot[0]] = url;
        picUrl = url;
        markDirty();
        drawPanel();
      };
      const up = panel.querySelector('#dsv2-ed-upload');
      if (up) up.addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!f) return;
        try { setPic(await uploadFile(f)); } catch (e) { toast(e.message, 'error'); }
      });
      const lib = panel.querySelector('#dsv2-ed-lib');
      if (lib) lib.addEventListener('click', () => pickFromLibrary('Pick a picture', (urls) => setPic(urls[0])));
      const art = panel.querySelector('#dsv2-ed-art');
      if (art) art.addEventListener('input', () => { if (art.value.trim()) markDirty(); });
      panel.querySelectorAll('[data-ask]').forEach((b) => b.addEventListener('click', () => {
        const ta = panel.querySelector('#dsv2-ed-ai');
        const on = b.classList.toggle('is-on');
        const lines = ta.value.split('\n').map((l) => l.trim()).filter((l) => l && l !== b.dataset.ask);
        if (on) lines.push(b.dataset.ask);
        ta.value = lines.join('\n');
      }));
      const aiGo = panel.querySelector('#dsv2-ed-ai-go');
      if (aiGo) aiGo.addEventListener('click', () => {
        const text = panel.querySelector('#dsv2-ed-ai').value.trim();
        if (!text) { toast('Say what to change, or pick a quick option', 'info'); return; }
        save({ instruction: text });
      });
    }

    function drawStrip() {
      const strip = q('.dsv2-ed-strip');
      const n = result.slides.length;
      strip.innerHTML = `<div class="dsv2-ed-thumbs">${result.slides.map((s, k) => `<button type="button" class="dsv2-ed-thumb${k === i ? ' is-on' : ''}" data-slide="${k}" aria-label="Slide ${k + 1}"><img src="${esc(s.url)}" alt="" style="aspect-ratio:${ratioCss()};"><span>${k + 1}</span></button>`).join('')}
        ${n < 10 ? '<button type="button" class="dsv2-ed-thumb dsv2-ed-add" id="dsv2-ed-add" aria-label="Add a slide"><span class="dsv2-ed-plus">+</span><span>Add</span></button>' : ''}</div>
        <div class="dsv2-ed-ops">
          <button type="button" class="dsv2-btn" data-op="left"${i === 0 ? ' disabled' : ''}>◀ Move</button>
          <button type="button" class="dsv2-btn" data-op="right"${i === n - 1 ? ' disabled' : ''}>Move ▶</button>
          <button type="button" class="dsv2-btn" data-op="dup"${n >= 10 ? ' disabled' : ''}>Duplicate</button>
          <button type="button" class="dsv2-btn" data-op="del"${n <= 1 ? ' disabled' : ''}>Delete</button>
        </div>
        <div class="dsv2-ed-addbox" id="dsv2-ed-addbox" hidden>
          <input type="text" id="dsv2-ed-addtext" placeholder="What should the new slide say? e.g. when to see a GP">
          <button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-ed-addgo">Write slide ${i + 2} with AI</button>
        </div>`;
      strip.querySelectorAll('[data-slide]').forEach((b) => b.addEventListener('click', () => moveTo(Number(b.dataset.slide))));
      strip.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => structure(b.dataset.op)));
      const add = strip.querySelector('#dsv2-ed-add');
      if (add) add.addEventListener('click', () => {
        const box = strip.querySelector('#dsv2-ed-addbox');
        box.hidden = !box.hidden;
        if (!box.hidden) strip.querySelector('#dsv2-ed-addtext').focus();
      });
      const addGo = strip.querySelector('#dsv2-ed-addgo');
      if (addGo) addGo.addEventListener('click', addSlide);
    }

    function draw() {
      const cur = result.slides[i];
      const n = result.slides.length;
      ov.innerHTML = `<div class="dsv2-ed-box">
        <div class="dsv2-ed-head">
          <div><h3>Edit carousel <span>· slide ${i + 1} of ${n}</span></h3><p>Changes show live. Save to redraw the final slide.</p></div>
          <button type="button" class="dsv2-ed-close" aria-label="Close">×</button>
        </div>
        <div class="dsv2-ed-body">
          <div class="dsv2-ed-left">
            <div class="dsv2-ed-stage" style="aspect-ratio:${ratioCss()};">
              <img class="dsv2-ed-still" src="${esc(cur.url)}" alt="Slide ${i + 1}">
              <iframe sandbox="allow-same-origin" title="Live preview" class="is-on" tabindex="-1"></iframe><iframe sandbox="allow-same-origin" title="Live preview" tabindex="-1"></iframe>
              <span class="dsv2-ed-badge" id="dsv2-ed-badge">Live preview</span>
            </div>
            <div class="dsv2-ed-hist">
              <button type="button" class="dsv2-btn" id="dsv2-ed-undo"${(cur.history || []).length ? '' : ' disabled'}>↶ Undo</button>
              <button type="button" class="dsv2-btn" id="dsv2-ed-redo"${(cur.future || []).length ? '' : ' disabled'}>Redo ↷</button>
              <button type="button" class="dsv2-link" id="dsv2-ed-reset">Discard changes</button>
            </div>
            ${warningsHtml(cur.issues)}
          </div>
          <div class="dsv2-ed-panel"></div>
        </div>
        <div class="dsv2-ed-strip"></div>
        <div class="dsv2-ed-foot">
          <span class="dsv2-hint" id="dsv2-ed-status"></span>
          <div class="dsv2-row" style="gap:8px;">
            <button type="button" class="dsv2-btn" id="dsv2-ed-done">Done</button>
            <button type="button" class="dsv2-btn" id="dsv2-ed-save">Save slide</button>
            ${i < n - 1 ? '<button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-ed-next">Save &amp; next slide →</button>' : '<button type="button" class="dsv2-btn dsv2-btn--primary" id="dsv2-ed-finish">Save &amp; finish</button>'}
          </div>
        </div>
      </div>`;
      q('.dsv2-ed-close').addEventListener('click', close);
      q('#dsv2-ed-done').addEventListener('click', close);
      q('#dsv2-ed-save').addEventListener('click', () => save());
      const nextBtn = q('#dsv2-ed-next');
      if (nextBtn) nextBtn.addEventListener('click', async () => {
        if (dirty || pendingArt()) { await save(); if (dirty) return; }
        load(i + 1);
        draw();
      });
      const finish = q('#dsv2-ed-finish');
      if (finish) finish.addEventListener('click', async () => {
        if (dirty || pendingArt()) { await save(); if (dirty) return; }
        close();
      });
      q('#dsv2-ed-undo').addEventListener('click', () => history(-1));
      q('#dsv2-ed-redo').addEventListener('click', () => history(1));
      q('#dsv2-ed-reset').addEventListener('click', () => { load(i); draw(); });
      drawPanel();
      drawStrip();
      renderPreview();
    }

    function pendingArt() {
      const art = q('#dsv2-ed-art');
      return !!(art && art.value.trim());
    }

    function persist() {
      const last = store.get('last');
      if (last && last.title === result.title) store.set('last', Object.assign({}, result));
      showResult(result, false);
    }

    function history(dir) {
      if (busy) return;
      const cur = result.slides[i];
      const back = (cur.history || []).slice();
      const fwd = (cur.future || []).slice();
      const now = versionOf(cur);
      let v;
      if (dir < 0) { if (!back.length) return; v = back.pop(); fwd.push(now); }
      else { if (!fwd.length) return; v = fwd.pop(); back.push(now); }
      result.slides[i] = Object.assign({}, v, { history: back.slice(-10), future: fwd.slice(-10), critic: null });
      persist();
      load(i);
      draw();
    }

    function setStatus(text, spin) {
      const s = q('#dsv2-ed-status');
      if (s) s.innerHTML = text ? `${spin ? '<span class="dsv2-spin"></span> ' : ''}${esc(text)}` : '';
    }
    function lock(on) {
      busy = on;
      const box = q('.dsv2-ed-box');
      if (box) box.classList.toggle('dsv2-ed-busy', on);
      ov.querySelectorAll('.dsv2-ed-foot button, .dsv2-ed-ops button').forEach((b) => { if (on) b.dataset.was = b.disabled ? '1' : ''; b.disabled = on ? true : b.dataset.was === '1'; });
    }

    async function save(extra = {}) {
      if (busy) return;
      const cur = result.slides[i];
      const artInput = q('#dsv2-ed-art');
      const artSubject = artInput ? artInput.value.trim() : '';
      const sci = q('#dsv2-ed-sci');
      if (!dirty && !artSubject && !extra.instruction) { setStatus('No changes to save.'); return; }
      const body = {
        slide: draft,
        index: i,
        total: result.slides.length,
        instruction: extra.instruction || undefined,
        art_subject: artSubject || undefined,
        scientific: !!(sci && sci.checked && artSubject) || undefined,
        medical: result.medical === true ? true : undefined,
        research: result.medical ? result.research || '' : undefined,
        brief: result.brief || undefined,
      };
      lock(true);
      setStatus(body.instruction ? EDIT_STAGES.edit : body.art_subject ? EDIT_STAGES.art : EDIT_STAGES.render, true);
      try {
        const r = await call('POST', '/api/design/slide', body);
        const out = await waitJob(r.job_id, (p) => { if (EDIT_STAGES[p.stage]) setStatus(EDIT_STAGES[p.stage], true); });
        result.slides[i] = Object.assign({}, out.slide, { critic: null, history: (cur.history || []).concat([versionOf(cur)]).slice(-10), future: [] });
        persist();
        lock(false);
        load(i);
        if (ov.isConnected) draw();
        setStatus('Saved.');
        toast('Slide saved', 'success');
      } catch (e) {
        lock(false);
        setStatus('');
        toast(e.message || 'Save failed', 'error');
      }
    }

    async function renumber(note) {
      lock(true);
      setStatus(note, true);
      try {
        const r = await call('POST', '/api/design/slides/render', { slides: result.slides.map((s) => ({ pattern: s.pattern, slots: s.slots, style: s.style || {} })) });
        const out = await waitJob(r.job_id);
        out.slides.forEach((s, k) => { result.slides[k] = Object.assign({}, result.slides[k], { url: s.url, issues: s.issues }); });
        setStatus('Page numbers updated.');
      } catch (e) {
        toast(`Slides moved, but page numbers did not update: ${e.message}`, 'error');
        setStatus('');
      }
      lock(false);
      persist();
      if (ov.isConnected) draw();
    }

    async function structure(op) {
      if (busy) return;
      if (dirty && !window.confirm('Your unsaved changes to this slide will be lost. Continue?')) return;
      const s = result.slides;
      if (op === 'left' && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; load(i - 1); }
      else if (op === 'right' && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; load(i + 1); }
      else if (op === 'dup' && s.length < 10) { s.splice(i + 1, 0, Object.assign(versionOf(s[i]), { history: [], future: [] })); load(i + 1); }
      else if (op === 'del' && s.length > 1) {
        if (!window.confirm(`Delete slide ${i + 1}?`)) return;
        s.splice(i, 1);
        load(Math.min(i, s.length - 1));
      } else return;
      draw();
      await renumber('Updating page numbers…');
    }

    async function addSlide() {
      if (busy) return;
      const text = (q('#dsv2-ed-addtext') || {}).value || '';
      if (text.trim().length < 3) { toast('Say what the new slide should be about', 'info'); return; }
      if (dirty && !window.confirm('Your unsaved changes to this slide will be lost. Continue?')) return;
      const at = i + 1;
      const context = result.slides.map((s, k) => `${k + 1}. ${Object.values(s.slots || {}).filter((v) => typeof v === 'string' && !/^https?:/.test(v)).join(' / ')}`).join('\n');
      lock(true);
      setStatus('Writing the new slide…', true);
      try {
        const r = await call('POST', '/api/design/slide', {
          slide: { pattern: result.slides[i].pattern, slots: {} },
          create: true,
          instruction: text.trim(),
          context,
          index: at,
          total: result.slides.length + 1,
          medical: result.medical === true ? true : undefined,
          research: result.medical ? result.research || '' : undefined,
          brief: result.brief || undefined,
        });
        const out = await waitJob(r.job_id, (p) => { if (EDIT_STAGES[p.stage]) setStatus(p.stage === 'edit' ? 'Writing the new slide…' : EDIT_STAGES[p.stage], true); });
        result.slides.splice(at, 0, Object.assign({}, out.slide, { critic: null, history: [], future: [] }));
        lock(false);
        load(at);
        draw();
        if (at < result.slides.length - 1) await renumber('Updating page numbers…');
        else { persist(); setStatus('New slide added.'); }
      } catch (e) {
        lock(false);
        setStatus('');
        toast(e.message || 'Could not add the slide', 'error');
      }
    }

    ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    load(i);
    document.body.appendChild(ov);
    draw();
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

  async function applyHandoff(p) {
    if (p.style_id && p.style_id !== state.styleId && (state.info.styles || []).some((st) => st.id === p.style_id)) {
      try { await loadStyle(p.style_id); state.rebuild = false; state.newStyle = false; draw(); } catch (_) { /* keep the current style */ }
    }
    const brief = el('dsv2-brief');
    if (!brief) {
      if (!(state.info && state.info.system)) toast('Set up your brand design first, then Coach can design carousels in it', 'info');
      return;
    }
    state.recipeId = null;
    drawRecipes();
    brief.value = String(p.brief || '');
    el('dsv2-slides').value = Number(p.slides) >= 3 ? String(Math.min(10, Math.round(Number(p.slides)))) : 'auto';
    if (/^https:\/\//i.test(String(p.source_image_url || ''))) { state.source = p.source_image_url; drawSource(); }
    state.handoffMedical = p.medical === true || p.medical === false || p.medical === 'ask' ? p.medical : undefined;
    reveal(brief);
    if (p.autostart && !store.get('job')) startCarousel();
  }

  function openWith(p) {
    state.pending = Object.assign({}, p || {});
    global.__SE_CAROUSEL_VIEW = 'brand'; // Carousels tab: the brand-template view owns handoffs
    if (typeof global.switchNav === 'function') global.switchNav('brand-design');
  }

  // Run by the Coach, no page needed. buildStyle: a new style from a reference image, saved next to the others.
  // makeCarousel: a carousel in a named style, saved as the "last" result so the Carousels tab opens on it.
  // With rebuild_style_id the style is rebuilt in place at the size asked (its id and name stay), from the references it
  // already has; without it a new style is added next to the others, at the carousel size unless a size is asked for.
  async function buildStyle({ name, notes, source_image_url, example_urls, ratio, rebuild_style_id, onProgress }) {
    const urls = Array.isArray(example_urls) && example_urls.length ? example_urls : [source_image_url];
    const r = await call('POST', '/api/design/system/build', {
      ...(rebuild_style_id ? { style_id: rebuild_style_id } : { add: true }),
      style_name: name || undefined,
      notes: notes || undefined,
      ratio: ratio || undefined,
      example_urls: urls,
    });
    const result = await waitJob(r.job_id, onProgress);
    state.info = null; // the Carousels tab reloads its styles
    return result && result.style ? result.style : null;
  }

  async function makeCarousel({ brief, slides, style_id, source_image_url, medical, onProgress }) {
    const r = await call('POST', '/api/design/carousel', {
      brief,
      style_id: style_id || undefined,
      medical: medical === 'ask' ? true : medical === true,
      count: Number(slides) >= 3 ? Math.min(10, Math.round(Number(slides))) : undefined,
      research: true,
      source_image_url: /^https:\/\//i.test(String(source_image_url || '')) ? source_image_url : undefined,
    });
    const result = await waitJob(r.job_id, onProgress);
    store.set('last', Object.assign({}, result, { brief }));
    store.set('job', null);
    return result;
  }

  // The whole Coach action in one place, for every Coach chat. ui: { say(text) -> { set(text) }, offer(label, fn), remember(text) }.
  async function runStyleAction(action, ui) {
    const rebuilding = !!action.rebuild_style_id;
    const status = ui.say(rebuilding
      ? `Rebuilding your style "${action.name}"${action.ratio ? ` at ${action.ratio}` : ''} from the references it already has. This takes about 10 minutes; keep this page open${action.then_carousel ? ' and I will make the carousel straight after' : ''}.`
      : `Building your new style "${action.name}" from the reference. This takes about 10 minutes; keep this page open and I will start the carousel straight after.`);
    let style = null;
    try {
      style = await buildStyle({
        name: action.name,
        notes: action.notes,
        source_image_url: action.source_image_url,
        example_urls: action.example_urls,
        ratio: action.ratio,
        rebuild_style_id: action.rebuild_style_id,
        onProgress: (p) => { status.set(`${rebuilding ? 'Rebuilding' : 'Building'} "${action.name}": ${stageText(p)}`); },
      });
    } catch (e) {
      status.set(`The ${rebuilding ? 'style' : 'new style'} could not be ${rebuilding ? 'rebuilt' : 'built'}: ${e.message || 'try again in a minute'}. Nothing was changed, your other styles are as they were.`);
      return;
    }
    const label = (style && style.name) || action.name;
    const ready = rebuilding
      ? `Your style "${label}" is rebuilt${action.ratio ? ` at ${action.ratio}` : ''} and ready in the Carousels tab.`
      : `Your new style "${label}" is ready. It is saved next to your other styles in the Carousels tab.`;
    status.set(ready);
    if (ui.remember) ui.remember(ready);
    if (!action.then_carousel) return;
    const work = ui.say('Now designing the carousel in it. About 5 minutes.');
    try {
      const result = await makeCarousel({
        brief: action.then_carousel.brief,
        slides: action.then_carousel.slides,
        style_id: style && style.id,
        source_image_url: rebuilding ? undefined : action.source_image_url, // a rebuild's references are the look to copy, not a poster to turn into a carousel
        medical: action.medical,
        onProgress: (p) => { work.set(`Designing the carousel: ${stageText(p)}`); },
      });
      const done = `The carousel is ready: ${(result.slides || []).length} slides in "${label}".`;
      work.set(done);
      ui.offer('Open the carousel', () => { global.__SE_CAROUSEL_VIEW = 'brand'; if (typeof global.switchNav === 'function') global.switchNav('brand-design'); });
      if (ui.remember) ui.remember(done);
    } catch (e) {
      work.set(`The style is ready but the carousel could not be made: ${e.message || 'try again in a minute'}. You can make it in the Carousels tab in the new style.`);
    }
  }

  global.seDesignStudio = { render, openWith, stageText, buildStyle, makeCarousel, runStyleAction };
})(typeof window !== 'undefined' ? window : globalThis);
